import {Component, OnInit, OnDestroy} from '@angular/core';
import {Observable, Subscription, timer} from 'rxjs';
import {take, map} from 'rxjs/operators';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';
import {PresentationConnectionService} from '../../services/presentation-connection.service';
import {CastStateService} from '../../services/cast-state.service';
import {PresentationConnectionState} from '../../models/cast-interfaces';

@Component({
    selector: 'app-game-proctor',
    templateUrl: './game-proctor.component.html',
    styleUrls: ['./game-proctor.component.scss'],
    standalone: false
})
export class GameProctorComponent implements OnInit, OnDestroy {

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;
  countdownSubscription!: Subscription;
  countdown!: number;
  bonusCountdown!: number;
  bonusTimerSubscription!: Subscription;
  isAutoTimerActive: boolean = true;

  // Cast-related observables
  castAvailable$: Observable<boolean>;
  castConnectionState$: Observable<PresentationConnectionState>;

  constructor(
    public gameStateService: GameStateService,
    private presentationConnectionService: PresentationConnectionService,
    private castStateService: CastStateService // Injecting initializes state subscription
  ) {
    this.gameSessionObs = this.gameStateService.gameSession$;
    this.castAvailable$ = this.presentationConnectionService.isAvailable$;
    this.castConnectionState$ = this.presentationConnectionService.connectionState$;
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

  getCurrentBonusPart(bonus: any, partIndex: number): any {
    console.log('[GameProctorComponent] getCurrentBonusPart called');
    console.log('[GameProctorComponent] bonus:', bonus);
    console.log('[GameProctorComponent] partIndex:', partIndex);
    console.log('[GameProctorComponent] bonusParts:', bonus?.bonusParts);

    if (!bonus || !bonus.bonusParts || partIndex === undefined || partIndex === null) {
      console.log('[GameProctorComponent] Returning null - missing data');
      return null;
    }

    const currentPart = bonus.bonusParts[partIndex];
    console.log('[GameProctorComponent] Returning part:', currentPart);

    // Handle nested structure: if part has bonusPart property, return that, otherwise return the part itself
    return currentPart?.bonusPart || currentPart;
  }

  sendBonusPartOutcome(partIndex: number, correct: boolean): void {
    this.gameStateService.sendBonusPartOutcome(partIndex, correct);
  }

  getBonusEligibleTeamName(): string {
    const teamId = this.gameSession?.currentMatch?.currentRound?.bonusEligibleTeamId;
    return teamId ? (this.gameStateService.getTeamNameById(teamId) || '') : '';
  }

  /**
   * Initiates casting to a presentation device.
   * Opens the browser's device picker for the user to select a cast target.
   */
  startCasting(): void {
    this.presentationConnectionService.startPresentation();
  }

  /**
   * Stops the active casting session.
   */
  stopCasting(): void {
    this.presentationConnectionService.stopPresentation();
  }

  protected readonly RoundState = RoundState;
  protected readonly PresentationConnectionState = PresentationConnectionState;
}
