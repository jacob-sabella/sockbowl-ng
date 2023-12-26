import {Component} from '@angular/core';
import {Observable} from "rxjs";
import {GameSession, RoundState} from "../../models/sockbowl/sockbowl-interfaces";
import {GameStateService} from "../../services/game-state.service";

@Component({
  selector: 'app-game-proctor',
  templateUrl: './game-proctor.component.html',
  styleUrls: ['./game-proctor.component.scss']
})
export class GameProctorComponent {

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

  protected readonly RoundState = RoundState;
}
