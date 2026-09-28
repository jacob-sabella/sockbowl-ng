import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/**
 * Shared loading state (M5 F1/F2). A designed placeholder for "data is on
 * its way", used instead of a bare spinner or a blank panel while a surface
 * waits on its first REST/GraphQL response.
 *
 * Every surface that hardened its loading state before this landed
 * (S4 `packets-local`, S5 `admin-bans`/`admin-usage`, S6 `profile`) built an
 * equivalent surface-local version and filed a handoff to swap over once
 * this existed (H-01/H-02, audit/m5/{s4,s5,s6}/backlog.json).
 */
@Component({
  selector: 'app-loading-state',
  templateUrl: './loading-state.component.html',
  styleUrls: ['./loading-state.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinnerModule],
})
export class LoadingStateComponent {
  /** Short label above the spinner. */
  @Input() title = 'Loading…';
  /** Optional supporting copy below the title. */
  @Input() message: string | null = null;
  /** Spinner diameter in px. */
  @Input() diameter = 40;
}
