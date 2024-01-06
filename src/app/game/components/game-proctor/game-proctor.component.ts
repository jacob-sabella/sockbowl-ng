import {Component, OnInit, OnDestroy} from '@angular/core';
import {Observable, Subscription, timer} from 'rxjs';
import {take, map} from 'rxjs/operators';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';

@Component({
  selector: 'app-game-proctor',
  templateUrl: './game-proctor.component.html',
  styleUrls: ['./game-proctor.component.scss']
})
export class GameProctorComponent implements OnInit, OnDestroy {

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;
  countdownSubscription!: Subscription;
  countdown!: number;
  isAutoTimerActive: boolean = true;

  constructor(public gameStateService: GameStateService) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  ngOnInit(): void {
    this.gameSessionObs.subscribe(gameSession => {
      this.gameSession = gameSession;

      if (this.isAutoTimerActive && gameSession.currentMatch.currentRound.roundState === RoundState.AWAITING_BUZZ) {
        this.startTimer();
      } else {
        this.stopTimer();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopTimer();
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
        this.gameStateService.sendTimeoutRound()
        this.stopTimer();
      }
    });
  }

  stopTimer(): void {
    if (this.countdownSubscription) {
      this.countdownSubscription.unsubscribe();
    }
  }

  protected readonly RoundState = RoundState;
}
