import {Component} from '@angular/core';
import {CreateGameRequest} from "../../models/http/create-game-request";
import {JoinGameRequest} from "../../models/http/join-game-request";
import {GameSessionService} from "../../services/game-session.service";
import {GameMode} from "../../enum/game-mode";
import {ProctorType} from "../../enum/proctor-type";
import {PlayerMode} from "../../enum/player-mode";
import {Router} from "@angular/router";


@Component({
  selector: 'app-game-session',
  templateUrl: './game-session.component.html',
  styleUrls: ['./game-session.component.scss']
})
export class GameSessionComponent {
  showCreateForm = false;
  showJoinForm = false;

  createGameRequest: CreateGameRequest = new CreateGameRequest();
  joinGameRequest: JoinGameRequest = new JoinGameRequest();

  ProctorTypes = ProctorType;
  GameModes = GameMode;
  PlayerModes = PlayerMode;

  constructor(private gameSessionService: GameSessionService, private router: Router) {
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
    this.gameSessionService.joinGame(this.joinGameRequest).subscribe(response => {
      console.log("Join game response");
      console.log(response);

      this.router.navigate(
        ["/game", {
          "gameSessionId": response.gameSessionId, "playerSecret": response.playerSecret,
          "playerSessionId": response.playerSessionId
        }]
      ).then(r => console.log(r));

    });
  }
}
