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
  styleUrls: ['./game-session.component.scss']
})
export class GameSessionComponent {
  showCreateForm = false;
  showJoinForm = false;

  createGameRequest: CreateGameRequest = {
    gameSettings: {
      proctorType: ProctorType.IN_PERSON_PROCTOR,
      gameMode: GameMode.QUIZ_BOWL_CLASSIC
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
    // Check if auth is enabled and user is authenticated
    const isAuthenticated = environment.authEnabled && this.authService.isAuthenticated();

    // Choose the appropriate join method based on authentication status
    const joinObservable = isAuthenticated
      ? this.gameSessionService.joinGameAuthenticated(this.joinGameRequest)
      : this.gameSessionService.joinGame(this.joinGameRequest);

    joinObservable.subscribe(response => {
      console.log("Join game response");
      console.log(response);

      // Build navigation parameters
      const navigationParams: any = {
        "gameSessionId": response.gameSessionId,
        "playerSecret": response.playerSecret,
        "playerSessionId": response.playerSessionId
      };

      // Add userId and accessToken if authenticated
      if (isAuthenticated) {
        navigationParams["userId"] = response.userId;
        navigationParams["accessToken"] = this.authService.getAccessToken();
      }

      this.router.navigate(["/game", navigationParams])
        .then(r => console.log(r));
    });
  }

  
}
