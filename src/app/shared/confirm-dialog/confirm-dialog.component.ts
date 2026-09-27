import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConfirmDialogData } from './confirm-dialog.models';

/**
 * Generic yes/no confirmation dialog, replacing `window.confirm` across the
 * app (PB-23, M3 plan 3.3.1). Opened through {@link ConfirmDialogService}
 * rather than directly.
 */
@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.component.html',
  styleUrls: ['./confirm-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ConfirmDialogComponent {
  private dialogRef = inject<MatDialogRef<ConfirmDialogComponent, boolean>>(MatDialogRef);
  data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);

  close(result: boolean): void {
    this.dialogRef.close(result);
  }
}
