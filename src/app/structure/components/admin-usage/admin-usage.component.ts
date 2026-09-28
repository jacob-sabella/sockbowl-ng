import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

import { UsageService } from '../../../core/services/usage.service';
import { BanService } from '../../../core/services/ban.service';
import { metricLabel } from '../../../core/http/limit-messages';
import { isLimitHandled } from '../../../core/http/limit-errors';
import {
  GlobalUsage,
  RateLimitEvent,
  UsageCounter,
  UserUsageDetail,
  UserUsageSummary,
} from '../../../core/models/usage-models';
import { EditQuotaDialogComponent, EditQuotaDialogResult } from './edit-quota-dialog/edit-quota-dialog.component';
import { BanUserDialogComponent } from './ban-user-dialog/ban-user-dialog.component';
import { IpBanDialogComponent } from './ip-ban-dialog/ip-ban-dialog.component';

/**
 * Admin usage/quota view (M4-AD-02, plan §2.9): a global AI-budget card,
 * a searchable/paginated table of per-user usage with expandable detail
 * rows, and actions to ban a user or an IP, reset today's counters, and
 * edit a quota override.
 *
 * Standalone (like M2's `StompErrorBannerComponent`), reached only via the
 * `/admin/usage` route (guarded by `permissionGuard('admin:access')`), so
 * it never needs to be declared in `AppModule`.
 */
@Component({
  selector: 'app-admin-usage',
  templateUrl: './admin-usage.component.html',
  styleUrls: ['./admin-usage.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTableModule,
    MatTooltipModule,
  ],
})
export class AdminUsageComponent implements OnInit {
  private usageService = inject(UsageService);
  private banService = inject(BanService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  // This component is OnPush, and every state change below happens inside an
  // HTTP `subscribe`/dialog `afterClosed` callback rather than a template
  // event handler on this component itself -- zone.js still runs a global
  // CD tick when those settle, but OnPush skips this subtree unless it's
  // explicitly marked dirty first (found live, WP-E1: the page's own
  // network calls always completed and returned 200, but the spinner and
  // table never left their initial state).
  private cdr = inject(ChangeDetectorRef);

  readonly displayedColumns = ['user', 'tier', 'lastSeen', 'status', 'sessions', 'packets', 'expand'];
  readonly metricLabel = metricLabel;

  global: GlobalUsage | null = null;
  globalLoading = true;

  rows: UserUsageSummary[] = [];
  totalElements = 0;
  pageIndex = 0;
  pageSize = 20;
  searchQuery = '';
  loading = true;
  error: string | null = null;

  expandedSub: string | null = null;
  detail: UserUsageDetail | null = null;
  detailLoading = false;
  detailError: string | null = null;

  recentEvents: RateLimitEvent[] = [];
  eventsLoading = true;

  ngOnInit(): void {
    this.load();
    this.loadGlobal();
    this.loadEvents();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.usageService.list(this.pageIndex, this.pageSize, this.searchQuery.trim() || undefined, 'lastSeen').subscribe({
      next: (page) => {
        this.rows = page.content;
        this.totalElements = page.totalElements;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load usage', err);
        this.error = 'Failed to load usage data.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  loadGlobal(): void {
    this.globalLoading = true;
    this.usageService.global().subscribe({
      next: (g) => {
        this.global = g;
        this.globalLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load global usage', err);
        this.global = null;
        this.globalLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  loadEvents(): void {
    this.eventsLoading = true;
    this.usageService.events(100).subscribe({
      next: (events) => {
        this.recentEvents = events;
        this.eventsLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load rejection events', err);
        this.recentEvents = [];
        this.eventsLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  onSearch(): void {
    this.pageIndex = 0;
    this.load();
  }

  onPage(event: PageEvent): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.load();
  }

  /** "—" for packets a down questions service left unknown; "∞" is handled separately by counters. */
  packetsDisplay(row: UserUsageSummary): string {
    return row.packetsOwned === null || row.packetsOwned === undefined ? '—' : String(row.packetsOwned);
  }

  isUnlimited(counter: UsageCounter): boolean {
    return counter.limit === -1;
  }

  meterPercent(counter: UsageCounter): number {
    if (counter.limit <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((counter.used / counter.limit) * 100));
  }

  toggleDetail(row: UserUsageSummary): void {
    if (this.expandedSub === row.keycloakId) {
      this.expandedSub = null;
      this.detail = null;
      return;
    }
    this.expandedSub = row.keycloakId;
    this.loadDetail(row.keycloakId);
  }

  private loadDetail(sub: string): void {
    this.detail = null;
    this.detailLoading = true;
    this.detailError = null;
    this.usageService.detail(sub).subscribe({
      next: (detail) => {
        // NG-V1-04: this request isn't cancelled when a newer one starts (two
        // in-flight `detail` calls for different rows are possible if an
        // admin expands row A then quickly switches to row B before A's
        // response lands), so a slow response for a row that's no longer
        // expanded must never overwrite what's currently shown.
        if (this.expandedSub !== sub) {
          return;
        }
        this.detail = detail;
        this.detailLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load usage detail', err);
        if (this.expandedSub !== sub) {
          return;
        }
        this.detailError = 'Failed to load detail.';
        this.detailLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private refreshRow(sub: string): void {
    this.load();
    if (this.expandedSub === sub) {
      this.loadDetail(sub);
    }
  }

  editQuota(row: UserUsageSummary, counter: UsageCounter): void {
    this.dialog
      .open(EditQuotaDialogComponent, {
        width: '360px',
        data: { metric: counter.metric, currentLimit: counter.limit, overridden: counter.overridden },
      })
      .afterClosed()
      .subscribe((result: EditQuotaDialogResult | undefined) => {
        if (!result) {
          return;
        }
        this.usageService.setQuotaOverride(row.keycloakId, counter.metric, result.limit).subscribe({
          next: () => {
            this.snackBar.open('Quota updated', 'Dismiss', { duration: 3000 });
            this.refreshRow(row.keycloakId);
            this.cdr.markForCheck();
          },
          error: (err) => {
            console.error('Failed to set quota override', err);
            // A 429 or a 403 banned/ip_banned is already surfaced by the
            // global RateLimitInterceptor; don't double the snackbar (NG-V1-01).
            if (isLimitHandled(err)) {
              return;
            }
            this.snackBar.open('Failed to update quota', 'Dismiss', { duration: 4000 });
            this.cdr.markForCheck();
          },
        });
      });
  }

  resetUsage(row: UserUsageSummary, metric?: string): void {
    this.usageService.resetUsage(row.keycloakId, metric).subscribe({
      next: () => {
        this.snackBar.open('Usage reset', 'Dismiss', { duration: 3000 });
        this.refreshRow(row.keycloakId);
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to reset usage', err);
        // A 429 or a 403 banned/ip_banned is already surfaced by the
        // global RateLimitInterceptor; don't double the snackbar (NG-V1-01).
        if (isLimitHandled(err)) {
          return;
        }
        this.snackBar.open('Failed to reset usage', 'Dismiss', { duration: 4000 });
        this.cdr.markForCheck();
      },
    });
  }

  banUser(row: UserUsageSummary): void {
    this.dialog
      .open(BanUserDialogComponent, {
        width: '400px',
        data: { keycloakId: row.keycloakId, displayName: row.displayName },
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.banService.createBan(result).subscribe({
          next: () => {
            this.snackBar.open('User banned', 'Dismiss', { duration: 3000 });
            this.refreshRow(row.keycloakId);
            this.cdr.markForCheck();
          },
          error: (err) => {
            console.error('Failed to ban user', err);
            // A 429 or a 403 banned/ip_banned is already surfaced by the
            // global RateLimitInterceptor; don't double the snackbar (NG-V1-01).
            if (isLimitHandled(err)) {
              return;
            }
            this.snackBar.open('Failed to ban user', 'Dismiss', { duration: 4000 });
            this.cdr.markForCheck();
          },
        });
      });
  }

  banIp(ip: string): void {
    this.dialog
      .open(IpBanDialogComponent, { width: '400px', data: { cidr: ip } })
      .afterClosed()
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.banService.createIpBan(result).subscribe({
          next: () => {
            this.snackBar.open('IP banned', 'Dismiss', { duration: 3000 });
            this.cdr.markForCheck();
          },
          error: (err) => {
            console.error('Failed to ban IP', err);
            // A 429 or a 403 banned/ip_banned is already surfaced by the
            // global RateLimitInterceptor; don't double the snackbar (NG-V1-01).
            if (isLimitHandled(err)) {
              return;
            }
            this.snackBar.open(err?.error?.message || 'Failed to ban IP', 'Dismiss', { duration: 4000 });
            this.cdr.markForCheck();
          },
        });
      });
  }

  formatDate(value: string | null | undefined): string {
    if (!value) {
      return 'Never';
    }
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString();
  }
}
