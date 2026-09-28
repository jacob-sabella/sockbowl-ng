import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

/** Shown when a signed-in user hits a route they lack the permission for. */
export const PERMISSION_DENIED_MESSAGE = "You don't have permission to view that page.";

/**
 * Functional route guard factory that restricts access to users holding a
 * given fine-grained permission (realm role), e.g. `packet:create` or
 * `admin:access` (AUTH-15).
 *
 * - Auth disabled (self-hosted guest mode): {@link AuthService.hasPermission}
 *   always returns true, so the route is fully open.
 * - Auth enabled, anonymous: sends the user to Keycloak login with this
 *   route as the return target, so they land back here after signing in.
 * - Auth enabled, signed in but lacking the permission: redirected to
 *   `/game-session` with a snackbar, rather than a silent block.
 *
 * With auth on, it decides only after AuthService start-up has finished
 * (see afterAuthInitialized).
 */
export function permissionGuard(permission: string): CanActivateFn {
  // Angular can evaluate a route's guards more than once for a single
  // navigation (e.g. a redirect chain re-running canActivate). Without this,
  // each evaluation called snackBar.open() again, and two denial snackbars
  // could briefly coexist mid-animation — enough to break a strict-mode
  // Playwright locator (NG-R2-01). Track the one this guard opened and skip
  // opening another while it's still showing.
  let openSnackBarRef: ReturnType<MatSnackBar['open']> | null = null;

  return (_route, state: RouterStateSnapshot) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const snackBar = inject(MatSnackBar);

    const decide = () => {
      if (auth.hasPermission(permission)) {
        return true;
      }
      if (!auth.isAuthenticated()) {
        auth.login(state.url);
        return false;
      }
      if (!openSnackBarRef) {
        openSnackBarRef = snackBar.open(PERMISSION_DENIED_MESSAGE, 'Dismiss', { duration: 4000 });
        openSnackBarRef.afterDismissed().subscribe(() => { openSnackBarRef = null; });
      }
      return router.createUrlTree(['/game-session']);
    };
    return afterAuthInitialized(auth, decide);
  };
}

/**
 * Runs `decide` once AuthService has finished start-up (NG-R3-05). On a
 * reload with an expired access token, start-up refreshes it from the
 * refresh token; deciding before that would see "not signed in" and start a
 * full Keycloak redirect that throws away the just-rotated refresh token.
 * Synchronous when start-up is already done, which is every navigation
 * after the first.
 */
function afterAuthInitialized<T>(auth: AuthService, decide: () => T): T | Promise<T> {
  if (auth.isInitialized()) {
    return decide();
  }
  return auth.whenInitialized().then(decide);
}

/**
 * Route guard for pages any signed-in user may see, with no fine-grained
 * permission required (e.g. `/profile`).
 *
 * Auth disabled: always allows (guest mode). Auth enabled: sends anonymous
 * visitors to Keycloak login with this route as the return target, and
 * allows any authenticated user through regardless of role.
 */
export const authenticatedGuard: CanActivateFn = (_route, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  if (!environment.authEnabled) {
    return true;
  }
  return afterAuthInitialized(auth, () => {
    if (auth.isAuthenticated()) {
      return true;
    }
    auth.login(state.url);
    return false;
  });
};
