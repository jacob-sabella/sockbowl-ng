import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CreateBanRequest } from '../../../../core/models/ban-models';

export interface BanUserDialogData {
  keycloakId: string;
  displayName: string | null;
}

/**
 * Expiry choices for a user ban (S5-03), mirroring
 * `IP_BAN_TTL_OPTIONS` (admin-bans.component.ts) plus a `Permanent`
 * option. `seconds: null` means no `expiresAt` is sent. The default
 * (`7 days`) is deliberately not `Permanent`: an admin who wants a
 * permanent ban has to choose it, rather than getting it by omission
 * (the dialog's previous behavior always sent `expiresAt: null`).
 */
export const USER_BAN_EXPIRY_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
  { label: 'Permanent', seconds: null },
];

const DEFAULT_EXPIRY_SECONDS = USER_BAN_EXPIRY_OPTIONS[2].seconds; // 7 days

/**
 * Admin-usage's "Ban user" flow (plan §2.9: "Actions: Ban user (reuses
 * ban.service)"). This dialog collects the reason and an expiry; the
 * caller performs the actual `BanService.createBan` call so the table row
 * can refresh once it settles.
 */
@Component({
  selector: 'app-ban-user-dialog',
  templateUrl: './ban-user-dialog.component.html',
  styleUrls: ['./ban-user-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule],
})
export class BanUserDialogComponent {
  private dialogRef = inject<MatDialogRef<BanUserDialogComponent, CreateBanRequest>>(MatDialogRef);
  data = inject<BanUserDialogData>(MAT_DIALOG_DATA);

  readonly expiryOptions = USER_BAN_EXPIRY_OPTIONS;

  reason = '';
  expirySeconds: number | null = DEFAULT_EXPIRY_SECONDS;
  /** S5-16: guards a fast double-click on Ban user from closing the dialog (and firing the parent's HTTP call) twice. */
  submitting = false;

  confirm(): void {
    if (this.submitting) {
      return;
    }
    this.submitting = true;
    const expiresAt = this.expirySeconds === null ? null : new Date(Date.now() + this.expirySeconds * 1000).toISOString();
    this.dialogRef.close({
      bannedKeycloakId: this.data.keycloakId,
      reason: this.reason.trim() || undefined,
      expiresAt,
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
