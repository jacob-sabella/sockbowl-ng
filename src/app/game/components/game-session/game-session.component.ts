import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import {HttpErrorResponse} from "@angular/common/http";
import {GameSessionService} from "../../services/game-session.service";
import {ActivatedRoute, Router} from "@angular/router";
import {
  CreateGameRequest,
  GameMode,
  JoinGameRequest,
  PlayerMode,
  ProctorType
} from "../../models/sockbowl/sockbowl-interfaces";
import {AuthService} from "../../../core/auth/auth.service";
import {environment} from "../../../../environments/environment";
import {saveGameJoin} from "../../services/game-join-storage";
import {PendingPacketService} from "../../services/pending-packet.service";
import {MatSnackBar} from "@angular/material/snack-bar";
import {RateLimitStateService} from "../../../core/http/rate-limit-state.service";
import {limitErrorFrom} from "../../../core/http/limit-errors";


@Component({
    selector: 'app-game-session',
    templateUrl: './game-session.component.html',
    styleUrls: ['./game-session.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class GameSessionComponent implements OnInit {
  private gameSessionService = inject(GameSessionService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private pendingPacketService = inject(PendingPacketService);
  private snack = inject(MatSnackBar);
  private rateLimitState = inject(RateLimitStateService);
  authService = inject(AuthService);

  showCreateForm = false;
  showJoinForm = false;
  showModeSelect = false;

  /**
   * True while the `session-create` policy is cooling down after a 429
   * (M4-UI-01). Every quick-launch and form path funnels through
   * {@link submitCreateGame}, so all of them share this one cooldown.
   */
  readonly sessionCreateLocked = computed(() => this.rateLimitState.cooldown('session-create')() > 0);

  /** Seconds left in the `session-create` cooldown, for a visible "paused for Ns" hint (M5 S1-05). */
  readonly sessionCreateCooldownSeconds = computed(() => this.rateLimitState.cooldown('session-create')());

  /** True while a create (and its chained join) or a direct join request is in flight (M5 S1-06). */
  readonly createInFlight = signal(false);
  readonly joinInFlight = signal(false);

  /** Inline error for the join-code field (bad/unknown code, a full room) (M5 S1-05). */
  codeError: string | null = null;

  /** Inline error for the guest name field on Join, when it's left blank (M5 S1-35). */
  nameError: string | null = null;

  /**
   * Set when this seat was bounced for being banned (a fatal BANNED/IP_BANNED
   * stomp error, or a 403 on create/join classified as banned): a persistent
   * notice instead of a 10s snackbar followed by a generic join failure
   * (M5 S1-16).
   */
  bannedNotice: string | null = null;

  /**
   * The builder's "Play test" (PB-15) lands here with `?mode=single&packetId=…`.
   * The packet id is stashed for `GameConfigComponent` to pick up once the
   * match is in CONFIG; `mode=single` preselects and launches the solo flow
   * directly, so "Play test" is a single click from the builder into a game.
   */
  ngOnInit(): void {
    const navState = history.state as { reason?: string } | null;
    if (navState?.reason === 'BANNED') {
      this.bannedNotice = 'Your account is banned from playing.';
    }

    const params = this.route.snapshot.queryParamMap;
    const packetId = params.get('packetId');
    if (packetId) {
      this.pendingPacketService.set(packetId);
    }
    if (params.get('mode') === 'single') {
      this.startSoloGame();
    }
  }

  /** Dismisses the persistent banned notice (M5 S1-16). */
  dismissBannedNotice(): void {
    this.bannedNotice = null;
  }

  onNewGame(): void {
    // NG-V1-05: an explicit "New game" discards any packet staged by a
    // cancelled or abandoned "Play test" navigation, so it never silently
    // attaches to this unrelated game.
    this.pendingPacketService.clear();
    this.showModeSelect = true;
    this.showJoinForm = false;
  }

  createGameRequest: CreateGameRequest = {
    gameSettings: {
      proctorType: ProctorType.IN_PERSON_PROCTOR,
      gameMode: GameMode.QUIZ_BOWL_CLASSIC,
      // Required: the backend's GameSettings.bonusesEnabled is a primitive
      // boolean and rejects a missing/null value (400). Default it here.
      bonusesEnabled: true
    }
  } as CreateGameRequest

  joinGameRequest: JoinGameRequest = {} as JoinGameRequest;

  ProctorTypes = ProctorType;
  GameModes = GameMode;
  PlayerModes = PlayerMode;

  /**
   * Display labels for the Game Mode select (M5 S1-35), reusing the mode
   * picker's own copy instead of the raw backend enum keys (for example
   * `QUIZ_BOWL_CLASSIC`).
   */
  readonly gameModeLabels: Record<GameMode, string> = {
    [GameMode.QUIZ_BOWL_CLASSIC]: 'Proctored match',
    [GameMode.SINGLE_PLAYER]: 'Solo practice',
    [GameMode.AUTO_PROCTOR]: 'Auto-judged match',
    [GameMode.FREE_FOR_ALL]: 'Free for all',
  };

  get isAuthenticated(): boolean {
    return environment.authEnabled && this.authService.isAuthenticated();
  }

  /**
   * Display name for the signed-in user, shown in the lobby instead of the
   * guest name input.
   */
  get currentUsername(): string {
    const profile = this.authService.getUserProfile();
    return profile?.preferredUsername || profile?.name || 'Player';
  }

  onCreateGame(): void {
    // A previous quick-launch (solo/auto-proctor/free-for-all) may have set
    // gameMode for its own request, and a failed one leaves it set: reset to
    // the form's own default so "Proctored match" never quietly opens on a
    // stale mode (M5 S1-35).
    this.createGameRequest.gameSettings.gameMode = GameMode.QUIZ_BOWL_CLASSIC;
    this.showCreateForm = true;
    this.showJoinForm = false;
  }

  onJoinGame(): void {
    // NG-V1-05: joining an existing game by code carries no packetId, so any
    // packet staged for a different (cancelled or abandoned) game must not
    // silently attach itself to the one being joined here.
    this.pendingPacketService.clear();
    this.showJoinForm = true;
    this.showCreateForm = false;
  }

  onGoBack() {
    // From a form, step back to the mode picker; from the mode picker, back to the hero.
    if (this.showCreateForm || this.showJoinForm) {
      this.showCreateForm = false;
      this.showJoinForm = false;
    } else {
      this.showModeSelect = false;
    }
  }

  /**
   * Starts a single-player game: sets the mode, then reuses the create→join flow.
   * The player lands in config to pick a packet, then starts the match solo.
   */
  startSoloGame(): void {
    this.createGameRequest.gameSettings.gameMode = GameMode.SINGLE_PLAYER;
    if (!this.joinGameRequest.name) {
      this.joinGameRequest.name = this.authService.getUserProfile()?.name || 'Player';
    }
    this.submitCreateGame();
  }

  /**
   * Hosts an auto-proctor multiplayer game (teams + buzzers, answers auto-judged,
   * no proctor). Lands in config to assign teams + pick a packet, then start.
   */
  startAutoProctorGame(): void {
    this.createGameRequest.gameSettings.gameMode = GameMode.AUTO_PROCTOR;
    if (!this.joinGameRequest.name) {
      this.joinGameRequest.name = this.authService.getUserProfile()?.name || 'Host';
    }
    this.submitCreateGame();
  }

  /**
   * Hosts a free-for-all game (one-player teams auto-created on join, answers
   * auto-judged, no proctor). Lands in config to pick a packet, then start.
   */
  startFreeForAllGame(): void {
    this.createGameRequest.gameSettings.gameMode = GameMode.FREE_FOR_ALL;
    if (!this.joinGameRequest.name) {
      this.joinGameRequest.name = this.authService.getUserProfile()?.name || 'Host';
    }
    this.submitCreateGame();
  }

  submitCreateGame(): void {
    if (this.createInFlight()) {
      return; // guards against a double submit while the request is in flight (M5 S1-06)
    }
    this.createInFlight.set(true);
    this.gameSessionService.createNewGame(this.createGameRequest).subscribe({
      next: response => {
        // Populate the join code from the create game response
        this.joinGameRequest.joinCode = response.joinCode;

        // The backend requires a non-blank player name to join. The create form
        // doesn't collect one, so default it from the signed-in profile (or 'Host').
        if (!this.joinGameRequest.name) {
          this.joinGameRequest.name = this.authService.getUserProfile()?.name || 'Host';
        }

        // Join game with new join game request; createInFlight stays true
        // through the chained join, and clears when that settles.
        this.submitJoinGame(true);
      },
      // NG-V1-05: this game never reaches CONFIG, so a packet staged for it
      // (e.g. by "Play test") must not linger to attach itself to a later,
      // unrelated game.
      error: (err: unknown) => {
        this.createInFlight.set(false);
        this.pendingPacketService.clear();
        this.handleGameError(err, 'create');
      },
    });
  }

  /**
   * Join the game by code. A signed-in user joins as their account
   * (`join-game-session-authenticated`, which binds the seat to the Keycloak
   * id so ownership and bans apply); everyone else joins as a guest. The seat's
   * credentials go to sessionStorage, never the URL: the route carries only
   * the session and seat ids, and the socket authenticates at CONNECT with the
   * guest's playerSecret or a fresh access token.
   *
   * @param chained true when called from {@link submitCreateGame}'s own
   *   create→join chain: the join code already came from the server (no
   *   normalization/validation needed) and `createInFlight` (not
   *   `joinInFlight`) tracks the whole chain (M5 S1-06).
   */
  submitJoinGame(chained = false): void {
    if (!chained) {
      if (this.joinInFlight()) {
        return; // guards against a double submit (the submit button is also disabled meanwhile)
      }
      this.codeError = null;
      this.nameError = null;
      this.joinGameRequest.joinCode = (this.joinGameRequest.joinCode || '').trim().toUpperCase();
      if (!this.joinGameRequest.joinCode) {
        this.codeError = 'Enter a join code.';
        return;
      }
      // A blank guest name used to reach the server and come back as the
      // generic "Could not join the game" snackbar. Catch it inline instead
      // (M5 S1-35); a signed-in seat has no name field to check.
      if (!this.isAuthenticated) {
        this.joinGameRequest.name = (this.joinGameRequest.name || '').trim();
        if (!this.joinGameRequest.name) {
          this.nameError = 'Enter your name';
          return;
        }
      }
      this.joinInFlight.set(true);
    }

    const authenticated = this.isAuthenticated;
    const join$ = authenticated
      ? this.gameSessionService.joinGameAuthenticated(this.joinGameRequest)
      : this.gameSessionService.joinGame(this.joinGameRequest);

    join$.subscribe({
      next: response => {
        if (chained) {
          this.createInFlight.set(false);
        } else {
          this.joinInFlight.set(false);
        }
        saveGameJoin(response.gameSessionId, authenticated
          ? {playerSessionId: response.playerSessionId, authenticated: true}
          : {playerSessionId: response.playerSessionId, playerSecret: response.playerSecret, authenticated: false});

        this.router.navigate(["/game", {
          "gameSessionId": response.gameSessionId,
          "playerSessionId": response.playerSessionId
        }]);
      },
      // NG-V1-05: this can follow a just-succeeded submitCreateGame (the
      // solo-game create→join flow), which never got its own error handling
      // -- a game whose join step fails never reaches CONFIG either, so a
      // packet staged for it (e.g. by "Play test") must not linger to attach
      // itself to a later, unrelated game. Previously unhandled entirely,
      // this rethrew as an uncaught error out of the subscription.
      error: (err: unknown) => {
        if (chained) {
          this.createInFlight.set(false);
        } else {
          this.joinInFlight.set(false);
        }
        this.pendingPacketService.clear();
        this.handleGameError(err, 'join');
      },
    });
  }

  /**
   * Classifies a create/join failure (M5 S1-05):
   * - a rate-limit/quota/limiter-unavailable body: `RateLimitInterceptor`
   *   already showed its own specific snackbar, so nothing more is shown
   *   here (a generic failure snack would otherwise silently replace it).
   * - a banned/ip-banned body: a persistent notice (S1-16), not a snackbar.
   * - 404: the join code doesn't match any game, shown inline on the field.
   * - 409: the room is full, shown inline on the field.
   * - 403 with no recognized body: `AuthInterceptor` already showed a message.
   * - anything else (network, 500, an unrecognized body): the previous
   *   generic copy, per the action that failed.
   */
  private handleGameError(error: unknown, action: 'create' | 'join'): void {
    if (error instanceof HttpErrorResponse) {
      const body = (error.error && typeof error.error === 'object' ? error.error : {}) as Record<string, unknown>;
      const classification = typeof body['error'] === 'string' ? (body['error'] as string) : undefined;
      const limitError = classification ? limitErrorFrom(classification, body) : null;
      if (limitError) {
        if (limitError.kind === 'banned' || limitError.kind === 'ip_banned') {
          this.bannedNotice = limitError.reason || 'Your account is banned from playing.';
        }
        // rate_limited / quota_exceeded / limiter_unavailable: RateLimitInterceptor
        // already notified; showing our own snack here would just replace it.
        return;
      }
      if (error.status === 404) {
        this.codeError = 'No game with that code. Check it with your host.';
        return;
      }
      if (error.status === 409) {
        this.codeError = 'That room is full.';
        return;
      }
      if (error.status === 403) {
        // AuthInterceptor already surfaced a message for this 403.
        return;
      }
    }
    this.snack.open(
      action === 'create' ? 'Could not create the game. Please try again.' : 'Could not join the game. Please try again.',
      'Dismiss',
      { duration: 4000 },
    );
  }
}
