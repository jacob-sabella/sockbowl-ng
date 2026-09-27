import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CreateBanRequest } from '../../../../core/models/ban-models';

export interface BanUserDialogData {
  keycloakId: string;
  displayName: string | null;
}

/**
 * Admin-usage's "Ban user" flow (plan §2.9: "Actions: Ban user (reuses
 * ban.service)"). This dialog only collects the reason; the caller
 * performs the actual `BanService.createBan` call so the table row can
 * refresh once it settles.
 */
@Component({
  selector: 'app-ban-user-dialog',
  templateUrl: './ban-user-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
})
export class BanUserDialogComponent {
  private dialogRef = inject<MatDialogRef<BanUserDialogComponent, CreateBanRequest>>(MatDialogRef);
  data = inject<BanUserDialogData>(MAT_DIALOG_DATA);

  reason = '';

  confirm(): void {
    this.dialogRef.close({
      bannedKeycloakId: this.data.keycloakId,
      reason: this.reason.trim() || undefined,
      expiresAt: null,
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
