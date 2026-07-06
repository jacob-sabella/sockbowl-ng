import {Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {Subscription} from 'rxjs';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';

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
  private static readonly SPEED_KEY = 'solo_reading_speed';

  @ViewChild('answerInput') answerInput?: ElementRef<HTMLInputElement>;

  gameSession!: GameSession;
  answerText = '';

  /** Words of the current tossup, revealed progressively. */
  words: string[] = [];
  revealedCount = 0;
  hasBuzzed = false;
  /** 1 (slow) … 10 (fast); persisted per browser. */
  readingSpeed = 5;

  private sub?: Subscription;
  private readingTimer: any = null;
  private currentRoundKey = '';

  constructor(public gameStateService: GameStateService) {}

  ngOnInit(): void {
    const saved = Number(localStorage.getItem(GameSinglePlayerComponent.SPEED_KEY));
    if (saved >= 1 && saved <= 10) {
      this.readingSpeed = saved;
    }
    this.sub = this.gameStateService.gameSession$.subscribe(gameSession => {
      this.gameSession = gameSession;
      this.syncToRound();
    });
  }

  ngOnDestroy(): void {
    this.clearTimer();
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

  /* ------------------------------ actions ------------------------------- */

  @HostListener('document:keydown.space', ['$event'])
  onSpacebar(event: Event): void {
    // Spacebar buzzes while reading — but never when typing in the answer box.
    if (this.isReadingPhase && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      this.buzz();
    }
  }

  buzz(): void {
    if (!this.isReadingPhase) {
      return;
    }
    this.clearTimer();
    this.hasBuzzed = true;
    setTimeout(() => this.answerInput?.nativeElement?.focus(), 0);
  }

  onSpeedChange(): void {
    localStorage.setItem(GameSinglePlayerComponent.SPEED_KEY, String(this.readingSpeed));
    if (this.isReadingPhase && !this.readingComplete) {
      this.scheduleTick();
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
    this.answerText = '';
    this.hasBuzzed = false;
    this.revealedCount = 0;
    this.words = this.tokenize(this.round?.question || '');
    if (this.words.length > 0) {
      this.scheduleTick();
    }
  }

  private scheduleTick(): void {
    this.clearTimer();
    this.readingTimer = setInterval(() => {
      if (this.revealedCount < this.words.length) {
        this.revealedCount++;
      } else {
        this.clearTimer();
      }
    }, this.intervalMs());
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
