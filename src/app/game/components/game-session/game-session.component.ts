import { Component } from '@angular/core';
import {CreateGameRequest} from "../../models/http/create-game-request";
import {JoinGameRequest} from "../../models/http/join-game-request";
import {GameSessionService} from "../../services/game-session.service";
import {GameMode} from "../../enum/game-mode";
import {ProctorType} from "../../enum/proctor-type";


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

  constructor(private gameSessionService: GameSessionService) {}

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
      // Handle successful game creation, perhaps by navigating to the game session
    });
  }

  submitJoinGame(): void {
    this.gameSessionService.joinGame(this.joinGameRequest).subscribe(response => {
      // Handle successful game join, perhaps by navigating to the game session
    });
  }
}
