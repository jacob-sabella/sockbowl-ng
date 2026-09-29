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
/**
 * How long the dome shows a transient "sent, waiting for the server" state
 * after an accepted press, if no echo (or another player's buzz) arrives
 * first (M5 S1-25). Purely cosmetic: it never changes the debounce, the
 * rate-limit lockout or the message sent.
 */
export const BUZZ_PENDING_TIMEOUT_MS = 1500;

/**
 * What the dome should show right now, for a tossup round. `open` is the
 * only interactive state; every other value keeps the dome mounted but
 * disabled, distinguished by its label and the outcome strip text (never by
 * colour alone) (M5 S1-01). `rateLimited` covers the existing `stomp-buzz`
 * RATE_LIMITED lockout (M4-UI-02), unified with the banner's own countdown
 * (M5 S1-22). `disconnected` covers a dropped/reconnecting socket, driven by
 * `GameWebSocketService.connectionState$` (M5 S1-03), so a buzz is never
 * silently lost to a socket the player can't see is down.
 */
export type BuzzState = 'open' | 'pending' | 'self' | 'other' | 'teamLocked' | 'rateLimited' | 'disconnected';

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

  /**
   * Seconds left in the current rate-limit lockout, ticking down once a
   * second so the dome's label matches the banner's own countdown instead of
   * a static "Slow down" for the whole window (M5 S1-22). `null` when not
   * locked, or when the lockout duration is unknown.
   */
  readonly rateLimitRemainingSeconds = signal<number | null>(null);

  /**
   * True once the socket has connected at least once and is currently
   * `connected` (not `connecting`, `reconnecting` or `closed`). Drives the
   * `disconnected` buzz state so a dropped socket disables the dome instead
   * of leaving it looking live while buzzes would be silently lost (M5 S1-03).
   */
  private readonly connected = signal(true);

  /**
   * True from an accepted press until the server echoes the buzz (or someone
   * else's), or {@link BUZZ_PENDING_TIMEOUT_MS} passes, so a tap in a noisy
   * room doesn't look identical to a fully idle dome while the message is
   * still in flight (M5 S1-25).
   */
  readonly pendingSelfBuzz = signal(false);

  private destroyRef = inject(DestroyRef);
  private lastBuzzAtMs = 0;
  private lockoutTimer: ReturnType<typeof setTimeout> | null = null;
  private rateLimitTickTimer: ReturnType<typeof setInterval> | null = null;
  private pendingBuzzTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.gameSessionObs = this.gameStateService.gameSession$;
    this.destroyRef.onDestroy(() => {
      this.clearLockoutTimer();
      this.clearRateLimitTick();
      this.clearPendingBuzzTimer();
    });
  }

  /**
   * OnInit lifecycle hook to subscribe to the game session observable
   */
  ngOnInit(): void {
    this.gameSessionObs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(gameSession => {
      this.gameSession = gameSession;
      // The echo (or another player's buzz) landed: the pending window is over (M5 S1-25).
      if (this.pendingSelfBuzz() && gameSession?.currentMatch?.currentRound?.currentBuzz) {
        this.clearPendingBuzzTimer();
        this.pendingSelfBuzz.set(false);
      }
    });

    this.gameWebSocketService.errors$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(error => {
      if (error.code === 'RATE_LIMITED' && error.policy === 'stomp-buzz') {
        const lockoutMs = error.retryAfterMs
          ?? (error.retryAfterSeconds != null ? error.retryAfterSeconds * 1000 : BUZZ_LOCKOUT_FALLBACK_MS);
        this.lockBuzzer(lockoutMs);
      }
    });

    this.gameWebSocketService.connectionState$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(state => {
      this.connected.set(state === 'connected');
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
    this.startPendingBuzz();
    this.gameStateService.sendPlayerIncomingBuzz();
  }

  /** Starts (or restarts) the transient pending window after a sent buzz (M5 S1-25). */
  private startPendingBuzz(): void {
    this.clearPendingBuzzTimer();
    this.pendingSelfBuzz.set(true);
    this.pendingBuzzTimer = setTimeout(() => {
      this.pendingBuzzTimer = null;
      this.pendingSelfBuzz.set(false);
    }, BUZZ_PENDING_TIMEOUT_MS);
  }

  private clearPendingBuzzTimer(): void {
    if (this.pendingBuzzTimer) {
      clearTimeout(this.pendingBuzzTimer);
      this.pendingBuzzTimer = null;
    }
  }

  private lockBuzzer(durationMs: number): void {
    this.clearLockoutTimer();
    this.clearRateLimitTick();
    // A RATE_LIMITED rejection means the pending press was never accepted:
    // don't let a stale pending window reappear once the lockout ends.
    this.clearPendingBuzzTimer();
    this.pendingSelfBuzz.set(false);
    this.buzzLocked.set(true);
    const clampedMs = Math.max(durationMs, 0);
    const endsAt = Date.now() + clampedMs;
    this.updateRateLimitCountdown(endsAt);
    this.rateLimitTickTimer = setInterval(() => this.updateRateLimitCountdown(endsAt), 1000);
    this.lockoutTimer = setTimeout(() => {
      this.lockoutTimer = null;
      this.clearRateLimitTick();
      this.buzzLocked.set(false);
      this.rateLimitRemainingSeconds.set(null);
    }, clampedMs);
  }

  private updateRateLimitCountdown(endsAtMs: number): void {
    this.rateLimitRemainingSeconds.set(Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000)));
  }

  private clearLockoutTimer(): void {
    if (this.lockoutTimer) {
      clearTimeout(this.lockoutTimer);
      this.lockoutTimer = null;
    }
  }

  private clearRateLimitTick(): void {
    if (this.rateLimitTickTimer) {
      clearInterval(this.rateLimitTickTimer);
      this.rateLimitTickTimer = null;
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

  /**
   * True for every round state the dome should stay mounted in (open,
   * answered by someone, locked out). Kept as one slot across these states
   * so switching between them never unmounts the button (M5 S1-01).
   */
  isTossupRoundState(): boolean {
    const state = this.gameSession?.currentMatch?.currentRound?.roundState;
    return state === RoundState.PROCTOR_READING
      || state === RoundState.AWAITING_BUZZ
      || state === RoundState.AWAITING_ANSWER;
  }

  /**
   * Derives what the dome should show right now. `self`/`other`/`teamLocked`
   * are read off `currentBuzz` rather than a separate flag, so they always
   * agree with the team list (M5 S1-01).
   */
  getBuzzState(): BuzzState {
    if (this.buzzLocked()) {
      return 'rateLimited';
    }
    if (!this.connected()) {
      return 'disconnected';
    }
    if (this.pendingSelfBuzz()) {
      return 'pending';
    }
    const buzz = this.gameSession?.currentMatch?.currentRound?.currentBuzz;
    if (!buzz) {
      return 'open';
    }
    if (buzz.playerId === this.gameStateService.playerSessionId) {
      return 'self';
    }
    return this.gameStateService.hasCurrentPlayerTeamBuzzed() ? 'teamLocked' : 'other';
  }

  getBuzzButtonText(): string {
    switch (this.getBuzzState()) {
      case 'rateLimited': {
        const seconds = this.rateLimitRemainingSeconds();
        return seconds != null ? `Slow down (${seconds}s)` : 'Slow down';
      }
      case 'disconnected':
        return 'Reconnecting';
      case 'pending':
        return 'Buzzing…';
      case 'self':
        return "You're in, answer!";
      case 'teamLocked':
        return 'Team locked';
      case 'other': {
        const name = this.buzzerName();
        return name ? `${name} has it` : 'Locked';
      }
      default:
        return 'Buzz!';
    }
  }

  /**
   * One-line outcome strip shown above the dome for the self / other /
   * team-locked states, so the identity carried by the dome's label is also
   * carried by text elsewhere on screen (never colour alone). `null` (open,
   * rate-limited) renders no strip.
   */
  getBuzzOutcomeText(): string | null {
    const buzz = this.gameSession?.currentMatch?.currentRound?.currentBuzz;
    switch (this.getBuzzState()) {
      case 'self':
        return 'You buzzed. Answer out loud.';
      case 'teamLocked': {
        const name = this.buzzerName();
        return name ? `${name} has the buzz` : 'Your team has the buzz';
      }
      case 'other': {
        const name = this.buzzerName();
        const team = buzz ? this.gameStateService.getTeamNameById(buzz.teamId) : undefined;
        if (name && team) {
          return `${name} (${team}) has the buzz`;
        }
        return name ? `${name} has the buzz` : null;
      }
      default:
        return null;
    }
  }

  /**
   * Descriptive accessible label for the buzz button, reflecting its enabled or locked state.
   */
  getBuzzButtonAriaLabel(): string {
    switch (this.getBuzzState()) {
      case 'rateLimited': {
        const seconds = this.rateLimitRemainingSeconds();
        return seconds != null
          ? `Buzzer temporarily locked. Wait ${seconds} second${seconds === 1 ? '' : 's'} before buzzing again.`
          : 'Buzzer temporarily locked. Wait a moment before buzzing again.';
      }
      case 'disconnected':
        return 'Buzzer disabled while reconnecting to the game.';
      case 'pending':
        return 'Buzz sent, waiting for the server to confirm.';
      case 'self':
        return 'You have the buzz. Answer out loud.';
      case 'teamLocked':
        return 'Buzzer locked. Your team has already buzzed in.';
      case 'other':
        return this.getBuzzOutcomeText() ?? 'Buzzer locked. Another team has the buzz.';
      default:
        return 'Buzz in to answer the tossup';
    }
  }

  /**
   * True while the socket is down (dropped or reconnecting), so the
   * container can reserve space for `game-canvas`'s `.reconnect-strip`
   * instead of letting it float over the card title (M5 S1-04).
   */
  isDisconnected(): boolean {
    return !this.connected();
  }

  /** The name of the player behind the current buzz, if any. */
  private buzzerName(): string | undefined {
    const buzz = this.gameSession?.currentMatch?.currentRound?.currentBuzz;
    return buzz ? this.gameStateService.getPlayerNameById(buzz.playerId) : undefined;
  }

  getBonusEligibleTeamName(): string {
    const teamId = this.gameSession?.currentMatch?.currentRound?.bonusEligibleTeamId;
    return teamId ? (this.gameStateService.getTeamNameById(teamId) || '') : '';
  }

  /** Total parts in the current bonus (classic 3-part default when none is in play yet). */
  getBonusPartCount(): number {
    return Math.round(this.gameStateService.getCurrentRoundMaxBonusPoints() / 10);
  }

  /** Total tossups in the packet, for the "Tossup N of M" title (matches solo/auto-proctor). */
  get totalTossups(): number {
    return this.gameSession?.currentMatch?.packet?.tossups?.length || 0;
  }

}
