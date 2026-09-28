import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  Input,
  OnChanges,
  signal,
  SimpleChanges
} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {StompError} from '../../models/sockbowl/sockbowl-interfaces';
import {describeStompError} from '../../models/stomp-errors';

/** How long a non-fatal error stays on screen. */
export const NON_FATAL_BANNER_MS = 5000;

/**
 * A dismissible banner for game-socket errors (M2 plan WP-N3). Fatal errors
 * (the server closed the socket) stay until dismissed; non-fatal ones from
 * `/user/queue/errors` disappear after 5s, unless the pointer or keyboard
 * focus is on the banner, in which case the countdown pauses (M5 F1
 * accessibility fix) and resumes with whatever time was left. M4 reuses
 * this component for RATE_LIMITED and QUOTA_EXCEEDED, including
 * `retryAfterSeconds`.
 */
@Component({
  selector: 'app-stomp-error-banner',
  templateUrl: './stomp-error-banner.component.html',
  styleUrls: ['./stomp-error-banner.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
})
export class StompErrorBannerComponent implements OnChanges {
  /** The latest error; a new object shows the banner again. */
  @Input() error: StompError | null = null;

  readonly visible = signal(false);
  readonly text = signal('');
  readonly fatal = signal(false);
  readonly retryAfterSeconds = signal<number | null>(null);

  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private hideStartedAt: number | null = null;
  private remainingMs: number | null = null;
  private hovered = false;
  private focused = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['error']) {
      return;
    }
    this.clearTimer();
    this.remainingMs = null;
    this.hovered = false;
    this.focused = false;
    const error = this.error;
    if (!error) {
      this.visible.set(false);
      return;
    }
    this.text.set(describeStompError(error));
    this.fatal.set(!!error.fatal);
    this.retryAfterSeconds.set(error.retryAfterSeconds ?? null);
    this.visible.set(true);
    if (!error.fatal) {
      this.scheduleHide(NON_FATAL_BANNER_MS);
    }
  }

  dismiss(): void {
    this.clearTimer();
    this.visible.set(false);
  }

  /** Pause the auto-hide countdown while the pointer is over the banner. */
  onMouseEnter(): void {
    this.hovered = true;
    this.pause();
  }

  onMouseLeave(): void {
    this.hovered = false;
    this.maybeResume();
  }

  /** Pause the auto-hide countdown while the banner (or its dismiss button) has focus. */
  onFocusIn(): void {
    this.focused = true;
    this.pause();
  }

  onFocusOut(): void {
    this.focused = false;
    this.maybeResume();
  }

  private scheduleHide(ms: number): void {
    this.hideStartedAt = Date.now();
    this.remainingMs = ms;
    this.hideTimer = setTimeout(() => this.visible.set(false), ms);
  }

  private pause(): void {
    if (this.fatal() || !this.hideTimer) {
      return;
    }
    const elapsed = Date.now() - (this.hideStartedAt ?? Date.now());
    this.remainingMs = Math.max(0, (this.remainingMs ?? NON_FATAL_BANNER_MS) - elapsed);
    this.clearTimer();
  }

  private maybeResume(): void {
    if (this.hovered || this.focused) {
      return;
    }
    if (this.fatal() || this.hideTimer || this.remainingMs == null) {
      return;
    }
    this.scheduleHide(this.remainingMs);
  }

  private clearTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
