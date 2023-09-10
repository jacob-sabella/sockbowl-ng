import {JoinStatus} from "../../enum/join-status";

export class JoinGameResponse {
  joinStatus: JoinStatus;
  gameSessionId: string;
  playerSecret: string;
  playerSessionId: string;

  constructor(
    joinStatus: JoinStatus = JoinStatus.SUCCESS,
    gameSessionId: string = '',
    playerSecret: string = '',
    playerSessionId: string = ''
  ) {
    this.joinStatus = joinStatus;
    this.gameSessionId = gameSessionId;
    this.playerSecret = playerSecret;
    this.playerSessionId = playerSessionId;
  }
}
