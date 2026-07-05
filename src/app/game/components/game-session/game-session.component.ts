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
    // Reset the visibility flags for the forms
    this.showCreateForm = false;
    this.showJoinForm = false;
  }

  submitCreateGame(): void {
    this.gameSessionService.createNewGame(this.createGameRequest).subscribe(response => {
      console.log("Create game response");
      console.log(response);

      // Populate the join code from the create game response
      this.joinGameRequest.joinCode = response.joinCode;

      // Join game with new join game request
      this.submitJoinGame()
    });
  }

  submitJoinGame(): void {
    // The backend runs in permissive/guest mode, so always join via the guest
    // endpoint. The authenticated endpoint (join-game-session-authenticated) is
    // only exposed when backend auth is enforced and otherwise 404s. Login still
    // identifies the user in the UI; it just doesn't gate play in this mode.
    this.gameSessionService.joinGame(this.joinGameRequest).subscribe(response => {
      const navigationParams: any = {
        "gameSessionId": response.gameSessionId,
        "playerSecret": response.playerSecret,
        "playerSessionId": response.playerSessionId
      };

      // Carry the token through when logged in (harmless in guest mode).
      if (environment.authEnabled && this.authService.isAuthenticated()) {
        navigationParams["accessToken"] = this.authService.getAccessToken();
      }

      this.router.navigate(["/game", navigationParams])
        .then(r => console.log(r));
    });
  }

  
}
