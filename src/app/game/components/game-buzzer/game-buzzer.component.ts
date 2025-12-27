import {Component, OnDestroy, OnInit} from '@angular/core';
import {Observable, Subscription, timer} from 'rxjs';
import {take, map} from 'rxjs/operators';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';

@Component({
  selector: 'app-game-buzzer',
  templateUrl: './game-buzzer.component.html',
  styleUrls: ['./game-buzzer.component.scss']
})
export class GameBuzzerComponent implements OnInit, OnDestroy {

  protected readonly RoundState = RoundState;

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;
  countdownSubscription!: Subscription;
  countdown!: number;
  bonusCountdown!: number;
  bonusTimerSubscription!: Subscription;

  constructor(public gameStateService: GameStateService) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  /**
   * OnInit lifecycle hook to subscribe to the game session observable
   */
  ngOnInit(): void {
    this.gameSessionObs.subscribe(gameSession => {
      this.gameSession = gameSession;

      // Handle tossup timer
      if (gameSession.currentMatch.currentRound.roundState === RoundState.AWAITING_BUZZ) {
        this.startTimer();
      } else {
        this.stopTimer();
      }

      // Handle bonus timer
      if (gameSession.currentMatch.currentRound.roundState === RoundState.BONUS_AWAITING_ANSWER) {
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

    // Check if a timer is already running, if so, stop it
    if (this.countdownSubscription) {
      this.countdownSubscription.unsubscribe();
    }

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
        this.stopBonusTimer();
      }
    });
  }

  stopBonusTimer(): void {
    if (this.bonusTimerSubscription) {
      this.bonusTimerSubscription.unsubscribe();
    }
  }

  getBuzzButtonText(): string {
    return this.gameStateService.hasCurrentPlayerTeamBuzzed() ? 'Team already buzzed' : 'Buzz!';
  }

  getCurrentBonusPart(): any {
    const bonus = this.gameSession?.currentMatch?.currentRound?.currentBonus;
    const partIndex = this.gameSession?.currentMatch?.currentRound?.currentBonusPartIndex;

    if (!bonus || !bonus.bonusParts || partIndex === undefined) {
      return null;
    }

    return bonus.bonusParts[partIndex];
  }

  getBonusEligibleTeamName(): string {
    const teamId = this.gameSession?.currentMatch?.currentRound?.bonusEligibleTeamId;
    return teamId ? (this.gameStateService.getTeamNameById(teamId) || '') : '';
  }

}
