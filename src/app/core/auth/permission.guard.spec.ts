import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EMPTY, Subject } from 'rxjs';

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

    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'isAuthenticated', 'login', 'isInitialized', 'whenInitialized']);
    // Start-up already finished: the guards decide synchronously, as on every
    // navigation after the first. The NG-R3-05 block below covers the wait.
    authSpy.isInitialized.and.returnValue(true);
    authSpy.whenInitialized.and.returnValue(Promise.resolve());
    routerSpy = jasmine.createSpyObj('Router', ['createUrlTree']);
    routerSpy.createUrlTree.and.returnValue(urlTree);
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);
    // Real MatSnackBar.open() returns a ref with afterDismissed(); the guard
    // subscribes to it, so the spy needs one too or that subscribe throws.
    snackBarSpy.open.and.returnValue({ afterDismissed: () => EMPTY } as any);

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

    it('does not stack a second denial snackbar while one is still open (NG-R2-01)', () => {
      authSpy.hasPermission.and.returnValue(false);
      authSpy.isAuthenticated.and.returnValue(true);
      const dismissed$ = new Subject<void>();
      snackBarSpy.open.and.returnValue({ afterDismissed: () => dismissed$.asObservable() } as any);

      // One guard instance invoked twice, the way the router re-evaluates
      // canActivate for the same route across a redirect chain — not two
      // separately-constructed guards.
      const guard = permissionGuard('admin:access');
      const invoke = () => runInInjectionContext(injector, () => guard(null as any, fakeState));

      invoke();
      invoke();
      expect(snackBarSpy.open).toHaveBeenCalledTimes(1);

      // Once the first snackbar is actually dismissed, a later denial opens
      // a fresh one.
      dismissed$.next();
      invoke();
      expect(snackBarSpy.open).toHaveBeenCalledTimes(2);
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
  // NG-R3-05: at bootstrap AuthService may still be refreshing an expired
  // access token from a live refresh token. Deciding before that finishes saw
  // "not signed in" and started a full Keycloak redirect.
  describe('before AuthService start-up has finished (NG-R3-05)', () => {
    let finishInit: () => void;

    beforeEach(() => {
      environment.authEnabled = true;
      authSpy.isInitialized.and.returnValue(false);
      authSpy.whenInitialized.and.returnValue(new Promise<void>(resolve => { finishInit = resolve; }));
      // Until start-up finishes the stored access token is expired.
      authSpy.hasPermission.and.returnValue(false);
      authSpy.isAuthenticated.and.returnValue(false);
    });

    it('permissionGuard waits, then lets a user whose token was refreshed through without a login redirect', async () => {
      const result = runPermissionGuard('admin:access') as unknown as Promise<unknown>;
      expect(result instanceof Promise).toBeTrue();
      expect(authSpy.login).not.toHaveBeenCalled();

      // The refresh-on-reload succeeded.
      authSpy.hasPermission.and.returnValue(true);
      authSpy.isAuthenticated.and.returnValue(true);
      finishInit();

      expect(await result).toBeTrue();
      expect(authSpy.login).not.toHaveBeenCalled();
    });

    it('permissionGuard still sends the visitor to login when start-up ends signed out', async () => {
      const result = runPermissionGuard('admin:access') as unknown as Promise<unknown>;
      finishInit();

      expect(await result).toBeFalse();
      expect(authSpy.login).toHaveBeenCalledOnceWith(fakeState.url);
    });

    it('authenticatedGuard waits, then lets a user whose token was refreshed through', async () => {
      const result = runInInjectionContext(injector, () => authenticatedGuard(null as any, fakeState)) as unknown as Promise<unknown>;
      expect(result instanceof Promise).toBeTrue();
      expect(authSpy.login).not.toHaveBeenCalled();

      authSpy.isAuthenticated.and.returnValue(true);
      finishInit();

      expect(await result).toBeTrue();
      expect(authSpy.login).not.toHaveBeenCalled();
    });

    it('authenticatedGuard does not wait when auth is off', () => {
      environment.authEnabled = false;

      expect(runAuthenticatedGuard()).toBeTrue();
      expect(authSpy.whenInitialized).not.toHaveBeenCalled();
    });
  });
});
