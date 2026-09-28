import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BanService } from '../../../core/services/ban.service';
import { Ban, CreateBanRequest, CreateIpBanRequest, IpBan } from '../../../core/models/ban-models';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { USER_BAN_EXPIRY_OPTIONS } from '../admin-usage/ban-user-dialog/ban-user-dialog.component';

/** TTL choices for the "Ban IP" form, in seconds. Server max is 30 days (§2.4). */
export const IP_BAN_TTL_OPTIONS: { label: string; seconds: number }[] = [
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
];

/**
 * IPv4/IPv6 CIDR, client-side only (the server has the authoritative check,
 * plan §2.4): a bare address is treated as a single host (`/32` or
 * `/128`), and a prefix broader than `/16` (v4) or `/48` (v6) is rejected
 * so a typo can't collateral-ban half the internet.
 */
export function validateCidr(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'A CIDR or IP address is required';
  }
  const [address, prefixStr] = trimmed.split('/', 2);
  const isV6 = address.includes(':');
  const v4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const v6Pattern = /^[0-9a-fA-F:]+$/;

  if (isV6) {
    if (!v6Pattern.test(address)) {
      return 'Not a valid IPv6 address';
    }
    const prefix = prefixStr !== undefined ? Number(prefixStr) : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
      return 'IPv6 prefix must be between 0 and 128';
    }
    if (prefix < 48) {
      return 'IPv6 range cannot be broader than /48';
    }
    return null;
  }

  const match = v4Pattern.exec(address);
  if (!match || match.slice(1).some((octet) => Number(octet) > 255)) {
    return 'Not a valid IPv4 address';
  }
  const prefix = prefixStr !== undefined ? Number(prefixStr) : 32;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return 'IPv4 prefix must be between 0 and 32';
  }
  if (prefix < 16) {
    return 'IPv4 range cannot be broader than /16';
  }
  return null;
}

/**
 * `mat-form-field`'s default `ErrorStateMatcher` only flags a control
 * invalid via Angular's own validators (here, just `required`), so a
 * non-empty but malformed CIDR never flipped the field into its error
 * display (S5-04: the projected `<mat-error>` stayed hidden no matter what
 * `@if` wrapped it, because `mat-form-field` switches to showing it, and
 * sets `aria-invalid`/`aria-describedby` on the input, only when
 * `errorState` is true). Delegating `isErrorState` to a callback lets the
 * CIDR fields opt into the same error-display machinery from a plain
 * string error computed by {@link validateCidr}, without a template-driven
 * `NG_VALIDATORS` directive (which would need registering in the frozen
 * `app.module.ts`).
 */
class CallbackErrorStateMatcher implements ErrorStateMatcher {
  constructor(private readonly hasError: () => boolean) {}
  isErrorState(): boolean {
    return this.hasError();
  }
}

/**
 * Mobile-friendly admin view for managing user and IP bans: list active
 * bans, add a new ban by Keycloak subject or by CIDR, and remove either
 * kind (M4-AB-02 UI).
 */
@Component({
  selector: 'app-admin-bans',
  templateUrl: './admin-bans.component.html',
  styleUrls: ['./admin-bans.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false
})
export class AdminBansComponent implements OnInit {
  private banService = inject(BanService);
  private snackBar = inject(MatSnackBar);
  private confirmDialogService = inject(ConfirmDialogService);
  auth = inject(AuthService);

  readonly ipBanTtlOptions = IP_BAN_TTL_OPTIONS;
  readonly userBanExpiryOptions = USER_BAN_EXPIRY_OPTIONS;

  /** Bound to the IP-ban form's CIDR field so a malformed, non-empty value actually shows its `mat-error` (S5-04). */
  readonly ipCidrErrorStateMatcher = new CallbackErrorStateMatcher(() => !!this.ipCidrError);

  bans: Ban[] = [];
  loading = true;
  error: string | null = null;
  submitting = false;

  newBan: CreateBanRequest = {
    bannedKeycloakId: '',
    reason: '',
    expiresAt: null
  };
  /** Seconds until the new ban expires, or `null` for Permanent (S5-03: not the default). */
  newBanExpirySeconds: number | null = USER_BAN_EXPIRY_OPTIONS[2].seconds; // 7 days

  ipBans: IpBan[] = [];
  ipBansLoading = true;
  ipBansError: string | null = null;
  ipBanSubmitting = false;
  ipCidrError: string | null = null;

  newIpBan: { cidr: string; reason: string; ttlSeconds: number } = {
    cidr: '',
    reason: '',
    ttlSeconds: IP_BAN_TTL_OPTIONS[1].seconds,
  };

  ngOnInit(): void {
    this.loadBans();
    this.loadIpBans();
  }

  loadBans(): void {
    this.loading = true;
    this.error = null;
    this.banService.listBans().subscribe({
      next: (bans) => {
        this.bans = bans;
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load bans', err);
        this.error = 'Failed to load bans.';
        this.loading = false;
      }
    });
  }

  addBan(): void {
    if (!this.newBan.bannedKeycloakId?.trim()) {
      this.snackBar.open('Keycloak user ID is required', 'Dismiss', { duration: 3000 });
      return;
    }

    this.submitting = true;
    const expiresAt =
      this.newBanExpirySeconds === null ? null : new Date(Date.now() + this.newBanExpirySeconds * 1000).toISOString();
    const payload: CreateBanRequest = {
      bannedKeycloakId: this.newBan.bannedKeycloakId.trim(),
      reason: this.newBan.reason?.trim() || undefined,
      expiresAt
    };

    this.banService.createBan(payload).subscribe({
      next: () => {
        this.snackBar.open('User banned', 'Dismiss', { duration: 3000 });
        this.newBan = { bannedKeycloakId: '', reason: '', expiresAt: null };
        this.newBanExpirySeconds = USER_BAN_EXPIRY_OPTIONS[2].seconds;
        this.submitting = false;
        this.loadBans();
      },
      error: (err) => {
        console.error('Failed to create ban', err);
        // S5-09: surface the server's own message the way addIpBan already
        // does (403/409 come through here; 429/503 quota and rate-limit
        // copy is shown once by the global RateLimitInterceptor).
        this.snackBar.open(err?.error?.message || 'Failed to create ban', 'Dismiss', { duration: 4000 });
        this.submitting = false;
      }
    });
  }

  /** Removes a user ban, after naming the target in a confirmation, with an Undo that restores it (S5-02). */
  removeBan(ban: Ban): void {
    this.confirmDialogService
      .confirm({
        title: 'Remove ban',
        message: `Remove the ban on "${ban.bannedKeycloakId}"? They will be able to join and play games again.`,
        confirmText: 'Remove ban',
        destructive: true
      })
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.banService.removeBan(ban.id).subscribe({
          next: () => {
            const ref = this.snackBar.open('Ban removed', 'Undo', { duration: 6000 });
            ref.onAction().subscribe(() => this.undoRemoveBan(ban));
            this.loadBans();
          },
          error: (err) => {
            console.error('Failed to remove ban', err);
            this.snackBar.open(err?.error?.message || 'Failed to remove ban', 'Dismiss', { duration: 4000 });
          }
        });
      });
  }

  private undoRemoveBan(ban: Ban): void {
    this.banService
      .createBan({ bannedKeycloakId: ban.bannedKeycloakId, reason: ban.reason ?? undefined, expiresAt: ban.expiresAt })
      .subscribe({
        next: () => {
          this.snackBar.open('Ban restored', 'Dismiss', { duration: 3000 });
          this.loadBans();
        },
        error: (err) => {
          console.error('Failed to restore ban', err);
          this.snackBar.open('Failed to restore the ban', 'Dismiss', { duration: 4000 });
        }
      });
  }

  formatDate(value: string | null): string {
    if (!value) {
      return 'Never';
    }
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  /**
   * A relative expiry ("in 27 days"/"3 hours ago"), with `formatDate` kept
   * as the absolute value for a title/tooltip (S5-18, only if cheap).
   */
  formatRelativeExpiry(value: string | null): string {
    if (!value) {
      return 'Never';
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return value;
    }
    const diffMs = date.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    const minute = 60_000;
    const hour = 3_600_000;
    const day = 86_400_000;

    let amount: number;
    let unit: string;
    if (absMs < minute) {
      return diffMs >= 0 ? 'in under a minute' : 'just now';
    } else if (absMs < hour) {
      amount = Math.round(absMs / minute);
      unit = 'minute';
    } else if (absMs < day) {
      amount = Math.round(absMs / hour);
      unit = 'hour';
    } else {
      amount = Math.round(absMs / day);
      unit = 'day';
    }
    if (amount !== 1) {
      unit += 's';
    }
    return diffMs >= 0 ? `in ${amount} ${unit}` : `${amount} ${unit} ago`;
  }

  loadIpBans(): void {
    this.ipBansLoading = true;
    this.ipBansError = null;
    this.banService.listIpBans().subscribe({
      next: (bans) => {
        this.ipBans = bans;
        this.ipBansLoading = false;
      },
      error: (err) => {
        console.error('Failed to load IP bans', err);
        this.ipBansError = 'Failed to load IP bans.';
        this.ipBansLoading = false;
      }
    });
  }

  /** Live-validates the CIDR field as the admin types/leaves it, so the error shows before submit is attempted (S5-04). */
  onIpCidrChange(): void {
    this.ipCidrError = this.newIpBan.cidr.trim() ? validateCidr(this.newIpBan.cidr) : null;
  }

  onIpCidrBlur(): void {
    this.ipCidrError = validateCidr(this.newIpBan.cidr);
  }

  addIpBan(): void {
    this.ipCidrError = validateCidr(this.newIpBan.cidr);
    if (this.ipCidrError) {
      return;
    }

    this.ipBanSubmitting = true;
    const payload: CreateIpBanRequest = {
      cidr: this.newIpBan.cidr.trim(),
      reason: this.newIpBan.reason.trim() || undefined,
      ttlSeconds: this.newIpBan.ttlSeconds,
    };

    this.banService.createIpBan(payload).subscribe({
      next: () => {
        this.snackBar.open('IP banned', 'Dismiss', { duration: 3000 });
        this.newIpBan = { cidr: '', reason: '', ttlSeconds: IP_BAN_TTL_OPTIONS[1].seconds };
        this.ipBanSubmitting = false;
        this.loadIpBans();
      },
      error: (err) => {
        console.error('Failed to create IP ban', err);
        this.snackBar.open(err?.error?.message || 'Failed to create IP ban', 'Dismiss', { duration: 4000 });
        this.ipBanSubmitting = false;
      }
    });
  }

  /** Removes an IP ban, after naming the target in a confirmation, with an Undo that restores it (S5-02). */
  removeIpBan(ban: IpBan): void {
    this.confirmDialogService
      .confirm({
        title: 'Remove IP ban',
        message: `Remove the ban on "${ban.cidr}"?`,
        confirmText: 'Remove ban',
        destructive: true
      })
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.banService.removeIpBan(ban.id).subscribe({
          next: () => {
            const ref = this.snackBar.open('IP ban removed', 'Undo', { duration: 6000 });
            ref.onAction().subscribe(() => this.undoRemoveIpBan(ban));
            this.loadIpBans();
          },
          error: (err) => {
            console.error('Failed to remove IP ban', err);
            this.snackBar.open(err?.error?.message || 'Failed to remove IP ban', 'Dismiss', { duration: 4000 });
          }
        });
      });
  }

  private undoRemoveIpBan(ban: IpBan): void {
    this.banService.createIpBan({ cidr: ban.cidr, reason: ban.reason ?? undefined, expiresAt: ban.expiresAt }).subscribe({
      next: () => {
        this.snackBar.open('IP ban restored', 'Dismiss', { duration: 3000 });
        this.loadIpBans();
      },
      error: (err) => {
        console.error('Failed to restore IP ban', err);
        this.snackBar.open('Failed to restore the IP ban', 'Dismiss', { duration: 4000 });
      }
    });
  }
}
