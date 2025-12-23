import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

/**
 * Auth Guard to protect routes that require authentication.
 *
 * Redirects to login if user is not authenticated and auth is enabled.
 * Always allows access if auth is disabled (guest mode).
 */
@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {

    // If auth is disabled, always allow access (guest mode)
    if (!environment.authEnabled) {
      return true;
    }

    // Check if user is authenticated
    if (this.authService.isAuthenticated()) {
      return true;
    }

    // Not authenticated - redirect to login
    console.log('AuthGuard: User not authenticated, redirecting to login');
    this.authService.login();
    return false;
  }
}
