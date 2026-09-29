import {Component, DestroyRef, HostListener, inject, OnInit, ChangeDetectionStrategy, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Observable, Subscription} from 'rxjs';
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
   * quiet (M5 S2-21). M5 S2-30: the copy is deliberately provisional
   * ("Sending: Ada correct…"), never "marked correct" — the send hasn't
   * been confirmed by a server frame yet.
   */
  readonly pendingVerdictMessage = signal<string | null>(null);

  /**
   * M5 S2-30: set when a judgment's pending latch clears on its own (a
   * bounded timeout, an error frame, or a reconnect) with no RoundState or
   * buzz change to show for it — i.e. the send was probably lost. Shown in
   * the status banner in place of the pending/prompt copy until the proctor
   * judges again (or a real frame arrives). A lost frame never freezes the
   * decision row: judgmentPending is already false by the time this shows.
   */
  readonly pendingRecoveryMessage = signal<string | null>(null);

  /** How long a judgment may sit pending before it's treated as lost (M5 S2-30). */
  private static readonly JUDGMENT_PENDING_TIMEOUT_MS = 5000;
  private judgmentPendingTimer: ReturnType<typeof setTimeout> | null = null;
  private judgmentErrorsSub: Subscription | null = null;

  /**
   * M5 S2-31: a short lockout after every state-changing send (advance,
   * finished reading, tossup/bonus timeout), so a double Space/Enter/T can't
   * also fire the *next* round's action once the server frame from the
   * first send arrives a few hundred ms later. Shorter than the judgment
   * timeout above: these aren't a call that can go stale, just a repeat
   * within one round-trip.
   */
  private static readonly ACTION_LOCKOUT_MS = 600;
  private actionLockoutTimer: ReturnType<typeof setTimeout> | null = null;
  readonly actionLockedOut = signal(false);

  // Cast-related observables
  castAvailable$: Observable<boolean>;
  castConnectionState$: Observable<PresentationConnectionState>;

  private destroyRef = inject(DestroyRef);

  constructor() {
    this.gameSessionObs = this.gameStateService.gameSession$;
    this.castAvailable$ = this.presentationConnectionService.isAvailable$;
    this.castConnectionState$ = this.presentationConnectionService.connectionState$;
    this.destroyRef.onDestroy(() => {
      this.clearJudgmentPendingGuard();
      if (this.actionLockoutTimer) {
        clearTimeout(this.actionLockoutTimer);
        this.actionLockoutTimer = null;
      }
    });
  }

  ngOnInit(): void {
    this.gameSessionObs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(gameSession => {
      const previousRoundState = this.gameSession?.currentMatch?.currentRound?.roundState;
      const previousBuzzId = this.gameSession?.currentMatch?.currentRound?.currentBuzz?.playerId;
      this.gameSession = gameSession;
      const nextRoundState = gameSession?.currentMatch?.currentRound?.roundState;
      const nextBuzzId = gameSession?.currentMatch?.currentRound?.currentBuzz?.playerId;
      if (nextRoundState !== previousRoundState || nextBuzzId !== previousBuzzId) {
        // A real server frame moved the round on: whatever judgment was
        // pending is confirmed (or superseded), and any stale recovery
        // line from an earlier lost send no longer applies (M5 S2-30).
        this.clearJudgmentPendingGuard();
        this.judgmentPending.set(false);
        this.pendingVerdictMessage.set(null);
        this.pendingRecoveryMessage.set(null);
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
   * (held-down) keydown, a dialog open anywhere in the app (a proctor
   * confirming something in a dialog must not also fire a judgment behind
   * it), or a keydown that's already the browser's native activation of a
   * focused interactive element (a button, the tossup-recap `<summary>`,
   * a link, an ARIA button/menuitem/tab/option, or anything inside an open
   * CDK overlay/menu). Without this, Space/Enter on the cast button or the
   * recap disclosure double-fires: once as that element's own click, once
   * as this component's judge action (M5 S2-19).
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
    if (target?.closest?.(
      'button, summary, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], .cdk-overlay-container',
    )) {
      return true;
    }
    return document.querySelector('mat-dialog-container') !== null;
  }

  /* ------------------------- shared action + announce methods ------------------------- *
   * Both the judge keys above and the template's (click) handlers call
   * these, so a judgment is announced through aria-live the same way no
   * matter how the proctor triggered it. */

  finishedReading(): void {
    this.withActionLockout(() => this.gameStateService.sendFinishedReading());
  }

  advanceRound(): void {
    this.withActionLockout(() => this.gameStateService.sendAdvanceRound());
  }

  finishedReadingBonusPreamble(): void {
    this.withActionLockout(() => this.gameStateService.sendFinishedReadingBonusPreamble());
  }

  finishedReadingBonusPart(): void {
    this.withActionLockout(() => this.gameStateService.sendFinishedReadingBonusPart());
  }

  timeoutTossup(): void {
    this.withActionLockout(() => {
      this.gameStateService.sendTimeoutRound();
      this.announce('Tossup timed out with no buzz.');
    });
  }

  timeoutBonusPart(): void {
    if (this.judgmentPending()) {
      return;
    }
    this.withActionLockout(() => {
      const partIndex = this.gameSession?.currentMatch?.currentRound?.currentBonusPartIndex ?? 0;
      this.gameStateService.sendTimeoutBonusPart();
      this.announce(`Bonus part ${partIndex + 1} timed out.`);
    });
  }

  /**
   * M5 S2-31: runs a state-changing send at most once per
   * {@link ACTION_LOCKOUT_MS}, so a second key press or click that lands
   * before the resulting server frame arrives is a silent no-op rather than
   * also firing on whatever the *next* RoundState turns out to be.
   */
  private withActionLockout(send: () => void): void {
    if (this.actionLockedOut()) {
      return;
    }
    this.actionLockedOut.set(true);
    send();
    if (this.actionLockoutTimer) {
      clearTimeout(this.actionLockoutTimer);
    }
    this.actionLockoutTimer = setTimeout(() => {
      this.actionLockoutTimer = null;
      this.actionLockedOut.set(false);
    }, GameProctorComponent.ACTION_LOCKOUT_MS);
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
    this.pendingRecoveryMessage.set(null);
    if (correct) {
      this.gameStateService.sendAnswerCorrect();
    } else {
      this.gameStateService.sendAnswerIncorrect();
    }
    const verdict = `Sending: ${playerName || 'Player'} ${correct ? 'correct' : 'incorrect'}…`;
    this.pendingVerdictMessage.set(verdict);
    this.announce(verdict);
    this.armJudgmentPendingGuard();
  }

  judgeBonusPart(correct: boolean): void {
    if (this.judgmentPending()) {
      return;
    }
    const partIndex = this.gameSession?.currentMatch?.currentRound?.currentBonusPartIndex ?? 0;
    this.judgmentPending.set(true);
    this.pendingRecoveryMessage.set(null);
    this.sendBonusPartOutcome(partIndex, correct);
    const verdict = `Sending: bonus part ${partIndex + 1} ${correct ? 'correct' : 'incorrect'}…`;
    this.pendingVerdictMessage.set(verdict);
    this.announce(verdict);
    this.armJudgmentPendingGuard();
  }

  /**
   * M5 S2-30: arms the bounded recovery path for the judgment just sent.
   * `gameSession$`'s own subscription (ngOnInit) is the "happy path" clear,
   * when a real RoundState/buzz change confirms the send; this is the
   * unhappy path, for when that frame never comes (or comes back as an
   * error): a lost send must not leave Right/Wrong/Timeout dead until a
   * reload.
   */
  private armJudgmentPendingGuard(): void {
    this.clearJudgmentPendingGuard();
    this.judgmentPendingTimer = setTimeout(
      () => this.recoverFromLostJudgment(),
      GameProctorComponent.JUDGMENT_PENDING_TIMEOUT_MS,
    );
    // Any error the proctor's socket receives while a judgment is in flight
    // - a rejected send, a RATE_LIMITED soft drop, or the reconnect that
    // follows a dropped connection - can't be correlated to this specific
    // send, so any of them is treated as "this judgment may be lost" (the
    // contract's "on any error frame the proctor receives").
    this.judgmentErrorsSub = this.gameStateService.errors$.subscribe(() => this.recoverFromLostJudgment());
  }

  private clearJudgmentPendingGuard(): void {
    if (this.judgmentPendingTimer) {
      clearTimeout(this.judgmentPendingTimer);
      this.judgmentPendingTimer = null;
    }
    this.judgmentErrorsSub?.unsubscribe();
    this.judgmentErrorsSub = null;
  }

  /**
   * M5 S2-30: clears a judgment latch that never got confirmed by a real
   * frame. The row comes back to life (judgmentPending false) and the
   * banner shows one plain recovery line instead of the stale "Sending…"
   * copy, so the proctor knows to judge again rather than assuming the
   * verdict landed.
   */
  private recoverFromLostJudgment(): void {
    if (!this.judgmentPending()) {
      return;
    }
    this.clearJudgmentPendingGuard();
    this.judgmentPending.set(false);
    this.pendingVerdictMessage.set(null);
    const recovery = "Didn't reach the server. Judge again.";
    this.pendingRecoveryMessage.set(recovery);
    this.announce(recovery);
  }

  private announce(message: string): void {
    this.liveAnnouncement.set(message);
  }

  protected readonly RoundState = RoundState;
  protected readonly PresentationConnectionState = PresentationConnectionState;
}
