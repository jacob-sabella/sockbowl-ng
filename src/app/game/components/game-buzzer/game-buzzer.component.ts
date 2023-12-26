import {Component} from '@angular/core';
import {GameStateService} from "../../services/game-state.service";
import {Observable} from "rxjs";
import {GameSession, RoundState} from "../../models/sockbowl/sockbowl-interfaces";

@Component({
  selector: 'app-game-buzzer',
  templateUrl: './game-buzzer.component.html',
  styleUrls: ['./game-buzzer.component.scss']
})
export class GameBuzzerComponent {

  protected readonly RoundState = RoundState;

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;

  constructor(public gameStateService: GameStateService) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  /**
   * OnInit lifecycle hook to subscribe to the game session observable
   */
  ngOnInit(): void {
    this.gameSessionObs.subscribe(gameSession => {
      this.gameSession = gameSession;
    });
  }

  getBuzzButtonText(): string {
    return this.gameStateService.hasCurrentPlayerTeamBuzzed() ? 'Team already buzzed' : 'Buzz!';
  }

}
