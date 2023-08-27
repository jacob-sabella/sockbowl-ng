import {JoinStatus} from "../../enum/join-status";

export class JoinGameResponse {
  joinStatus: JoinStatus;
  gameSessionId: string;
  playerSecret: string;

  constructor(
    joinStatus: JoinStatus = JoinStatus.SUCCESS,
    gameSessionId: string = '',
    playerSecret: string = ''
  ) {
    this.joinStatus = joinStatus;
    this.gameSessionId = gameSessionId;
    this.playerSecret = playerSecret;
  }
}
