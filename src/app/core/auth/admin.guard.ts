import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

/**
 * Route guard that restricts access to administrators.
 *
 * Requires authentication to be enabled, the user to be signed in, and the
 * user to hold the `admin` realm role. Non-admins are redirected to the lobby.
 */
@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): boolean | UrlTree {

    // Admin features only exist when auth is enabled.
    if (!environment.authEnabled) {
      return this.router.createUrlTree(['/game-session']);
    }

    if (!this.authService.isAuthenticated()) {
      this.authService.login();
      return false;
    }

    if (this.authService.isAdmin()) {
      return true;
    }

    console.warn('AdminGuard: user lacks admin role, redirecting');
    return this.router.createUrlTree(['/game-session']);
  }
}
