import { Component, ChangeDetectionStrategy, OnInit, computed, inject } from '@angular/core';
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

  /**
   * The builder's "Play test" (PB-15) lands here with `?mode=single&packetId=…`.
   * The packet id is stashed for `GameConfigComponent` to pick up once the
   * match is in CONFIG; `mode=single` preselects and launches the solo flow
   * directly, so "Play test" is a single click from the builder into a game.
   */
  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const packetId = params.get('packetId');
    if (packetId) {
      this.pendingPacketService.set(packetId);
    }
    if (params.get('mode') === 'single') {
      this.startSoloGame();
    }
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
    this.gameSessionService.createNewGame(this.createGameRequest).subscribe({
      next: response => {
        // Populate the join code from the create game response
        this.joinGameRequest.joinCode = response.joinCode;

        // The backend requires a non-blank player name to join. The create form
        // doesn't collect one, so default it from the signed-in profile (or 'Host').
        if (!this.joinGameRequest.name) {
          this.joinGameRequest.name = this.authService.getUserProfile()?.name || 'Host';
        }

        // Join game with new join game request
        this.submitJoinGame()
      },
      // NG-V1-05: this game never reaches CONFIG, so a packet staged for it
      // (e.g. by "Play test") must not linger to attach itself to a later,
      // unrelated game.
      error: () => {
        this.pendingPacketService.clear();
        this.snack.open('Could not create the game. Please try again.', 'Dismiss', { duration: 4000 });
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
   */
  submitJoinGame(): void {
    const authenticated = this.isAuthenticated;
    const join$ = authenticated
      ? this.gameSessionService.joinGameAuthenticated(this.joinGameRequest)
      : this.gameSessionService.joinGame(this.joinGameRequest);

    join$.subscribe({
      next: response => {
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
      error: () => {
        this.pendingPacketService.clear();
        this.snack.open('Could not join the game. Please try again.', 'Dismiss', { duration: 4000 });
      },
    });
  }
}
