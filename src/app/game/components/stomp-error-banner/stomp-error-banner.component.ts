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
 * `/user/queue/errors` disappear after 5s. M4 reuses this component for
 * RATE_LIMITED and QUOTA_EXCEEDED, including `retryAfterSeconds`.
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

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['error']) {
      return;
    }
    this.clearTimer();
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
      this.hideTimer = setTimeout(() => this.visible.set(false), NON_FATAL_BANNER_MS);
    }
  }

  dismiss(): void {
    this.clearTimer();
    this.visible.set(false);
  }

  private clearTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
