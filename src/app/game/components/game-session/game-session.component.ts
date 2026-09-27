import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import {GameSessionService} from "../../services/game-session.service";
import {Router} from "@angular/router";
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
import {RateLimitStateService} from "../../../core/http/rate-limit-state.service";


@Component({
    selector: 'app-game-session',
    templateUrl: './game-session.component.html',
    styleUrls: ['./game-session.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class GameSessionComponent {
  private gameSessionService = inject(GameSessionService);
  private router = inject(Router);
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

  onNewGame(): void {
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
    this.gameSessionService.createNewGame(this.createGameRequest).subscribe(response => {
      // Populate the join code from the create game response
      this.joinGameRequest.joinCode = response.joinCode;

      // The backend requires a non-blank player name to join. The create form
      // doesn't collect one, so default it from the signed-in profile (or 'Host').
      if (!this.joinGameRequest.name) {
        this.joinGameRequest.name = this.authService.getUserProfile()?.name || 'Host';
      }

      // Join game with new join game request
      this.submitJoinGame()
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

    join$.subscribe(response => {
      saveGameJoin(response.gameSessionId, authenticated
        ? {playerSessionId: response.playerSessionId, authenticated: true}
        : {playerSessionId: response.playerSessionId, playerSecret: response.playerSecret, authenticated: false});

      this.router.navigate(["/game", {
        "gameSessionId": response.gameSessionId,
        "playerSessionId": response.playerSessionId
      }]);
    });
  }
}
