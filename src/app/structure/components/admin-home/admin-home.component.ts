import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Admin landing page (AUTH-15). Reached only by users holding
 * `admin:access` (guarded by `permissionGuard('admin:access')` on the
 * `/admin` route). Links out to the existing Bans page, and holds a
 * placeholder for the usage/quota view M4 fills in (M4-AD-02).
 */
@Component({
  selector: 'app-admin-home',
  templateUrl: './admin-home.component.html',
  styleUrls: ['./admin-home.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false
})
export class AdminHomeComponent {
  auth = inject(AuthService);
}
