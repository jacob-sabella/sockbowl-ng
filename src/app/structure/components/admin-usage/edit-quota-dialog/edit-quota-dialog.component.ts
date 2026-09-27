import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { metricLabel } from '../../../../core/http/limit-messages';

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
  limitValue: number = this.data.currentLimit >= 0 ? this.data.currentLimit : 0;

  save(): void {
    this.dialogRef.close({ limit: this.unlimited ? -1 : Math.max(0, Math.trunc(this.limitValue)) });
  }

  resetToDefault(): void {
    this.dialogRef.close({ limit: null });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
