import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ErrorStateMatcher } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { metricLabel } from '../../../../core/http/limit-messages';

/**
 * `required` alone (Angular's own validator) doesn't cover "negative" or
 * "not a whole number", so `mat-form-field`'s default error-display
 * machinery never switched on for those, hiding `mat-error` regardless of
 * any `@if` (S5-05, the same root cause as S5-04's CIDR field).
 */
class LimitErrorStateMatcher implements ErrorStateMatcher {
  constructor(private readonly hasError: () => boolean) {}
  isErrorState(): boolean {
    return this.hasError();
  }
}

export interface EditQuotaDialogData {
  metric: string;
  /** The currently effective limit; -1 means unlimited. */
  currentLimit: number;
  overridden: boolean;
}

/** Result: `{ limit: null }` clears the override (back to the role default). */
export interface EditQuotaDialogResult {
  limit: number | null;
}

/**
 * Admin-usage's "Edit quota" dialog (plan §2.9): a number, or "unlimited",
 * with a "Reset to role default" action that sends `null`.
 */
@Component({
  selector: 'app-edit-quota-dialog',
  templateUrl: './edit-quota-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
})
export class EditQuotaDialogComponent {
  private dialogRef = inject<MatDialogRef<EditQuotaDialogComponent, EditQuotaDialogResult>>(MatDialogRef);
  data = inject<EditQuotaDialogData>(MAT_DIALOG_DATA);

  readonly metricLabel = metricLabel(this.data.metric);
  unlimited = this.data.currentLimit === -1;
  /**
   * `number | null`: an emptied `matInput[type=number]` binds `null`
   * through `ngModel`, and `save()` used to coerce that (via
   * `Math.trunc(null) === 0`) straight into a limit of 0 — locking the
   * user out (S5-05). `limitInvalid` below is the single source of truth
   * both the template's `mat-error`/disabled Save and `save()`'s own guard
   * read from.
   */
  limitValue: number | null = this.data.currentLimit >= 0 ? this.data.currentLimit : 0;

  readonly limitErrorStateMatcher = new LimitErrorStateMatcher(() => this.limitInvalid);
  /** S5-16: guards a fast double-click from closing the dialog (and firing the parent's HTTP call) twice. */
  submitting = false;

  /** True while a non-unlimited limit is empty, not a whole number, or negative. */
  get limitInvalid(): boolean {
    if (this.unlimited) {
      return false;
    }
    return (
      this.limitValue === null ||
      this.limitValue === undefined ||
      Number.isNaN(this.limitValue) ||
      !Number.isInteger(this.limitValue) ||
      this.limitValue < 0
    );
  }

  save(): void {
    if (this.limitInvalid || this.submitting) {
      return;
    }
    this.submitting = true;
    this.dialogRef.close({ limit: this.unlimited ? -1 : (this.limitValue as number) });
  }

  resetToDefault(): void {
    this.dialogRef.close({ limit: null });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
