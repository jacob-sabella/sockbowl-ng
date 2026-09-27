import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CreateIpBanRequest } from '../../../../core/models/ban-models';
import { IP_BAN_TTL_OPTIONS, validateCidr } from '../../admin-bans/admin-bans.component';

export interface IpBanDialogData {
  /** Pre-filled from the user detail's `lastIps`, editable. */
  cidr: string;
}

/**
 * Admin-usage's quick "Ban IP" flow, reachable from a user's detail row
 * (one of their last-seen IPs). Shares the same CIDR rules as the
 * admin-bans page's own IP-ban form.
 */
@Component({
  selector: 'app-ip-ban-dialog',
  templateUrl: './ip-ban-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule],
})
export class IpBanDialogComponent {
  private dialogRef = inject<MatDialogRef<IpBanDialogComponent, CreateIpBanRequest>>(MatDialogRef);
  data = inject<IpBanDialogData>(MAT_DIALOG_DATA);

  readonly ttlOptions = IP_BAN_TTL_OPTIONS;

  cidr = this.data.cidr;
  reason = '';
  ttlSeconds = IP_BAN_TTL_OPTIONS[1].seconds;
  cidrError: string | null = null;

  confirm(): void {
    this.cidrError = validateCidr(this.cidr);
    if (this.cidrError) {
      return;
    }
    this.dialogRef.close({
      cidr: this.cidr.trim(),
      reason: this.reason.trim() || undefined,
      ttlSeconds: this.ttlSeconds,
    });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
