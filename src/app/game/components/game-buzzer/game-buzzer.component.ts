import {Component} from '@angular/core';
import {Observable, Subscription, timer} from 'rxjs';
import {take, map} from 'rxjs/operators';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';

@Component({
  selector: 'app-game-buzzer',
  templateUrl: './game-buzzer.component.html',
  styleUrls: ['./game-buzzer.component.scss']
})
export class GameBuzzerComponent {

  protected readonly RoundState = RoundState;

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;
  countdownSubscription!: Subscription;
  countdown!: number;

  constructor(public gameStateService: GameStateService) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  /**
   * OnInit lifecycle hook to subscribe to the game session observable
   */
  ngOnInit(): void {
    this.gameSessionObs.subscribe(gameSession => {
      this.gameSession = gameSession;

      if (gameSession.currentMatch.currentRound.roundState === RoundState.AWAITING_BUZZ) {
        this.startTimer();
      } else {
        this.stopTimer();
      }
    });
  }

  startTimer(): void {
    const countdownTime = 6; // seconds
    this.countdown = countdownTime;

    this.countdownSubscription = timer(0, 1000).pipe(
      take(countdownTime + 1),
      map(() => --this.countdown)
    ).subscribe(val => {
      if (val === 0) {
        console.log('Timer up');
        // Add any additional functionality here if needed when the timer is up
        this.stopTimer();
      }
    });
  }

  stopTimer(): void {
    if (this.countdownSubscription) {
      this.countdownSubscription.unsubscribe();
    }
  }

  getBuzzButtonText(): string {
    return this.gameStateService.hasCurrentPlayerTeamBuzzed() ? 'Team already buzzed' : 'Buzz!';
  }

}
