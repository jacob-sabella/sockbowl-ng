import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BanService } from '../../../core/services/ban.service';
import { Ban, CreateBanRequest, CreateIpBanRequest, IpBan } from '../../../core/models/ban-models';
import { AuthService } from '../../../core/auth/auth.service';

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
  auth = inject(AuthService);

  readonly ipBanTtlOptions = IP_BAN_TTL_OPTIONS;

  bans: Ban[] = [];
  loading = true;
  error: string | null = null;
  submitting = false;

  newBan: CreateBanRequest = {
    bannedKeycloakId: '',
    reason: '',
    expiresAt: null
  };

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
    const payload: CreateBanRequest = {
      bannedKeycloakId: this.newBan.bannedKeycloakId.trim(),
      reason: this.newBan.reason?.trim() || undefined,
      expiresAt: this.newBan.expiresAt || null
    };

    this.banService.createBan(payload).subscribe({
      next: () => {
        this.snackBar.open('User banned', 'Dismiss', { duration: 3000 });
        this.newBan = { bannedKeycloakId: '', reason: '', expiresAt: null };
        this.submitting = false;
        this.loadBans();
      },
      error: (err) => {
        console.error('Failed to create ban', err);
        this.snackBar.open('Failed to create ban', 'Dismiss', { duration: 4000 });
        this.submitting = false;
      }
    });
  }

  removeBan(ban: Ban): void {
    this.banService.removeBan(ban.id).subscribe({
      next: () => {
        this.snackBar.open('Ban removed', 'Dismiss', { duration: 3000 });
        this.loadBans();
      },
      error: (err) => {
        console.error('Failed to remove ban', err);
        this.snackBar.open('Failed to remove ban', 'Dismiss', { duration: 4000 });
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

  removeIpBan(ban: IpBan): void {
    this.banService.removeIpBan(ban.id).subscribe({
      next: () => {
        this.snackBar.open('IP ban removed', 'Dismiss', { duration: 3000 });
        this.loadIpBans();
      },
      error: (err) => {
        console.error('Failed to remove IP ban', err);
        this.snackBar.open('Failed to remove IP ban', 'Dismiss', { duration: 4000 });
      }
    });
  }
}
