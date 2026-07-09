import {Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {Subscription} from 'rxjs';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';
import {SpeechService} from '../../services/speech.service';

/**
 * Auto-proctor multiplayer play surface: the tossup auto-reveals word-by-word;
 * any player buzzes (server-authoritative — first buzz locks and stops the read
 * for everyone); the buzzed-in player types an answer the judge scores; a wrong
 * answer returns play to the other teams, a right one scores and the host
 * advances. No human proctor.
 */
@Component({
  selector: 'app-game-auto-proctor',
  templateUrl: './game-auto-proctor.component.html',
  styleUrls: ['./game-auto-proctor.component.scss'],
  standalone: false
})
export class GameAutoProctorComponent implements OnInit, OnDestroy {

  protected readonly RoundState = RoundState;
  private static readonly SPEED_KEY = 'sockbowl_reading_speed';
  private static readonly READER_KEY = 'ap_reader_mode';

  @ViewChild('answerInput') answerInput?: ElementRef<HTMLInputElement>;

  gameSession!: GameSession;
  answerText = '';
  readingSpeed = 5;

  /**
   * "Reader" role: when this device opts in, it reads the tossup aloud for the whole
   * room (a shared TV / Discord stream). Off by default so individual phones stay
   * silent — only the designated screen speaks. The text always reveals at a fixed rate.
   */
  readerMode = false;

  words: string[] = [];
  revealedCount = 0;

  /** Seconds shown on the "next tossup in…" pause after a round completes. */
  private static readonly ADVANCE_DELAY = 6;
  advanceSecondsLeft: number | null = null;

  /** Fallback grace window (seconds) to buzz once the read finishes, when no tossup timer is configured. */
  private static readonly BUZZ_WINDOW_FALLBACK = 8;
  buzzSecondsLeft: number | null = null;
  /** True once the buzz window has expired for this tossup (until the server's completed-round update arrives). */
  buzzTimedOut = false;

  private sub?: Subscription;
  private readingTimer: any = null;
  private advanceTimer: any = null;
  private buzzTimer: any = null;
  private currentRoundKey = '';
  private lastCompletedKey = '';
  private lastAnswerKey = '';
  private lastSpokenBonusKey = '';

  constructor(public gameStateService: GameStateService, public speech: SpeechService) {}

  /** Make this device the room's reader (or stop). The text keeps revealing at a fixed rate. */
  toggleReader(): void {
    this.readerMode = !this.readerMode;
    localStorage.setItem(GameAutoProctorComponent.READER_KEY, String(this.readerMode));
    if (!this.readerMode) {
      this.speech.cancel();
    } else if (this.isBuzzable && !this.readingComplete) {
      this.speech.speak(this.words.slice(this.revealedCount).join(' '), this.readingSpeed);
    } else if (this.isBonus) {
      this.lastSpokenBonusKey = '';
      this.maybeSpeakBonus();
    }
  }

  ngOnInit(): void {
    const saved = Number(localStorage.getItem(GameAutoProctorComponent.SPEED_KEY));
    if (saved >= 1 && saved <= 10) {
      this.readingSpeed = saved;
    }
    this.readerMode = localStorage.getItem(GameAutoProctorComponent.READER_KEY) === 'true';
    this.sub = this.gameStateService.gameSession$.subscribe(gs => {
      this.gameSession = gs;
      this.syncToRound();
    });
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.clearAdvanceTimer();
    this.clearBuzzTimer();
    this.speech.cancel();
    this.sub?.unsubscribe();
  }

  /* ------------------------------- state -------------------------------- */

  get round(): any {
    return this.gameSession?.currentMatch?.currentRound;
  }

  get roundState(): RoundState | undefined {
    return this.round?.roundState;
  }

  get myPlayerId(): string {
    return this.gameStateService.playerSessionId;
  }

  get currentBuzz(): any {
    return this.round?.currentBuzz;
  }

  get isCompleted(): boolean {
    return this.roundState === RoundState.COMPLETED;
  }

  /** Buzzing is open (mid-read or awaiting a buzz). */
  get isBuzzable(): boolean {
    return this.roundState === RoundState.AWAITING_BUZZ || this.roundState === RoundState.PROCTOR_READING;
  }

  get someoneBuzzed(): boolean {
    return this.roundState === RoundState.AWAITING_ANSWER && !!this.currentBuzz;
  }

  get iAmBuzzer(): boolean {
    return this.someoneBuzzed && this.currentBuzz?.playerId === this.myPlayerId;
  }

  get buzzerName(): string {
    return this.currentBuzz ? (this.gameStateService.getPlayerNameById(this.currentBuzz.playerId) || 'A player') : '';
  }

  get buzzerTeam(): string {
    return this.currentBuzz ? (this.gameStateService.getTeamNameById(this.currentBuzz.teamId) || '') : '';
  }

  get canBuzz(): boolean {
    return this.isBuzzable
      && this.gameStateService.isSelfOnAnyTeam()
      && !this.gameStateService.hasCurrentPlayerTeamBuzzed();
  }

  get canSubmit(): boolean {
    return (this.iAmBuzzer || this.bonusEligible) && this.answerText.trim().length > 0;
  }

  /* -------------------------------- bonus ------------------------------- */

  get isBonus(): boolean {
    return this.roundState === RoundState.BONUS_AWAITING_ANSWER;
  }

  get bonusPreamble(): string {
    return this.round?.currentBonus?.preamble || '';
  }

  get bonusPartIndex(): number {
    return this.round?.currentBonusPartIndex ?? 0;
  }

  /** Number of parts in the current bonus (bank bonuses are usually 3, but can differ). */
  get bonusPartCount(): number {
    return this.round?.currentBonus?.bonusParts?.length || 3;
  }

  /** Points earned on the bonus so far (10 per correct part). */
  get bonusScore(): number {
    return (this.round?.bonusPartAnswers || []).filter((a: any) => a?.correct).length * 10;
  }

  /** The current bonus part's question text (by order, falling back to list position). */
  get bonusPartQuestion(): string {
    const parts = this.round?.currentBonus?.bonusParts || [];
    const byOrder = parts.find((p: any) => p.order === this.bonusPartIndex);
    const part = byOrder || parts[this.bonusPartIndex];
    return part?.bonusPart?.question || '';
  }

  /** The team the current player belongs to. */
  get myTeamId(): string | null {
    for (const t of (this.gameSession?.teamList || [])) {
      if ((t.teamPlayers || []).some((p: any) => p.playerId === this.myPlayerId)) {
        return t.teamId;
      }
    }
    return null;
  }

  get bonusEligible(): boolean {
    return this.isBonus && this.round?.bonusEligibleTeamId === this.myTeamId;
  }

  get bonusTeamName(): string {
    return this.round?.bonusEligibleTeamId
      ? (this.gameStateService.getTeamNameById(this.round.bonusEligibleTeamId) || 'A team') : '';
  }

  get isOwner(): boolean {
    return this.gameStateService.isCurrentPlayerGameOwner();
  }

  get revealedText(): string {
    return this.words.slice(0, this.revealedCount).join(' ');
  }

  get readingComplete(): boolean {
    return this.words.length > 0 && this.revealedCount >= this.words.length;
  }

  private get lastBuzz(): any {
    const buzzes = this.round?.buzzList;
    return buzzes && buzzes.length ? buzzes[buzzes.length - 1] : null;
  }

  /** Whether the just-completed round was answered correctly. */
  get wasCorrect(): boolean {
    return !!this.lastBuzz?.correct;
  }

  /** The player who answered the tossup correctly (for the completed-round verdict). */
  get resultPlayer(): string {
    return this.lastBuzz ? (this.gameStateService.getPlayerNameById(this.lastBuzz.playerId) || 'A player') : '';
  }

  /** The team that answered correctly. */
  get resultTeam(): string {
    return this.lastBuzz ? (this.gameStateService.getTeamNameById(this.lastBuzz.teamId) || '') : '';
  }

  /** Points the answering team earned this round: 10 for the tossup + any bonus parts. */
  get roundPoints(): number {
    if (!this.wasCorrect) {
      return 0;
    }
    const bonus = (this.round?.bonusPartAnswers || []).filter((a: any) => a.correct).length * 10;
    return 10 + bonus;
  }

  /** Per-team running scores across the match (10 points per correct tossup). */
  get teamScores(): { name: string; score: number }[] {
    const prev = this.gameSession?.currentMatch?.previousRounds || [];
    const rounds = this.round ? [...prev, this.round] : [...prev];
    return (this.gameSession?.teamList || []).map(t => ({
      name: t.teamName,
      score: rounds.reduce((sum, r: any) =>
        sum + (r.buzzList || []).filter((b: any) => b.correct && b.teamId === t.teamId).length * 10, 0)
    }));
  }

  /** Total tossups in the packet, for the "Tossup N of M" progress. */
  get totalTossups(): number {
    return this.gameSession?.currentMatch?.packet?.tossups?.length || 0;
  }

  /** Reading-speed presets (map the 1..10 rate to three friendly choices). */
  readonly speedPresets = [
    { key: 'Slow', value: 3 },
    { key: 'Normal', value: 6 },
    { key: 'Fast', value: 9 },
  ];

  get activePreset(): string {
    if (this.readingSpeed <= 4) return 'Slow';
    if (this.readingSpeed <= 7) return 'Normal';
    return 'Fast';
  }

  setSpeed(value: number): void {
    this.readingSpeed = value;
    this.onSpeedChange();
  }

  /* ------------------------------ actions ------------------------------- */

  buzz(): void {
    if (this.canBuzz) {
      this.gameStateService.sendPlayerIncomingBuzz();
      this.speech.cancel();
    }
  }

  submit(): void {
    if (this.canSubmit) {
      this.gameStateService.sendSubmitAnswer(this.answerText.trim());
      this.answerText = '';
    }
  }

  next(): void {
    this.clearAdvanceTimer();
    this.gameStateService.sendAdvanceRound();
  }

  /** The host can advance to the next tossup with Enter once a round is complete. */
  @HostListener('document:keydown.enter', ['$event'])
  onEnter(event: Event): void {
    if (this.isCompleted && this.isOwner && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      this.next();
    }
  }

  onSpeedChange(): void {
    localStorage.setItem(GameAutoProctorComponent.SPEED_KEY, String(this.readingSpeed));
    if (this.isBuzzable && !this.readingComplete && this.readingTimer) {
      this.scheduleTick();   // re-pace the fixed-rate reveal
      if (this.readerMode) {
        this.speech.speak(this.words.slice(this.revealedCount).join(' '), this.readingSpeed);
      }
    }
  }

  /** The reader device reads the current bonus part (with the preamble on part 1), once per part. */
  private maybeSpeakBonus(): void {
    if (!this.readerMode) {
      return;
    }
    const bkey = `${this.round?.roundNumber}:bonus:${this.bonusPartIndex}`;
    if (bkey === this.lastSpokenBonusKey) {
      return;
    }
    this.lastSpokenBonusKey = bkey;
    const parts: string[] = [];
    if (this.bonusPartIndex === 0 && this.bonusPreamble) {
      parts.push(this.tokenize(this.bonusPreamble).join(' '));
    }
    parts.push(this.tokenize(this.bonusPartQuestion).join(' '));
    const text = parts.join(' ').trim();
    if (text) {
      this.speech.speak(text, this.readingSpeed);
    }
  }

  /* --------------------------- reader engine ---------------------------- */

  private syncToRound(): void {
    const r = this.round;
    if (!r) {
      this.clearTimer();
      return;
    }
    const key = `${r.roundNumber}:${(r.question || '').length}`;

    // Clear + focus the answer box the moment I become the answerer (a tossup buzz or a bonus part).
    const answerKey = this.iAmBuzzer ? `buzz:${this.currentBuzz?.playerId}`
      : this.bonusEligible ? `bonus:${this.bonusPartIndex}` : '';
    if (answerKey && answerKey !== this.lastAnswerKey) {
      this.answerText = '';
      setTimeout(() => this.answerInput?.nativeElement?.focus(), 0);
    }
    this.lastAnswerKey = answerKey;

    // Any active round cancels a pending "next tossup" pause.
    if (!this.isCompleted) {
      this.clearAdvanceTimer();
    }

    if (this.isBuzzable) {
      if (key !== this.currentRoundKey) {
        this.currentRoundKey = key;
        this.startReading();           // new tossup
      } else if (!this.isReadingActive() && this.revealedCount < this.words.length) {
        this.resumeReading();          // resume after a wrong buzz reopened play
      } else if (this.readingComplete && !this.buzzTimer) {
        this.startBuzzWindow();        // wrong buzz reopened play after the reveal had already finished
      }
    } else if (this.isBonus) {
      this.clearTimer();
      this.clearBuzzTimer();
      this.maybeSpeakBonus();          // read each bonus part to the eligible team
    } else {
      this.clearTimer();               // someone is answering, or the round is over
      this.clearBuzzTimer();
      this.speech.cancel();
      this.lastSpokenBonusKey = '';
      if (this.isCompleted) {
        // Pause on the result (answer + who got it) before moving on.
        const ckey = String(r.roundNumber);
        if (ckey !== this.lastCompletedKey) {
          this.lastCompletedKey = ckey;
          this.startAdvanceCountdown();
        }
      }
    }
  }

  /** Show a short countdown on the completed round, then the host advances automatically. */
  private startAdvanceCountdown(): void {
    this.clearAdvanceTimer();
    this.advanceSecondsLeft = GameAutoProctorComponent.ADVANCE_DELAY;
    this.advanceTimer = setInterval(() => {
      if (this.advanceSecondsLeft !== null) {
        this.advanceSecondsLeft--;
      }
      if (this.advanceSecondsLeft !== null && this.advanceSecondsLeft <= 0) {
        this.clearAdvanceTimer();
        if (this.isOwner) {
          this.next();                 // only the host drives the actual advance
        }
      }
    }, 1000);
  }

  private clearAdvanceTimer(): void {
    if (this.advanceTimer) {
      clearInterval(this.advanceTimer);
      this.advanceTimer = null;
    }
    this.advanceSecondsLeft = null;
  }

  private startReading(): void {
    this.clearTimer();
    this.clearBuzzTimer();
    this.buzzTimedOut = false;
    this.speech.cancel();
    this.answerText = '';
    this.revealedCount = 0;
    this.lastSpokenBonusKey = '';
    this.words = this.tokenize(this.round?.question || '');
    if (this.words.length === 0) {
      return;
    }
    this.scheduleTick();                          // text reveals at a fixed rate
    if (this.readerMode) {
      this.speech.speak(this.words.join(' '), this.readingSpeed);   // the reader reads aloud
    }
  }

  /** Continue a partially-read tossup from the current word (after a wrong buzz reopened play). */
  private resumeReading(): void {
    if (this.revealedCount >= this.words.length) {
      return;
    }
    this.scheduleTick();
    if (this.readerMode) {
      this.speech.speak(this.words.slice(this.revealedCount).join(' '), this.readingSpeed);
    }
  }

  private isReadingActive(): boolean {
    return !!this.readingTimer;
  }

  private scheduleTick(): void {
    this.clearTimer();
    this.readingTimer = setInterval(() => {
      if (this.revealedCount < this.words.length) {
        this.revealedCount++;
      } else {
        this.clearTimer();
        this.startBuzzWindow();        // reveal finished with nobody in — start the buzz-timeout countdown
      }
    }, this.intervalMs());
  }

  /** Length of the post-reveal buzz window: the configured tossup timer, or a fallback. */
  private get buzzWindowSeconds(): number {
    return this.gameSession?.gameSettings?.timerSettings?.tossupTimerSeconds
      || GameAutoProctorComponent.BUZZ_WINDOW_FALLBACK;
  }

  /** After the read finishes with nobody buzzed, count down; on expiry, the owner ends the tossup. */
  private startBuzzWindow(): void {
    if (!this.isBuzzable || this.buzzTimer) {
      return;
    }
    this.buzzTimedOut = false;
    this.buzzSecondsLeft = this.buzzWindowSeconds;
    this.buzzTimer = setInterval(() => {
      if (this.buzzSecondsLeft !== null) {
        this.buzzSecondsLeft--;
      }
      if (this.buzzSecondsLeft !== null && this.buzzSecondsLeft <= 0) {
        this.expireBuzzWindow();
      }
    }, 1000);
  }

  /** Buzz window elapsed with no buzz. The owner's client closes the tossup for everyone;
   *  other clients just show "Time." and wait for the resulting round update. */
  private expireBuzzWindow(): void {
    this.clearBuzzTimer();
    this.buzzTimedOut = true;
    if (this.isOwner) {
      this.gameStateService.sendTimeoutRound();
    }
  }

  private clearBuzzTimer(): void {
    if (this.buzzTimer) {
      clearInterval(this.buzzTimer);
      this.buzzTimer = null;
    }
    this.buzzSecondsLeft = null;
  }

  private intervalMs(): number {
    return Math.round(520 - (this.readingSpeed - 1) * 50);
  }

  private clearTimer(): void {
    if (this.readingTimer) {
      clearInterval(this.readingTimer);
      this.readingTimer = null;
    }
  }

  private tokenize(html: string): string[] {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length ? text.split(' ') : [];
  }
}
