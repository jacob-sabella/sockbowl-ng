import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * Shared error state (M5 F1/F2): a designed "this failed to load" panel with
 * one primary action (usually Retry, sometimes Sign In for a 401). Mirrors
 * the shape `profile.component.ts`'s surface-local `ProfileErrorState`
 * already used ahead of this component landing (S6-10), so switching a
 * surface over is a template change, not a rewrite: bind `icon`/`title`/
 * `message` from the classified error and `actionLabel` from its
 * `primaryLabel`, and re-fire whatever `primaryAction` meant (retry the
 * request, or navigate to sign-in) from the single `retry` output.
 */
@Component({
  selector: 'app-error-state',
  templateUrl: './error-state.component.html',
  styleUrls: ['./error-state.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
})
export class ErrorStateComponent {
  @Input() icon = 'error';
  @Input() title = 'Something went wrong';
  @Input() message: string | null = null;
  /** Label for the single action button; omit to hide the button. */
  @Input() actionLabel: string | null = 'Retry';
  /** Fires when the action button is pressed (a retry, or a sign-in, per `actionLabel`). */
  @Output() retry = new EventEmitter<void>();
}
