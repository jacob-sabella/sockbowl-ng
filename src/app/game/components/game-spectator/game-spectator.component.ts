import { Component, OnInit, OnDestroy } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';
import { GameSession, Round, RoundState, Team } from '../../models/sockbowl/sockbowl-interfaces';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-game-spectator',
    templateUrl: './game-spectator.component.html',
    styleUrls: ['./game-spectator.component.scss'],
    standalone: false
})
export class GameSpectatorComponent implements OnInit, OnDestroy {
  gameSession: GameSession | null = null;
  currentRound: Round | null = null;
  previousRounds: Round[] = [];
  teams: Team[] = [];

  RoundState = RoundState;

  /** Read-only progressive reveal so spectators watch the tossup unfold (no spoiler). */
  words: string[] = [];
  revealedCount = 0;
  private readingTimer: any = null;
  private currentRoundKey = '';
  private readingSpeed = 5;

  private gameSessionSubscription?: Subscription;

  constructor(public gameStateService: GameStateService) {}

  ngOnInit(): void {
    const saved = Number(localStorage.getItem('sockbowl_reading_speed'));
    if (saved >= 1 && saved <= 10) {
      this.readingSpeed = saved;
    }
    this.gameSessionSubscription = this.gameStateService.gameSession$.subscribe(gameSession => {
      if (gameSession) {
        this.gameSession = gameSession;
        this.currentRound = gameSession.currentMatch?.currentRound || null;
        this.previousRounds = gameSession.currentMatch?.previousRounds || [];
        this.teams = gameSession.teamList || [];
        this.syncReveal();
      }
    });
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.gameSessionSubscription?.unsubscribe();
  }

  /* --------------------------- read-along reveal --------------------------- */

  /** The tossup is being read (reveal in progress) rather than answered/complete. */
  get isReadingPhase(): boolean {
    const s = this.currentRound?.roundState;
    return s === RoundState.PROCTOR_READING || s === RoundState.AWAITING_BUZZ;
  }

  get revealedText(): string {
    return this.words.slice(0, this.revealedCount).join(' ');
  }

  get readingComplete(): boolean {
    return this.words.length > 0 && this.revealedCount >= this.words.length;
  }

  /** Keep the reveal in step with the round: reveal while reading, stop otherwise. */
  private syncReveal(): void {
    const r = this.currentRound;
    if (!r || !this.isReadingPhase) {
      this.clearTimer();
      return;
    }
    const key = `${r.roundNumber}:${(r.question || '').length}`;
    if (key !== this.currentRoundKey) {
      this.currentRoundKey = key;
      this.words = this.tokenize(r.question || '');
      this.revealedCount = 0;
      if (this.words.length > 0) {
        this.scheduleTick();
      }
    } else if (!this.readingTimer && this.revealedCount < this.words.length) {
      this.scheduleTick();
    }
  }

  private scheduleTick(): void {
    this.clearTimer();
    const interval = Math.round(520 - (this.readingSpeed - 1) * 50);
    this.readingTimer = setInterval(() => {
      if (this.revealedCount < this.words.length) {
        this.revealedCount++;
      } else {
        this.clearTimer();
      }
    }, interval);
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

  /**
   * Check if current round answer should be visible
   * Answer is visible when round is complete
   */
  isAnswerVisible(): boolean {
    if (!this.currentRound) return false;
    return this.currentRound.roundState === RoundState.COMPLETED;
  }

  /**
   * Get the team name for a given team ID
   */
  getTeamName(teamId: string): string {
    const team = this.teams.find(t => t.teamId === teamId);
    return team?.teamName || 'Unknown Team';
  }

  /**
   * Calculate team score based on correct buzzes
   */
  getTeamScore(team: Team): number {
    return team.teamPlayers.reduce((total, player) => total + this.getPlayerScore(player.playerId), 0);
  }

  /**
   * Calculate player score from all rounds (10 points per correct buzz)
   */
  getPlayerScore(playerId: string): number {
    let score = 0;

    // Calculate score from previous rounds
    this.previousRounds.forEach(round => {
      score += round.buzzList.filter(buzz => buzz.playerId === playerId && buzz.correct).length * 10;
    });

    // Add score from current round if it exists
    if (this.currentRound) {
      score += this.currentRound.buzzList.filter(buzz => buzz.playerId === playerId && buzz.correct).length * 10;
    }

    return score;
  }

  /**
   * Get formatted round outcome message
   */
  getRoundOutcome(round: Round): string {
    if (!round.buzzList || round.buzzList.length === 0) {
      return 'No buzzes';
    }

    const lastBuzz = round.buzzList[round.buzzList.length - 1];
    const teamName = this.getTeamName(lastBuzz.teamId);

    if (lastBuzz.correct) {
      return `${teamName} answered correctly`;
    } else {
      return `${teamName} answered incorrectly`;
    }
  }

  /**
   * Check if a round has any buzzes
   */
  hasBuzzes(round: Round): boolean {
    return round.buzzList && round.buzzList.length > 0;
  }

  /**
   * Human-readable label for a round state, used for screen-reader
   * announcements and visible chip text (e.g. "Awaiting Buzz").
   */
  getRoundStateLabel(state: RoundState | string | null | undefined): string {
    if (!state) return '';
    return String(state)
      .toLowerCase()
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
