import {Component, ElementRef, OnDestroy, OnInit, ViewChild} from '@angular/core';
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
  private static readonly SPEED_KEY = 'auto_reading_speed';

  @ViewChild('answerInput') answerInput?: ElementRef<HTMLInputElement>;

  gameSession!: GameSession;
  answerText = '';
  readingSpeed = 5;

  words: string[] = [];
  revealedCount = 0;

  private sub?: Subscription;
  private readingTimer: any = null;
  private currentRoundKey = '';
  private lastAnswerKey = '';
  private lastSpokenBonusKey = '';

  constructor(public gameStateService: GameStateService, public speech: SpeechService) {}

  /** Toggle the spoken read; if turning on, pick up the tossup or bonus in progress. */
  toggleTts(): void {
    this.speech.toggle();
    if (!this.speech.enabled) {
      return;
    }
    if (this.isBuzzable && !this.readingComplete) {
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
    this.sub = this.gameStateService.gameSession$.subscribe(gs => {
      this.gameSession = gs;
      this.syncToRound();
    });
  }

  ngOnDestroy(): void {
    this.clearTimer();
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
    this.gameStateService.sendAdvanceRound();
  }

  onSpeedChange(): void {
    localStorage.setItem(GameAutoProctorComponent.SPEED_KEY, String(this.readingSpeed));
    if (this.isBuzzable && !this.readingComplete && this.readingTimer) {
      this.scheduleTick();
      this.speech.speak(this.words.slice(this.revealedCount).join(' '), this.readingSpeed);
    }
  }

  /** Read the current bonus part (with the preamble on part 1) aloud, once per part. */
  private maybeSpeakBonus(): void {
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

    if (this.isBuzzable) {
      if (key !== this.currentRoundKey) {
        this.currentRoundKey = key;
        this.startReading();           // new tossup
      } else if (!this.readingTimer && this.revealedCount < this.words.length) {
        this.scheduleTick();           // resume after a wrong buzz reopened play
        this.speech.speak(this.words.slice(this.revealedCount).join(' '), this.readingSpeed);
      }
    } else if (this.isBonus) {
      this.clearTimer();
      this.maybeSpeakBonus();          // read each bonus part to the eligible team
    } else {
      this.clearTimer();               // someone is answering, or the round is over
      this.speech.cancel();
      this.lastSpokenBonusKey = '';
    }
  }

  private startReading(): void {
    this.clearTimer();
    this.answerText = '';
    this.revealedCount = 0;
    this.lastSpokenBonusKey = '';
    this.words = this.tokenize(this.round?.question || '');
    if (this.words.length > 0) {
      this.scheduleTick();
      this.speech.speak(this.words.join(' '), this.readingSpeed);
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
