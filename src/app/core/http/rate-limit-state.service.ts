import { Injectable, Signal, WritableSignal, computed, signal } from '@angular/core';

/**
 * Per-policy cooldown state for M4 rate limiting (plan §2.9). A 429 handled
 * by {@link RateLimitInterceptor} (or, later, by the ng GraphQL client via
 * `limitErrorFrom`/`notifyLimit`) calls {@link setCooldown} with the
 * server's `retryAfterSeconds`; buttons for that policy bind `[disabled]`
 * to {@link cooldown} or {@link isCoolingDown} so they re-enable themselves
 * without a page reload once the window passes.
 *
 * One instance is shared app-wide (`providedIn: 'root'`), keyed by policy
 * name (e.g. `session-create`, `ai-generate`, `import`), so unrelated
 * policies never block each other's buttons.
 */
@Injectable({ providedIn: 'root' })
export class RateLimitStateService {
  private readonly cooldownUntil = new Map<string, WritableSignal<number>>();
  private readonly now = signal(Date.now());
  private ticking: ReturnType<typeof setInterval> | null = null;

  /** Seconds remaining before `policy` may be retried; 0 once clear. */
  cooldown(policy: string): Signal<number> {
    const until = this.untilSignal(policy);
    return computed(() => Math.max(0, Math.ceil((until() - this.now()) / 1000)));
  }

  /** Convenience signal for `[disabled]` bindings. */
  isCoolingDown(policy: string): Signal<boolean> {
    const remaining = this.cooldown(policy);
    return computed(() => remaining() > 0);
  }

  /** Starts (or extends) a cooldown for `policy`. A no-op for `seconds <= 0`. */
  setCooldown(policy: string, seconds: number): void {
    if (!(seconds > 0)) {
      return;
    }
    const until = this.untilSignal(policy);
    // Refresh `now` before computing the target: it's only otherwise
    // updated once a second by the ticking interval (or not at all, before
    // the first cooldown ever starts it), so a stale `now()` read right
    // after this call can make `cooldown()` overreport by up to a second
    // (the intermittent "Expected 6 to be 5" flake).
    const nowMs = Date.now();
    this.now.set(nowMs);
    const target = nowMs + seconds * 1000;
    // Never shorten an existing cooldown (e.g. a stale, slower response
    // arriving after a fresher, shorter one already started the clock).
    if (target > until()) {
      until.set(target);
    }
    this.ensureTicking();
  }

  /** Clears any cooldown for `policy`. */
  clearCooldown(policy: string): void {
    this.untilSignal(policy).set(0);
  }

  private untilSignal(policy: string): WritableSignal<number> {
    let existing = this.cooldownUntil.get(policy);
    if (!existing) {
      existing = signal(0);
      this.cooldownUntil.set(policy, existing);
    }
    return existing;
  }

  /**
   * Ticks `now` once a second so active cooldowns count down live, and
   * stops itself once every tracked policy has cleared so this service
   * never leaves a periodic timer running (important for `fakeAsync`
   * specs, which fail if one is still pending when the test ends).
   */
  private ensureTicking(): void {
    if (this.ticking) {
      return;
    }
    this.ticking = setInterval(() => {
      this.now.set(Date.now());
      if (this.allCleared()) {
        this.stopTicking();
      }
    }, 1000);
  }

  private allCleared(): boolean {
    const now = Date.now();
    for (const until of this.cooldownUntil.values()) {
      if (until() > now) {
        return false;
      }
    }
    return true;
  }

  private stopTicking(): void {
    if (this.ticking) {
      clearInterval(this.ticking);
      this.ticking = null;
    }
  }

  /** Stops the internal ticker; safe to call even if never started. */
  ngOnDestroy(): void {
    this.stopTicking();
  }
}
