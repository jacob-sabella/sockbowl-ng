import {Component, DestroyRef, inject, OnInit, ChangeDetectionStrategy, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Observable} from 'rxjs';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';
import {GameWebSocketService} from '../../services/game-web-socket.service';

/** Presses closer together than this are treated as one buzz (double-tap/double-click guard). */
export const BUZZ_PRESS_DEBOUNCE_MS = 300;
/** Lockout used when a stomp-buzz RATE_LIMITED error carries no `retryAfterMs`/`retryAfterSeconds`. */
export const BUZZ_LOCKOUT_FALLBACK_MS = 1000;

@Component({
    selector: 'app-game-buzzer',
    templateUrl: './game-buzzer.component.html',
    styleUrls: ['./game-buzzer.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class GameBuzzerComponent implements OnInit {
  gameStateService = inject(GameStateService);
  private gameWebSocketService = inject(GameWebSocketService);

  protected readonly RoundState = RoundState;

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;

  /** True while the buzzer is locked out after a `stomp-buzz` RATE_LIMITED rejection (M4-UI-02). */
  readonly buzzLocked = signal(false);

  private destroyRef = inject(DestroyRef);
  private lastBuzzAtMs = 0;
  private lockoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.gameSessionObs = this.gameStateService.gameSession$;
    this.destroyRef.onDestroy(() => this.clearLockoutTimer());
  }

  /**
   * OnInit lifecycle hook to subscribe to the game session observable
   */
  ngOnInit(): void {
    this.gameSessionObs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(gameSession => {
      this.gameSession = gameSession;
    });

    this.gameWebSocketService.errors$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(error => {
      if (error.code === 'RATE_LIMITED' && error.policy === 'stomp-buzz') {
        const lockoutMs = error.retryAfterMs
          ?? (error.retryAfterSeconds != null ? error.retryAfterSeconds * 1000 : BUZZ_LOCKOUT_FALLBACK_MS);
        this.lockBuzzer(lockoutMs);
      }
    });
  }

  /**
   * Click handler for the buzz button: swallows presses within
   * {@link BUZZ_PRESS_DEBOUNCE_MS} of the last accepted one, and any press
   * while locked out by a rate limit, so at most one buzz message per
   * genuine press reaches the server.
   */
  onBuzzClick(): void {
    if (this.buzzLocked()) {
      return;
    }
    const now = Date.now();
    if (now - this.lastBuzzAtMs < BUZZ_PRESS_DEBOUNCE_MS) {
      return;
    }
    this.lastBuzzAtMs = now;
    this.gameStateService.sendPlayerIncomingBuzz();
  }

  private lockBuzzer(durationMs: number): void {
    this.clearLockoutTimer();
    this.buzzLocked.set(true);
    this.lockoutTimer = setTimeout(() => {
      this.lockoutTimer = null;
      this.buzzLocked.set(false);
    }, Math.max(durationMs, 0));
  }

  private clearLockoutTimer(): void {
    if (this.lockoutTimer) {
      clearTimeout(this.lockoutTimer);
      this.lockoutTimer = null;
    }
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

  getBuzzButtonText(): string {
    if (this.buzzLocked()) {
      return 'Slow down…';
    }
    return this.gameStateService.hasCurrentPlayerTeamBuzzed() ? 'Team already buzzed' : 'Buzz!';
  }

  /**
   * Descriptive accessible label for the buzz button, reflecting its enabled or locked state.
   */
  getBuzzButtonAriaLabel(): string {
    if (this.buzzLocked()) {
      return 'Buzzer temporarily locked. Wait a moment before buzzing again.';
    }
    return this.gameStateService.hasCurrentPlayerTeamBuzzed()
      ? 'Buzzer locked. Your team has already buzzed in.'
      : 'Buzz in to answer the tossup';
  }

  getCurrentBonusPart(bonus: any, partIndex: number): any {
    if (!bonus || !bonus.bonusParts || partIndex === undefined || partIndex === null) {
      return null;
    }

    return bonus.bonusParts[partIndex];
  }

  getBonusEligibleTeamName(): string {
    const teamId = this.gameSession?.currentMatch?.currentRound?.bonusEligibleTeamId;
    return teamId ? (this.gameStateService.getTeamNameById(teamId) || '') : '';
  }

}
