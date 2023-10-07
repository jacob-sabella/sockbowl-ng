import {GameSettings} from "../state/sockbowl-interfaces";

export class CreateGameRequest {
  gameSettings: GameSettings;

  constructor() {
    this.gameSettings = <GameSettings>{};
  }
}
