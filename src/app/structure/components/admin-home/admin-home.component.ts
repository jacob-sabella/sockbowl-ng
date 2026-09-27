import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { UsageService } from '../../../core/services/usage.service';
import { GlobalUsage } from '../../../core/models/usage-models';

/**
 * Admin landing page (AUTH-15). Reached only by users holding
 * `admin:access` (guarded by `permissionGuard('admin:access')` on the
 * `/admin` route). Links out to the existing Bans page, and its Usage
 * card links to `/admin/usage` (M4-AD-02) with a small AI-budget meter.
 */
@Component({
  selector: 'app-admin-home',
  templateUrl: './admin-home.component.html',
  styleUrls: ['./admin-home.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false
})
export class AdminHomeComponent implements OnInit {
  auth = inject(AuthService);
  private usageService = inject(UsageService);

  globalUsage: GlobalUsage | null = null;

  ngOnInit(): void {
    this.usageService.global().subscribe({
      next: (g) => (this.globalUsage = g),
      error: (err) => {
        console.error('Failed to load global usage', err);
        this.globalUsage = null;
      },
    });
  }

  aiBudgetPercent(): number {
    if (!this.globalUsage || this.globalUsage.aiServerKey.limit <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((this.globalUsage.aiServerKey.used / this.globalUsage.aiServerKey.limit) * 100));
  }
}
