import {Component, DestroyRef, HostListener, inject, OnInit, ChangeDetectionStrategy, signal} from '@angular/core';
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

  /**
   * M5 S2-05: a visually-hidden `aria-live="assertive"` region announces
   * every judgment/timeout/advance, whether triggered by a judge key or a
   * click, so a screen-reader proctor hears the outcome without having to
   * find it on screen.
   */
  readonly liveAnnouncement = signal('');

  /**
   * M5 S2-21: set the instant a judgment (tossup or bonus part) is sent,
   * and cleared only when the RoundState or the current buzz actually
   * changes underneath it. While true, the decision row's judging buttons
   * are disabled and the judge keys no-op, so a second click or key press
   * (or a click racing a key) can't send the same judgment twice before the
   * next server frame arrives.
   */
  readonly judgmentPending = signal(false);

  /**
   * The verdict just sent, shown in the status banner in place of the
   * "Judge the..." prompt for as long as judgmentPending is true, so the
   * proctor sees visible confirmation instead of the buttons just going
   * quiet (M5 S2-21).
   */
  readonly pendingVerdictMessage = signal<string | null>(null);

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
      const previousRoundState = this.gameSession?.currentMatch?.currentRound?.roundState;
      const previousBuzzId = this.gameSession?.currentMatch?.currentRound?.currentBuzz?.playerId;
      this.gameSession = gameSession;
      if (this.judgmentPending()) {
        const nextRoundState = gameSession?.currentMatch?.currentRound?.roundState;
        const nextBuzzId = gameSession?.currentMatch?.currentRound?.currentBuzz?.playerId;
        if (nextRoundState !== previousRoundState || nextBuzzId !== previousBuzzId) {
          this.judgmentPending.set(false);
          this.pendingVerdictMessage.set(null);
        }
      }
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

  /* --------------------------- judge keyboard shortcuts (M5 S2-05) ---------------------------- *
   * Space/Enter = the one primary action due right now, R/W = tossup or
   * bonus-part judgment, T = timeout. Each key only acts on the action
   * that's actually valid for the current RoundState, so a stray press
   * elsewhere in the app can never fire a judgment. */

  @HostListener('document:keydown.space', ['$event'])
  @HostListener('document:keydown.enter', ['$event'])
  onPrimaryKey(event: Event): void {
    if (this.shouldIgnoreKeyboardShortcut(event)) {
      return;
    }
    switch (this.gameSession?.currentMatch?.currentRound?.roundState) {
      case RoundState.PROCTOR_READING:
        event.preventDefault();
        this.finishedReading();
        break;
      case RoundState.COMPLETED:
        event.preventDefault();
        this.advanceRound();
        break;
      case RoundState.BONUS_READING_PREAMBLE:
        event.preventDefault();
        this.finishedReadingBonusPreamble();
        break;
      case RoundState.BONUS_READING_PART:
        event.preventDefault();
        this.finishedReadingBonusPart();
        break;
      default:
        break;
    }
  }

  @HostListener('document:keydown.r', ['$event'])
  onRightKey(event: Event): void {
    if (this.shouldIgnoreKeyboardShortcut(event)) {
      return;
    }
    const roundState = this.gameSession?.currentMatch?.currentRound?.roundState;
    if (roundState === RoundState.AWAITING_ANSWER) {
      event.preventDefault();
      this.judgeTossup(true);
    } else if (roundState === RoundState.BONUS_AWAITING_ANSWER) {
      event.preventDefault();
      this.judgeBonusPart(true);
    }
  }

  @HostListener('document:keydown.w', ['$event'])
  onWrongKey(event: Event): void {
    if (this.shouldIgnoreKeyboardShortcut(event)) {
      return;
    }
    const roundState = this.gameSession?.currentMatch?.currentRound?.roundState;
    if (roundState === RoundState.AWAITING_ANSWER) {
      event.preventDefault();
      this.judgeTossup(false);
    } else if (roundState === RoundState.BONUS_AWAITING_ANSWER) {
      event.preventDefault();
      this.judgeBonusPart(false);
    }
  }

  @HostListener('document:keydown.t', ['$event'])
  onTimeoutKey(event: Event): void {
    if (this.shouldIgnoreKeyboardShortcut(event)) {
      return;
    }
    const roundState = this.gameSession?.currentMatch?.currentRound?.roundState;
    if (roundState === RoundState.AWAITING_BUZZ) {
      event.preventDefault();
      this.timeoutTossup();
    } else if (roundState === RoundState.BONUS_AWAITING_ANSWER) {
      event.preventDefault();
      this.timeoutBonusPart();
    }
  }

  /**
   * True while a judge key must not act: typing in a field, a repeated
   * (held-down) keydown, or a dialog open anywhere in the app (a proctor
   * confirming something in a dialog must not also fire a judgment behind
   * it).
   */
  private shouldIgnoreKeyboardShortcut(event: Event): boolean {
    if ((event as KeyboardEvent).repeat) {
      return true;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' || target.isContentEditable)) {
      return true;
    }
    return document.querySelector('mat-dialog-container') !== null;
  }

  /* ------------------------- shared action + announce methods ------------------------- *
   * Both the judge keys above and the template's (click) handlers call
   * these, so a judgment is announced through aria-live the same way no
   * matter how the proctor triggered it. */

  finishedReading(): void {
    this.gameStateService.sendFinishedReading();
  }

  advanceRound(): void {
    this.gameStateService.sendAdvanceRound();
  }

  finishedReadingBonusPreamble(): void {
    this.gameStateService.sendFinishedReadingBonusPreamble();
  }

  finishedReadingBonusPart(): void {
    this.gameStateService.sendFinishedReadingBonusPart();
  }

  timeoutTossup(): void {
    this.gameStateService.sendTimeoutRound();
    this.announce('Tossup timed out with no buzz.');
  }

  timeoutBonusPart(): void {
    if (this.judgmentPending()) {
      return;
    }
    const partIndex = this.gameSession?.currentMatch?.currentRound?.currentBonusPartIndex ?? 0;
    this.gameStateService.sendTimeoutBonusPart();
    this.announce(`Bonus part ${partIndex + 1} timed out.`);
  }

  /** M5 S2-21: guards both judging methods against a second send (a race
   * between a click and a key, or two rapid key presses) before the next
   * gameSession$ frame moves the RoundState or clears the buzz. */
  judgeTossup(correct: boolean): void {
    if (this.judgmentPending()) {
      return;
    }
    const buzz = this.gameSession?.currentMatch?.currentRound?.currentBuzz;
    const playerName = buzz ? this.gameStateService.getPlayerNameById(buzz.playerId) : '';
    this.judgmentPending.set(true);
    if (correct) {
      this.gameStateService.sendAnswerCorrect();
    } else {
      this.gameStateService.sendAnswerIncorrect();
    }
    const verdict = `${playerName || 'Player'} marked ${correct ? 'correct' : 'incorrect'}.`;
    this.pendingVerdictMessage.set(verdict);
    this.announce(verdict);
  }

  judgeBonusPart(correct: boolean): void {
    if (this.judgmentPending()) {
      return;
    }
    const partIndex = this.gameSession?.currentMatch?.currentRound?.currentBonusPartIndex ?? 0;
    this.judgmentPending.set(true);
    this.sendBonusPartOutcome(partIndex, correct);
    const verdict = `Bonus part ${partIndex + 1} marked ${correct ? 'correct' : 'incorrect'}.`;
    this.pendingVerdictMessage.set(verdict);
    this.announce(verdict);
  }

  private announce(message: string): void {
    this.liveAnnouncement.set(message);
  }

  protected readonly RoundState = RoundState;
  protected readonly PresentationConnectionState = PresentationConnectionState;
}
