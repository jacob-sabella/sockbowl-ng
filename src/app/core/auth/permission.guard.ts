import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Functional route guard factory that restricts access to users holding a
 * given fine-grained permission (realm role), e.g. `packet:create` or
 * `admin:access`.
 *
 * In guest mode (auth disabled) `hasPermission` always returns true, so
 * routes guarded this way are fully open to guests as well; the guard only
 * bites once auth is enabled and the signed-in user lacks the permission.
 */
export function permissionGuard(permission: string): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (auth.hasPermission(permission)) {
      return true;
    }
    router.navigate(['/game-session']);
    return false;
  };
}
