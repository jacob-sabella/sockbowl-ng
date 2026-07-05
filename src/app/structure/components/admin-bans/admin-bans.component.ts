import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BanService } from '../../../core/services/ban.service';
import { Ban, CreateBanRequest } from '../../../core/models/ban-models';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Mobile-friendly admin view for managing user bans: list active bans, add a
 * new ban by Keycloak subject, and remove an existing ban.
 */
@Component({
  selector: 'app-admin-bans',
  templateUrl: './admin-bans.component.html',
  styleUrls: ['./admin-bans.component.scss'],
  standalone: false
})
export class AdminBansComponent implements OnInit {
  bans: Ban[] = [];
  loading = true;
  error: string | null = null;
  submitting = false;

  newBan: CreateBanRequest = {
    bannedKeycloakId: '',
    reason: '',
    expiresAt: null
  };

  constructor(
    private banService: BanService,
    private snackBar: MatSnackBar,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loadBans();
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
}
