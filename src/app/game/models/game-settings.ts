import {ProctorType} from "../enum/proctor-type";
import {GameMode} from "../enum/game-mode";

export class GameSettings {
  proctorType: ProctorType;
  gameMode: GameMode;
  numPlayers: number;
  numTeams: number;

  constructor() {
    this.proctorType = ProctorType.NO_PROCTOR; // Default value
    this.gameMode = GameMode.QUIZ_BOWL_CLASSIC; // Default value
    this.numPlayers = 0;
    this.numTeams = 0;
  }
}
