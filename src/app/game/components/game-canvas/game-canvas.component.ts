import {Component, DestroyRef, inject, ChangeDetectionStrategy, OnDestroy, OnInit} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Location} from '@angular/common';
import {ActivatedRoute, ParamMap, Router} from "@angular/router";
import {MatSnackBar} from '@angular/material/snack-bar';
import {GameStateService} from "../../services/game-state.service";
import {Observable, of, race, timer} from "rxjs";
import {filter, map, switchMap, take} from "rxjs/operators";
import {GameSession, MatchState, StompError} from "../../models/sockbowl/sockbowl-interfaces";
import {GameConnectionState, GameWebSocketService, SocketCredentials} from "../../services/game-web-socket.service";
import {clearGameJoin, loadGameJoin, saveGameJoin} from "../../services/game-join-storage";
import {describeStompError} from "../../models/stomp-errors";
import {AuthService} from "../../../core/auth/auth.service";
import {NON_FATAL_BANNER_MS} from "../stomp-error-banner/stomp-error-banner.component";

/** Route matrix params that must never stay in the address bar. */
const SECRET_ROUTE_PARAMS = ['playerSecret', 'accessToken'];

/** How long a reconnect can run before the strip escalates its wording (M5 S1-31). */
const RECONNECT_ESCALATION_MS = 15000;

/**
 * How long the pre-emission "Connecting to the game…" state can run before it
 * escalates its wording too, so a first connect that never lands doesn't sit
 * on the same copy as one still starting up (M5 S1-31, same threshold and
 * copy pattern as the reconnect strip).
 */
const CONNECTING_ESCALATION_MS = 15000;

@Component({
    selector: 'app-game-canvas',
    templateUrl: './game-canvas.component.html',
    styleUrls: ['./game-canvas.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class GameCanvasComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private snackBar = inject(MatSnackBar);
  private authService = inject(AuthService);
  private gameStateService = inject(GameStateService);
  private gameWebSocketService = inject(GameWebSocketService);


  gameSession$: Observable<GameSession>;

  /** Latest socket error, shown by the stomp-error-banner. */
  latestStompError: StompError | null = null;

  /**
   * True while the stomp-error-banner is expected to still be on screen
   * (M5 FF1 material_fixes #3): mirrors its own `NON_FATAL_BANNER_MS`
   * auto-hide window so a child like `app-game-buzzer` can reserve the
   * banner's slot in its own fixed-height layout, the same way it already
   * reserves one for the `.reconnect-strip` — without adding anything to
   * the banner's own frozen component API (this is tracked here, from the
   * same `errors$` the banner input is fed from, not read back from it).
   * Doesn't mirror the banner's own hover/focus pause (an internal detail
   * of that component), so on the rare capture or session where a pointer
   * parks on the banner past 5s, the reserved slot can close a beat before
   * the banner does; the banner is still an overlay, so nothing gets
   * covered even then — a minor, disclosed residual.
   */
  bannerActive = false;
  private bannerActiveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The socket's connection lifecycle (M5 S1-03), for a non-fatal
   * "Reconnecting…" strip so a dropped socket is never silently mistaken for
   * a live, working game.
   */
  connectionState$: Observable<GameConnectionState>;

  /**
   * True once a reconnect has run for {@link RECONNECT_ESCALATION_MS} without
   * recovering, so a long drop never sits on "Reconnecting…" forever with no
   * way out (M5 S1-31). Resets as soon as the connection state changes again.
   */
  reconnectEscalated$: Observable<boolean>;

  /**
   * True once the wait for the very first {@link gameSession$} emission has
   * run for {@link CONNECTING_ESCALATION_MS} without landing, so a stalled
   * first connect (not a reconnect) also escalates instead of sitting on
   * "Connecting to the game…" forever (M5 S1-31). Never emits once the
   * session has arrived, since the connecting view is gone by then.
   */
  connectingEscalated$: Observable<boolean>;

  private gameSessionId = '';

  private destroyRef = inject(DestroyRef);

  constructor() {
    this.gameSession$ = this.gameStateService.gameSession$;
    this.connectionState$ = this.gameWebSocketService.connectionState$;
    this.reconnectEscalated$ = this.connectionState$.pipe(
      switchMap(state => state === 'reconnecting'
        ? timer(RECONNECT_ESCALATION_MS).pipe(map(() => true))
        : of(false))
    );
    this.connectingEscalated$ = race(
      timer(CONNECTING_ESCALATION_MS).pipe(map(() => true)),
      this.gameSession$.pipe(filter(session => !!session), take(1), map(() => false))
    );
  }

  ngOnInit() {
    this.gameStateService.errors$
      ?.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(error => this.onStompError(error));

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {

      const gameSessionId: string = params.get("gameSessionId") || '';
      const playerSessionId: string = params.get("playerSessionId") || '';
      this.gameSessionId = gameSessionId;

      // Never read an access token from the route (AUTH-12): the socket asks
      // AuthService for a fresh one at every CONNECT.
      const credentials = this.resolveCredentials(gameSessionId, playerSessionId, params);
      this.scrubSecretsFromUrl(params);

      this.gameStateService.initialize(gameSessionId, playerSessionId, credentials);
    });
  }

  /** Leaving the canvas means leaving this game seat (NG-R4-02). */
  ngOnDestroy(): void {
    this.clearBannerActiveTimer();
    this.gameStateService.leaveGame();
  }

  /**
   * Marks the banner slot reserved for as long as the banner itself would
   * be on screen (M5 FF1 material_fixes #3): the banner's own
   * `NON_FATAL_BANNER_MS` window for a non-fatal error, or indefinitely for
   * a fatal one (which stays until dismissed — moot in practice, since a
   * fatal error also navigates away above).
   */
  private reserveBannerSlot(fatal: boolean): void {
    this.clearBannerActiveTimer();
    this.bannerActive = true;
    if (!fatal) {
      this.bannerActiveTimer = setTimeout(() => {
        this.bannerActiveTimer = null;
        this.bannerActive = false;
      }, NON_FATAL_BANNER_MS);
    }
  }

  private clearBannerActiveTimer(): void {
    if (this.bannerActiveTimer) {
      clearTimeout(this.bannerActiveTimer);
      this.bannerActiveTimer = null;
    }
  }

  /**
   * Credentials for the seat: what the lobby stored in sessionStorage, else a
   * `playerSecret` matrix param (kept for the e2e harness deep links, then
   * moved into sessionStorage so a reload works once the URL is scrubbed).
   */
  private resolveCredentials(gameSessionId: string, playerSessionId: string, params: ParamMap): SocketCredentials {
    const stored = loadGameJoin(gameSessionId);
    if (stored && stored.playerSessionId === playerSessionId) {
      return stored.authenticated ? {} : {playerSecret: stored.playerSecret};
    }

    const routeSecret = params.get('playerSecret');
    if (routeSecret) {
      saveGameJoin(gameSessionId, {playerSessionId, playerSecret: routeSecret, authenticated: false});
      return {playerSecret: routeSecret};
    }

    // No stored guest secret: a seat bound to the signed-in account.
    return {};
  }

  /** Replace the address bar URL with one that holds only the seat ids. */
  private scrubSecretsFromUrl(params: ParamMap): void {
    if (!SECRET_ROUTE_PARAMS.some(name => params.has(name))) {
      return;
    }
    const kept: Record<string, string> = {};
    for (const key of params.keys) {
      if (!SECRET_ROUTE_PARAMS.includes(key)) {
        kept[key] = params.get(key) as string;
      }
    }
    const url = this.router.serializeUrl(this.router.createUrlTree(['/game', kept]));
    this.location.replaceState(url);
  }

  /**
   * Fatal socket errors end the seat: tell the user why and return to the
   * lobby. Non-fatal ones only show in the banner.
   */
  private onStompError(error: StompError): void {
    this.latestStompError = error;
    this.reserveBannerSlot(!!error.fatal);
    if (!error.fatal) {
      return;
    }
    clearGameJoin(this.gameSessionId);
    if ((error.code === 'TOKEN_EXPIRED' || error.code === 'AUTH_REQUIRED') && this.authService.getAccessToken()) {
      // The token could not be refreshed: the session is over. AuthService
      // prompts the user to sign in again.
      this.authService.handleSessionEnded();
    } else if (error.code === 'BANNED' || error.code === 'IP_BANNED') {
      // A banned player gets a persistent lobby notice (M5 S1-16), not a
      // 10s snackbar followed by a generic join failure: navigate with the
      // reason in the router state, which GameSessionComponent reads to show
      // shared/state/error-state instead of the transient banner copy.
      this.router.navigate(['/game-session'], {state: {reason: 'BANNED'}});
      return;
    } else {
      this.snackBar.open(describeStompError(error), 'Dismiss', {duration: 10000});
    }
    this.router.navigate(['/game-session']);
  }

  shouldShowConfigComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.CONFIG;
  }

  shouldShowProctorComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME && this.gameStateService.isSelfProctor();
  }


  shouldShowBuzzerComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME
      && this.gameStateService.isSelfOnAnyTeam()
      && !this.gameStateService.isProctorless();
  }

  shouldShowSinglePlayerComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME
      && this.gameStateService.isSinglePlayer()
      && this.gameStateService.isSelfOnAnyTeam();
  }

  shouldShowAutoProctorComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME
      && this.gameStateService.isAutoJudgedMultiplayer()
      && this.gameStateService.isSelfOnAnyTeam();
  }

  shouldShowSpectatorComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME && this.gameStateService.isSelfSpectator();
  }

  shouldShowMatchSummaryComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.COMPLETED;
  }

}
