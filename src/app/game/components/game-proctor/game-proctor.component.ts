import {Component, OnInit} from '@angular/core';
import {Observable} from 'rxjs';
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
export class GameProctorComponent implements OnInit {

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;

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
    });
  }

  /**
   * Gets the tossup timer display value from server.
   */
  getTossupTimerDisplay(): number | null {
    return this.gameSession?.currentMatch?.currentRound?.remainingTossupTimerSeconds ?? null;
  }

  /**
   * Gets the bonus timer display value from server.
   */
  getBonusTimerDisplay(): number | null {
    return this.gameSession?.currentMatch?.currentRound?.remainingBonusTimerSeconds ?? null;
  }

  /**
   * Checks if auto-timer is enabled in game settings.
   */
  isAutoTimerEnabled(): boolean {
    return this.gameSession?.gameSettings?.timerSettings?.autoTimerEnabled ?? true;
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
