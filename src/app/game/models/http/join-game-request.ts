import {PlayerMode} from "../../enum/player-mode";

export class JoinGameRequest {
  playerSessionId: string;
  joinCode: string;
  name: string;
  playerMode: PlayerMode;

  constructor(
    playerSessionId: string = '',
    joinCode: string = '',
    name: string = '',
    playerMode: PlayerMode = PlayerMode.SPECTATOR
  ) {
    this.playerSessionId = playerSessionId;
    this.joinCode = joinCode;
    this.name = name;
    this.playerMode = playerMode;
  }
}
