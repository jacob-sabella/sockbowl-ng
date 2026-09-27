import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';

import { authenticatedGuard, permissionGuard, PERMISSION_DENIED_MESSAGE } from './permission.guard';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

describe('permissionGuard / authenticatedGuard', () => {
  let authSpy: jasmine.SpyObj<AuthService>;
  let routerSpy: jasmine.SpyObj<Router>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let injector: EnvironmentInjector;
  let originalAuthEnabled: boolean;
  const fakeState = { url: '/packets' } as RouterStateSnapshot;
  const urlTree = { fake: 'urlTree' } as any;

  beforeEach(() => {
    originalAuthEnabled = environment.authEnabled;

    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'isAuthenticated', 'login']);
    routerSpy = jasmine.createSpyObj('Router', ['createUrlTree']);
    routerSpy.createUrlTree.and.returnValue(urlTree);
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: Router, useValue: routerSpy },
        { provide: MatSnackBar, useValue: snackBarSpy },
      ],
    });
    injector = TestBed.inject(EnvironmentInjector);
  });

  afterEach(() => {
    environment.authEnabled = originalAuthEnabled;
  });

  function runPermissionGuard(permission: string): boolean | ReturnType<Router['createUrlTree']> {
    return runInInjectionContext(injector, () => permissionGuard(permission)(null as any, fakeState) as any);
  }

  function runAuthenticatedGuard(): boolean {
    return runInInjectionContext(injector, () => authenticatedGuard(null as any, fakeState) as boolean);
  }

  describe('permissionGuard', () => {
    it('allows through when the user holds the permission (auth off always does)', () => {
      authSpy.hasPermission.and.returnValue(true);

      expect(runPermissionGuard('packet:create')).toBeTrue();
      expect(authSpy.login).not.toHaveBeenCalled();
      expect(routerSpy.createUrlTree).not.toHaveBeenCalled();
    });

    it('sends an anonymous visitor to login with this route as the return target', () => {
      authSpy.hasPermission.and.returnValue(false);
      authSpy.isAuthenticated.and.returnValue(false);

      expect(runPermissionGuard('packet:create')).toBeFalse();
      expect(authSpy.login).toHaveBeenCalledWith(fakeState.url);
      expect(routerSpy.createUrlTree).not.toHaveBeenCalled();
    });

    it('redirects a signed-in user who lacks the permission, with a snackbar', () => {
      authSpy.hasPermission.and.returnValue(false);
      authSpy.isAuthenticated.and.returnValue(true);

      const result = runPermissionGuard('admin:access');

      expect(result).toBe(urlTree);
      expect(routerSpy.createUrlTree).toHaveBeenCalledWith(['/game-session']);
      expect(snackBarSpy.open).toHaveBeenCalledWith(PERMISSION_DENIED_MESSAGE, 'Dismiss', { duration: 4000 });
      expect(authSpy.login).not.toHaveBeenCalled();
    });
  });

  describe('authenticatedGuard', () => {
    it('allows anonymous access when auth is off (guest mode)', () => {
      environment.authEnabled = false;
      authSpy.isAuthenticated.and.returnValue(false);

      expect(runAuthenticatedGuard()).toBeTrue();
      expect(authSpy.login).not.toHaveBeenCalled();
    });

    it('sends an anonymous visitor to login when auth is on', () => {
      environment.authEnabled = true;
      authSpy.isAuthenticated.and.returnValue(false);

      expect(runAuthenticatedGuard()).toBeFalse();
      expect(authSpy.login).toHaveBeenCalledWith(fakeState.url);
    });

    it('allows any signed-in user through when auth is on', () => {
      environment.authEnabled = true;
      authSpy.isAuthenticated.and.returnValue(true);

      expect(runAuthenticatedGuard()).toBeTrue();
      expect(authSpy.login).not.toHaveBeenCalled();
    });
  });
});
