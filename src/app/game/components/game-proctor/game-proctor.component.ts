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
  bonusCountdown!: number;
  bonusTimerSubscription!: Subscription;
  isAutoTimerActive: boolean = true;

  constructor(public gameStateService: GameStateService) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  ngOnInit(): void {
    this.gameSessionObs.subscribe(gameSession => {
      this.gameSession = gameSession;

      // Handle tossup timer
      if (this.isAutoTimerActive && gameSession.currentMatch.currentRound.roundState === RoundState.AWAITING_BUZZ) {
        this.startTimer();
      } else {
        this.stopTimer();
      }

      // Handle bonus timer
      if (this.isAutoTimerActive && gameSession.currentMatch.currentRound.roundState === RoundState.BONUS_AWAITING_ANSWER) {
        this.startBonusTimer();
      } else {
        this.stopBonusTimer();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.stopBonusTimer();
  }

  startTimer(): void {
    // Stop any existing timer first to prevent overlapping subscriptions
    this.stopTimer();

    const countdownTime = 5; // seconds

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

  startBonusTimer(): void {
    // Stop any existing timer first to prevent overlapping subscriptions
    this.stopBonusTimer();

    const countdownTime = 5; // seconds

    this.bonusCountdown = countdownTime;

    this.bonusTimerSubscription = timer(0, 1000).pipe(
      take(countdownTime + 1),
      map(() => --this.bonusCountdown)
    ).subscribe(val => {
      if (val === 0) {
        console.log('Bonus timer up');
        this.gameStateService.sendTimeoutBonusPart();
        this.stopBonusTimer();
      }
    });
  }

  stopBonusTimer(): void {
    if (this.bonusTimerSubscription) {
      this.bonusTimerSubscription.unsubscribe();
    }
  }

  getCurrentBonusPart(): any {
    const bonus = this.gameSession?.currentMatch?.currentRound?.currentBonus;
    const partIndex = this.gameSession?.currentMatch?.currentRound?.currentBonusPartIndex;

    if (!bonus || !bonus.bonusParts || partIndex === undefined) {
      return null;
    }

    return bonus.bonusParts[partIndex];
  }

  sendBonusPartOutcome(partIndex: number, correct: boolean): void {
    this.gameStateService.sendBonusPartOutcome(partIndex, correct);
  }

  getBonusEligibleTeamName(): string {
    const teamId = this.gameSession?.currentMatch?.currentRound?.bonusEligibleTeamId;
    return teamId ? (this.gameStateService.getTeamNameById(teamId) || '') : '';
  }

  protected readonly RoundState = RoundState;
}
