import {Component, DestroyRef, inject, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
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
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class GameProctorComponent implements OnInit {
  gameStateService = inject(GameStateService);
  private presentationConnectionService = inject(PresentationConnectionService);
  private castStateService = inject(CastStateService);


  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;

  // Cast-related observables
  castAvailable$: Observable<boolean>;
  castConnectionState$: Observable<PresentationConnectionState>;

  private destroyRef = inject(DestroyRef);

  constructor() {
    this.gameSessionObs = this.gameStateService.gameSession$;
    this.castAvailable$ = this.presentationConnectionService.isAvailable$;
    this.castConnectionState$ = this.presentationConnectionService.connectionState$;
  }

  ngOnInit(): void {
    this.gameSessionObs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(gameSession => {
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
    if (!bonus || !bonus.bonusParts || partIndex === undefined || partIndex === null) {
      return null;
    }

    const currentPart = bonus.bonusParts[partIndex];

    // Handle nested structure: if part has bonusPart property, return that, otherwise return the part itself
    return currentPart?.bonusPart || currentPart;
  }

  /**
   * True for every BONUS_* state (M5 S2-06). The template uses it to
   * collapse the tossup Q/A to a one-line summary once the bonus starts, so
   * the pinned decision row stays reachable without a scroll at 1366x768.
   */
  isBonusPhase(roundState: RoundState | undefined): boolean {
    return roundState === RoundState.BONUS_PENDING ||
      roundState === RoundState.BONUS_READING_PREAMBLE ||
      roundState === RoundState.BONUS_READING_PART ||
      roundState === RoundState.BONUS_AWAITING_ANSWER ||
      roundState === RoundState.BONUS_COMPLETED;
  }

  sendBonusPartOutcome(partIndex: number, correct: boolean): void {
    this.gameStateService.sendBonusPartOutcome(partIndex, correct);
  }

  getBonusEligibleTeamName(): string {
    const teamId = this.gameSession?.currentMatch?.currentRound?.bonusEligibleTeamId;
    return teamId ? (this.gameStateService.getTeamNameById(teamId) || '') : '';
  }

  /**
   * Points a single bonus part is worth, derived from the same source as
   * the header's own maximum (M5 S2-13) rather than a hardcoded "10 pts" in
   * four separate template spots, so the two labels can never disagree.
   * Falls back to the classic 10 before the current bonus's part count is
   * known (mirrors GameStateService.getCurrentRoundMaxBonusPoints).
   */
  getBonusPartPointValue(): number {
    const partCount = this.gameSession?.currentMatch?.currentRound?.currentBonus?.bonusParts?.length;
    if (!partCount) {
      return 10;
    }
    return this.gameStateService.getCurrentRoundMaxBonusPoints() / partCount;
  }

  /**
   * Total tossups in the packet, when the server has sent it. Only a
   * length-only tossups array is sent (anti-spoiler; see
   * GameStateService's MatchPacketUpdate handling), so this reads
   * packet.tossups.length rather than exposing questions. Returns null
   * before the packet is set (or in modes that never send it), so the
   * template can omit "Tossup N of M" and fall back to "Round N" instead of
   * showing a bogus total (M5 S2-09; backend follow-up recorded for modes
   * that don't carry this).
   */
  getTotalTossupCount(): number | null {
    const count = this.gameSession?.currentMatch?.packet?.tossups?.length;
    return count && count > 0 ? count : null;
  }

  /** The 1-based position of the round now playing. */
  getTossupPosition(): number | null {
    return this.gameSession?.currentMatch?.currentRound?.roundNumber ?? null;
  }

  /** Whether the round now playing is the last tossup in the packet. */
  isLastTossup(): boolean {
    const total = this.getTotalTossupCount();
    const position = this.getTossupPosition();
    return !!total && !!position && position === total;
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
