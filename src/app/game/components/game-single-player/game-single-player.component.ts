import {Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {Subscription} from 'rxjs';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';
import {SpeechService} from '../../services/speech.service';

/**
 * Solo play surface with a moderator-style reader/buzz mechanic: the tossup is
 * revealed word-by-word at a slider-controlled speed; the player buzzes (button
 * or spacebar) to stop the read and type an answer, which the server-side judge
 * adjudicates. On completion the full question + answer + verdict are shown.
 */
@Component({
  selector: 'app-game-single-player',
  templateUrl: './game-single-player.component.html',
  styleUrls: ['./game-single-player.component.scss'],
  standalone: false
})
export class GameSinglePlayerComponent implements OnInit, OnDestroy {

  protected readonly RoundState = RoundState;
  private static readonly SPEED_KEY = 'sockbowl_reading_speed';
  private static readonly READ_KEY = 'solo_read_aloud';

  /** Whether this device reads the tossup aloud (solo is one device, so no conflict). */
  readAloud = true;

  @ViewChild('answerInput') answerInput?: ElementRef<HTMLInputElement>;

  gameSession!: GameSession;
  answerText = '';

  /** Words of the current tossup, revealed progressively. */
  words: string[] = [];
  revealedCount = 0;
  hasBuzzed = false;
  /** 1 (slow) … 10 (fast); persisted per browser. */
  readingSpeed = 5;

  /** Grace window (seconds) to buzz once the read finishes before the tossup is forgone. */
  private static readonly BUZZ_WINDOW = 8;
  buzzSecondsLeft: number | null = null;
  /** True when the current round ended because the buzz window elapsed (no answer). */
  forwent = false;

  private sub?: Subscription;
  private readingTimer: any = null;
  private buzzTimer: any = null;
  private currentRoundKey = '';

  constructor(public gameStateService: GameStateService, public speech: SpeechService) {}

  /** Toggle reading the tossup aloud on this device; the text keeps revealing at a fixed rate. */
  toggleReadAloud(): void {
    this.readAloud = !this.readAloud;
    localStorage.setItem(GameSinglePlayerComponent.READ_KEY, String(this.readAloud));
    if (!this.readAloud) {
      this.speech.cancel();
    } else if (this.isReadingPhase && !this.readingComplete) {
      this.speech.speak(this.words.slice(this.revealedCount).join(' '), this.readingSpeed);
    }
  }

  ngOnInit(): void {
    const saved = Number(localStorage.getItem(GameSinglePlayerComponent.SPEED_KEY));
    if (saved >= 1 && saved <= 10) {
      this.readingSpeed = saved;
    }
    const savedRead = localStorage.getItem(GameSinglePlayerComponent.READ_KEY);
    if (savedRead !== null) {
      this.readAloud = savedRead === 'true';
    }
    this.sub = this.gameStateService.gameSession$.subscribe(gameSession => {
      this.gameSession = gameSession;
      this.syncToRound();
    });
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.clearBuzzTimer();
    this.speech.cancel();
    this.sub?.unsubscribe();
  }

  /* ------------------------------- state -------------------------------- */

  get round(): any {
    return this.gameSession?.currentMatch?.currentRound;
  }

  get isCompleted(): boolean {
    return this.round?.roundState === RoundState.COMPLETED;
  }

  /** Reading the question, not yet buzzed. */
  get isReadingPhase(): boolean {
    return !!this.round && !this.isCompleted && !this.hasBuzzed;
  }

  /** Buzzed in, typing an answer. */
  get isAnswering(): boolean {
    return !!this.round && !this.isCompleted && this.hasBuzzed;
  }

  get revealedText(): string {
    return this.words.slice(0, this.revealedCount).join(' ');
  }

  get readingComplete(): boolean {
    return this.words.length > 0 && this.revealedCount >= this.words.length;
  }

  get canSubmit(): boolean {
    const state = this.round?.roundState;
    return this.hasBuzzed
      && (state === RoundState.AWAITING_BUZZ || state === RoundState.PROCTOR_READING)
      && this.answerText.trim().length > 0;
  }

  private get lastBuzz(): any {
    const buzzes = this.round?.buzzList;
    return buzzes && buzzes.length ? buzzes[buzzes.length - 1] : null;
  }

  get wasCorrect(): boolean {
    return !!this.lastBuzz?.correct;
  }

  /** Human-readable outcome for the completed round (used for display + aria-live). */
  get verdictText(): string {
    if (this.wasCorrect) {
      return 'Correct';
    }
    return this.forwent ? "No answer, time's up" : 'Incorrect';
  }

  /** Fraction of the tossup revealed so far, 0..100, for the reading progress bar. */
  get readingProgress(): number {
    if (this.words.length === 0) {
      return 0;
    }
    return Math.min(100, Math.round((this.revealedCount / this.words.length) * 100));
  }

  /** Concise status announced to assistive tech as the read phase changes. */
  get readingStatus(): string {
    if (this.hasBuzzed) {
      return 'Buzzed in. Type your answer.';
    }
    if (this.buzzSecondsLeft !== null) {
      return `Reading complete. Buzz within ${this.buzzSecondsLeft} seconds.`;
    }
    if (this.readingComplete) {
      return 'Reading complete. Buzz to answer.';
    }
    return 'Reading in progress.';
  }

  /* ------------------------------ actions ------------------------------- */

  @HostListener('document:keydown.space', ['$event'])
  onSpacebar(event: Event): void {
    // Spacebar buzzes while reading — but never when typing in the answer box.
    if (this.isReadingPhase && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      this.buzz();
    }
  }

  /** After a verdict, Enter jumps to the next tossup so solo drilling stays hands-on-keyboard. */
  @HostListener('document:keydown.enter', ['$event'])
  onEnter(event: Event): void {
    if (this.isCompleted && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      this.next();
    }
  }

  buzz(): void {
    if (!this.isReadingPhase) {
      return;
    }
    this.clearTimer();
    this.clearBuzzTimer();
    this.speech.cancel();
    this.buzzSecondsLeft = null;
    this.hasBuzzed = true;
    setTimeout(() => this.answerInput?.nativeElement?.focus(), 0);
  }

  /** Give up on the current tossup and reveal the answer straight away (solo only). */
  skip(): void {
    if (this.isReadingPhase) {
      this.clearTimer();
      this.clearBuzzTimer();
      this.speech.cancel();
      this.forgo();
    }
  }

  /** Buzz window elapsed with no buzz — forgo the tossup (reveal the answer, no points). */
  private forgo(): void {
    this.clearBuzzTimer();
    this.buzzSecondsLeft = null;
    this.forwent = true;
    // An empty guess is judged incorrect, which completes the round and reveals the answer.
    this.gameStateService.sendSubmitAnswer('');
  }

  /* ------------------------------- scoring ------------------------------ */

  private get scoredRounds(): any[] {
    const prev = this.gameSession?.currentMatch?.previousRounds || [];
    return this.round ? [...prev, this.round] : [...prev];
  }

  /** Tossups correctly answered (10 points each). */
  get correctCount(): number {
    return this.scoredRounds.filter(r => (r.buzzList || []).some((b: any) => b.correct)).length;
  }

  get score(): number {
    return this.correctCount * 10;
  }

  /** Tossups that have been resolved (completed). */
  get tossupsSeen(): number {
    const prev = this.gameSession?.currentMatch?.previousRounds?.length || 0;
    return prev + (this.isCompleted ? 1 : 0);
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

  onSpeedChange(): void {
    localStorage.setItem(GameSinglePlayerComponent.SPEED_KEY, String(this.readingSpeed));
    if (this.isReadingPhase && !this.readingComplete) {
      this.scheduleTick();   // re-pace the fixed-rate reveal
      if (this.readAloud) {
        this.speech.speak(this.words.slice(this.revealedCount).join(' '), this.readingSpeed);
      }
    }
  }

  submit(): void {
    if (!this.canSubmit) {
      return;
    }
    this.gameStateService.sendSubmitAnswer(this.answerText.trim());
    this.answerText = '';
  }

  next(): void {
    this.gameStateService.sendAdvanceRound();
  }

  /* --------------------------- reader engine ---------------------------- */

  /** React to a new/changed round: (re)start the read; stop on completion. */
  private syncToRound(): void {
    if (!this.round || this.isCompleted) {
      this.clearTimer();
      this.clearBuzzTimer();
      this.speech.cancel();
      this.buzzSecondsLeft = null;
      return;
    }
    const key = `${this.round.roundNumber}:${(this.round.question || '').length}`;
    if (key && key !== this.currentRoundKey) {
      this.currentRoundKey = key;
      this.startReading();
    }
  }

  private startReading(): void {
    this.clearTimer();
    this.clearBuzzTimer();
    this.speech.cancel();
    this.answerText = '';
    this.hasBuzzed = false;
    this.forwent = false;
    this.buzzSecondsLeft = null;
    this.revealedCount = 0;
    this.words = this.tokenize(this.round?.question || '');
    if (this.words.length === 0) {
      return;
    }
    this.scheduleTick();                          // text reveals at a fixed rate
    if (this.readAloud) {
      this.speech.speak(this.words.join(' '), this.readingSpeed);   // read aloud on this device
    }
  }

  private scheduleTick(): void {
    this.clearTimer();
    this.readingTimer = setInterval(() => {
      if (this.revealedCount < this.words.length) {
        this.revealedCount++;
      } else {
        this.clearTimer();
        this.startBuzzWindow();
      }
    }, this.intervalMs());
  }

  /** After the read finishes, count down the grace period; forgo if it elapses. */
  private startBuzzWindow(): void {
    if (this.hasBuzzed || this.buzzTimer) {
      return;
    }
    this.buzzSecondsLeft = GameSinglePlayerComponent.BUZZ_WINDOW;
    this.buzzTimer = setInterval(() => {
      if (this.buzzSecondsLeft !== null) {
        this.buzzSecondsLeft--;
      }
      if (this.buzzSecondsLeft !== null && this.buzzSecondsLeft <= 0) {
        this.forgo();
      }
    }, 1000);
  }

  private clearBuzzTimer(): void {
    if (this.buzzTimer) {
      clearInterval(this.buzzTimer);
      this.buzzTimer = null;
    }
  }

  /** speed 1..10 → ~520ms (slow) down to ~70ms (fast) per word. */
  private intervalMs(): number {
    return Math.round(520 - (this.readingSpeed - 1) * 50);
  }

  private clearTimer(): void {
    if (this.readingTimer) {
      clearInterval(this.readingTimer);
      this.readingTimer = null;
    }
  }

  /** Strip HTML + decode entities to plain words for the progressive read. */
  private tokenize(html: string): string[] {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length ? text.split(' ') : [];
  }
}
