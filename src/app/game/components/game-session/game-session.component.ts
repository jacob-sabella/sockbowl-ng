import {Component} from '@angular/core';
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


@Component({
    selector: 'app-game-session',
    templateUrl: './game-session.component.html',
    styleUrls: ['./game-session.component.scss'],
    standalone: false
})
export class GameSessionComponent {
  showCreateForm = false;
  showJoinForm = false;
  showModeSelect = false;

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

  constructor(
    private gameSessionService: GameSessionService,
    private router: Router,
    public authService: AuthService
  ) {
  }

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
      console.log("Create game response");
      console.log(response);

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

  submitJoinGame(): void {
    // We always join via the guest endpoint (the player is a guest in the game
    // session; login adds per-account features over HTTP, not in-game identity).
    // IMPORTANT: do NOT pass the JWT to the game WebSocket — with backend auth
    // enabled, the session resolver rejects a JWT presented for a guest player
    // ("Cannot use authentication token for guest player session"), which blanks
    // the game canvas. Guests authenticate the socket with playerSecret only.
    // The de-dup HTTP calls still carry the bearer via the auth interceptor.
    this.gameSessionService.joinGame(this.joinGameRequest).subscribe(response => {
      const navigationParams: any = {
        "gameSessionId": response.gameSessionId,
        "playerSecret": response.playerSecret,
        "playerSessionId": response.playerSessionId
      };

      this.router.navigate(["/game", navigationParams])
        .then(r => console.log(r));
    });
  }

  
}
