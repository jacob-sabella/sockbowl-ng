import {GameSettings} from "../game-settings";

export class CreateGameRequest {
  gameSettings: GameSettings;

  constructor() {
    this.gameSettings = new GameSettings();
  }
}
