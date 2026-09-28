import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * Shared empty state (M5 F1/F2): "there is nothing here yet", with an
 * optional single call-to-action (e.g. "Create your first packet").
 * See {@link LoadingStateComponent} for the handoff history.
 */
@Component({
  selector: 'app-empty-state',
  templateUrl: './empty-state.component.html',
  styleUrls: ['./empty-state.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
})
export class EmptyStateComponent {
  /** Material icon name shown above the title. Pass '' to hide it. */
  @Input() icon = 'inbox';
  @Input() title = 'Nothing here yet';
  @Input() message: string | null = null;
  /** Label for the single call-to-action button; omit to hide the button. */
  @Input() actionLabel: string | null = null;
  /** Fires when the action button is pressed. */
  @Output() action = new EventEmitter<void>();
}
