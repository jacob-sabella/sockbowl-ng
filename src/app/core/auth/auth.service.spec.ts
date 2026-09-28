import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import {
  OAuthErrorEvent,
  OAuthEvent,
  OAuthInfoEvent,
  OAuthService,
  OAuthSuccessEvent,
} from 'angular-oauth2-oidc';
import { EMPTY, Subject } from 'rxjs';

import { AuthService, SESSION_ENDED_MESSAGE } from './auth.service';
import { authConfig } from './auth.config';
import { environment } from '../../../environments/environment';

/**
 * Builds a fake (unsigned) JWT whose payload is the given claims object,
 * matching the base64url-encoded three-segment shape AuthService expects.
 */
function buildFakeAccessToken(payload: any): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('AuthService', () => {
  let service: AuthService;
  let oauthServiceSpy: jasmine.SpyObj<OAuthService>;
  let routerSpy: jasmine.SpyObj<Router>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let snackAction$: Subject<void>;
  let events$: Subject<OAuthEvent>;
  let originalAuthEnabled: boolean;

  beforeEach(() => {
    originalAuthEnabled = environment.authEnabled;
    environment.authEnabled = true;
    events$ = new Subject<OAuthEvent>();

    oauthServiceSpy = jasmine.createSpyObj(
      'OAuthService',
      [
        'configure',
        'loadDiscoveryDocument',
        'tryLoginCodeFlow',
        'hasValidAccessToken',
        'getAccessToken',
        'getAccessTokenExpiration',
        'getRefreshToken',
        'getIdentityClaims',
        'setupAutomaticSilentRefresh',
        'initCodeFlow',
        'logOut',
        'revokeTokenAndLogout',
        'refreshToken',
        'silentRefresh'
      ],
      { events: events$.asObservable() }
    );

    // Constructor calls configure(), which chains discovery -> login promises.
    oauthServiceSpy.loadDiscoveryDocument.and.returnValue(Promise.resolve({} as never));
    oauthServiceSpy.tryLoginCodeFlow.and.returnValue(Promise.resolve());
    oauthServiceSpy.hasValidAccessToken.and.returnValue(false);
    oauthServiceSpy.getRefreshToken.and.returnValue(null as unknown as string);
    // Tests below switch getRefreshToken on after construction; the startup
    // chain may then attempt a refresh, which must not blow up.
    oauthServiceSpy.refreshToken.and.returnValue(Promise.resolve({} as never));

    const accessToken = buildFakeAccessToken({
      realm_access: { roles: ['packet:read', 'game:host'] }
    });
    oauthServiceSpy.getAccessToken.and.returnValue(accessToken);

    routerSpy = jasmine.createSpyObj('Router', ['navigate', 'navigateByUrl'], { url: '/packets' });
    snackAction$ = new Subject<void>();
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);
    snackBarSpy.open.and.returnValue({ onAction: () => snackAction$.asObservable() } as unknown as MatSnackBarRef<TextOnlySnackBar>);

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: OAuthService, useValue: oauthServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: MatSnackBar, useValue: snackBarSpy }
      ]
    });

    service = TestBed.inject(AuthService);
  });

  afterEach(() => {
    environment.authEnabled = originalAuthEnabled;
  });

  // logOut is overloaded, which defeats toHaveBeenCalledWith typing.
  function logOutArgs(): unknown[][] {
    return oauthServiceSpy.logOut.calls.allArgs() as unknown as unknown[][];
  }

  function latestAuthState(): boolean | undefined {
    let value: boolean | undefined;
    service.isAuthenticated$.subscribe(v => (value = v)).unsubscribe();
    return value;
  }

  function latestSessionEnded(): boolean | undefined {
    let value: boolean | undefined;
    service.sessionEnded$.subscribe(v => (value = v)).unsubscribe();
    return value;
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('reads realm roles from the decoded access token', () => {
    expect(service.getRoles()).toEqual(['packet:read', 'game:host']);
  });

  it('getCurrentUserId falls back to the access token sub before the ID-token profile has loaded (NG-R2-04)', () => {
    // getIdentityClaims isn't stubbed in this describe's default setup, so
    // updateUserProfile never ran and getUserProfile() is still null — the
    // exact window in which an ownership check used to compare against a
    // stale null and could match a redacted owner.id of null.
    expect(service.getUserProfile()).toBeNull();
    oauthServiceSpy.getAccessToken.and.returnValue(
      buildFakeAccessToken({ sub: 'fallback-sub', realm_access: { roles: [] } })
    );
    expect(service.getCurrentUserId()).toBe('fallback-sub');
  });

  it('getCurrentUserId is null with no valid access token at all', () => {
    oauthServiceSpy.getAccessToken.and.returnValue(null as unknown as string);
    expect(service.getCurrentUserId()).toBeNull();
  });

  it('hasPermission is true for a role present in realm_access.roles', () => {
    oauthServiceSpy.hasValidAccessToken.and.returnValue(true);
    expect(service.hasPermission('packet:read')).toBeTrue();
  });

  it('hasPermission is false for a role not present in realm_access.roles', () => {
    oauthServiceSpy.hasValidAccessToken.and.returnValue(true);
    expect(service.hasPermission('packet:create')).toBeFalse();
  });

  it('hasPermission is false once the access token is no longer valid, even for a held role', () => {
    oauthServiceSpy.hasValidAccessToken.and.returnValue(false);
    expect(service.hasPermission('packet:read')).toBeFalse();
    expect(service.hasPermission('game:host')).toBeFalse();
  });

  describe('stored game seats (sockbowl.join.*)', () => {
    beforeEach(() => {
      sessionStorage.setItem('sockbowl.join.g1', JSON.stringify({ playerSessionId: 'p1', authenticated: true }));
      sessionStorage.setItem('sockbowl.join.g2', JSON.stringify({ playerSessionId: 'p2', playerSecret: 's', authenticated: false }));
      sessionStorage.setItem('unrelated.key', 'keep');
    });

    afterEach(() => {
      sessionStorage.removeItem('sockbowl.join.g1');
      sessionStorage.removeItem('sockbowl.join.g2');
      sessionStorage.removeItem('unrelated.key');
    });

    it('are cleared on logout', async () => {
      oauthServiceSpy.revokeTokenAndLogout.and.returnValue(Promise.resolve());

      await service.logout();

      expect(sessionStorage.getItem('sockbowl.join.g1')).toBeNull();
      expect(sessionStorage.getItem('sockbowl.join.g2')).toBeNull();
      expect(sessionStorage.getItem('unrelated.key')).toBe('keep');
    });

    it('are cleared when the session ends', () => {
      events$.next(new OAuthErrorEvent('token_refresh_error', {}));

      expect(sessionStorage.getItem('sockbowl.join.g1')).toBeNull();
      expect(sessionStorage.getItem('sockbowl.join.g2')).toBeNull();
      expect(sessionStorage.getItem('unrelated.key')).toBe('keep');
    });

    it('are kept when auth is off (logout is a no-op)', async () => {
      environment.authEnabled = false;

      await service.logout();

      expect(sessionStorage.getItem('sockbowl.join.g1')).not.toBeNull();
    });
  });

  describe('configuration', () => {
    it('uses the refresh-token flow, not the silent-refresh iframe', () => {
      expect(authConfig.useSilentRefresh).toBeFalse();
      expect(authConfig.silentRefreshRedirectUri).toBeFalsy();
      expect(oauthServiceSpy.setupAutomaticSilentRefresh).not.toHaveBeenCalled();
    });

    it('configures the OAuth client with the runtime postLogoutRedirectUri', () => {
      expect(environment.keycloak.postLogoutRedirectUri).toBeTruthy();
      expect(authConfig.postLogoutRedirectUri).toBe(environment.keycloak.postLogoutRedirectUri);
      const configured = oauthServiceSpy.configure.calls.mostRecent().args[0];
      expect(configured.postLogoutRedirectUri).toBe(environment.keycloak.postLogoutRedirectUri);
    });
  });

  describe('session-ending events', () => {
    beforeEach(() => {
      events$.next(new OAuthSuccessEvent('token_received'));
      expect(latestAuthState()).toBeTrue();
    });

    for (const type of ['token_refresh_error', 'session_terminated', 'token_error', 'session_error'] as const) {
      it(`${type} sets isAuthenticated$ false and calls logOut(true)`, () => {
        events$.next(new OAuthErrorEvent(type, {}));

        expect(latestAuthState()).toBeFalse();
        expect(logOutArgs()).toContain([true]);
        expect(service.getUserProfile()).toBeNull();
      });
    }

    it('sets sessionEnded$ true (S6-06: drives the navbar\'s persistent in-game Sign In)', () => {
      expect(latestSessionEnded()).toBeFalse();
      events$.next(new OAuthErrorEvent('token_refresh_error', {}));
      expect(latestSessionEnded()).toBeTrue();
    });

    it('clears sessionEnded$ once a token is received again', () => {
      events$.next(new OAuthErrorEvent('token_refresh_error', {}));
      expect(latestSessionEnded()).toBeTrue();

      events$.next(new OAuthSuccessEvent('token_received'));
      expect(latestSessionEnded()).toBeFalse();
    });

    it('prompts to sign in again once, and the action starts login', () => {
      events$.next(new OAuthErrorEvent('token_refresh_error', {}));
      events$.next(new OAuthErrorEvent('session_terminated', {}));

      expect(snackBarSpy.open).toHaveBeenCalledTimes(1);
      expect(snackBarSpy.open.calls.mostRecent().args[0]).toBe(SESSION_ENDED_MESSAGE);

      snackAction$.next();
      expect(oauthServiceSpy.initCodeFlow).toHaveBeenCalledWith('/packets', jasmine.any(Object));
    });
  });

  describe('token refresh', () => {
    const freshToken = buildFakeAccessToken({ realm_access: { roles: ['packet:create'] } });

    function resolveRefreshWith(token: string): void {
      oauthServiceSpy.refreshToken.and.callFake(() => {
        oauthServiceSpy.getAccessToken.and.returnValue(token);
        return Promise.resolve({} as never);
      });
    }

    beforeEach(() => {
      oauthServiceSpy.getRefreshToken.and.returnValue('refresh-token');
    });

    it('getFreshAccessToken refreshes when the token is near expiry', async () => {
      oauthServiceSpy.getAccessTokenExpiration.and.returnValue(Date.now() + 10_000);
      resolveRefreshWith(freshToken);

      const token = await service.getFreshAccessToken();

      expect(oauthServiceSpy.refreshToken).toHaveBeenCalledTimes(1);
      expect(token).toBe(freshToken);
    });

    it('getFreshAccessToken returns the current token without refreshing when it has time left', async () => {
      const current = oauthServiceSpy.getAccessToken();
      oauthServiceSpy.getAccessTokenExpiration.and.returnValue(Date.now() + 5 * 60_000);

      const token = await service.getFreshAccessToken();

      expect(oauthServiceSpy.refreshToken).not.toHaveBeenCalled();
      expect(token).toBe(current);
    });

    it('getFreshAccessToken resolves null when the refresh fails', async () => {
      oauthServiceSpy.getAccessTokenExpiration.and.returnValue(Date.now() - 1000);
      oauthServiceSpy.refreshToken.and.returnValue(Promise.reject(new Error('invalid_grant')));

      expect(await service.getFreshAccessToken()).toBeNull();
    });

    it('getFreshAccessToken resolves null when auth is off', async () => {
      environment.authEnabled = false;
      expect(await service.getFreshAccessToken()).toBeNull();
    });

    it('concurrent refreshes share one token request (refresh tokens rotate)', fakeAsync(() => {
      let resolveRefresh!: () => void;
      oauthServiceSpy.refreshToken.and.returnValue(
        new Promise<never>(resolve => (resolveRefresh = () => resolve({} as never)))
      );

      const results: (string | null)[] = [];
      service.refreshToken().then(t => results.push(t));
      service.refreshToken().then(t => results.push(t));
      expect(oauthServiceSpy.refreshToken).toHaveBeenCalledTimes(1);

      oauthServiceSpy.getAccessToken.and.returnValue(freshToken);
      resolveRefresh();
      flushMicrotasks();

      expect(results).toEqual([freshToken, freshToken]);

      // Once settled, the next refresh is a new request.
      oauthServiceSpy.refreshToken.and.returnValue(Promise.resolve({} as never));
      service.refreshToken();
      expect(oauthServiceSpy.refreshToken).toHaveBeenCalledTimes(2);
    }));

    it('refreshToken rejects without a request when there is no refresh token', async () => {
      oauthServiceSpy.getRefreshToken.and.returnValue(null as unknown as string);
      await expectAsync(service.refreshToken()).toBeRejected();
      expect(oauthServiceSpy.refreshToken).not.toHaveBeenCalled();
    });

    it('refreshToken rejects instead of throwing when oauthService throws synchronously (NG-R4-01)', () => {
      oauthServiceSpy.refreshToken.and.throwError('boom');

      let thrown: unknown;
      let result: Promise<string | null> | undefined;
      try {
        result = service.refreshToken();
      } catch (err) {
        thrown = err;
      }

      // The contract every caller relies on (`.catch(...)` or `await`): the
      // method itself never throws, it always hands back a promise.
      expect(thrown).toBeUndefined();
      return expectAsync(result).toBeRejected();
    });

    it('token_expires for the access token triggers a refresh', fakeAsync(() => {
      resolveRefreshWith(freshToken);
      events$.next(new OAuthInfoEvent('token_expires', 'access_token'));
      flushMicrotasks();
      expect(oauthServiceSpy.refreshToken).toHaveBeenCalledTimes(1);
    }));

    it('token_expires with no refresh token ends the session', fakeAsync(() => {
      oauthServiceSpy.getRefreshToken.and.returnValue(null as unknown as string);
      events$.next(new OAuthInfoEvent('token_expires', 'access_token'));
      flushMicrotasks();
      expect(logOutArgs()).toContain([true]);
      expect(latestAuthState()).toBeFalse();
    }));

    it('tokenChanges$ emits the new access token on token_refreshed', () => {
      const seen: string[] = [];
      service.tokenChanges$.subscribe(t => seen.push(t));
      oauthServiceSpy.getAccessToken.and.returnValue(freshToken);

      events$.next(new OAuthSuccessEvent('token_refreshed'));

      expect(seen).toEqual([freshToken]);
      expect(latestAuthState()).toBeTrue();
    });
  });

  describe('logout', () => {
    it('revokes the tokens and ends the Keycloak session (post-logout redirect)', async () => {
      oauthServiceSpy.revokeTokenAndLogout.and.returnValue(Promise.resolve());

      await service.logout();

      expect(oauthServiceSpy.revokeTokenAndLogout).toHaveBeenCalled();
      expect(oauthServiceSpy.logOut).not.toHaveBeenCalled();
      // The redirect back to the app is Keycloak's, via postLogoutRedirectUri;
      // the app does not navigate on its own.
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('still ends the session when revocation fails', async () => {
      oauthServiceSpy.revokeTokenAndLogout.and.returnValue(Promise.reject(new Error('cors')));

      await service.logout();

      expect(logOutArgs()).toContain([]);
    });

    it('ends the session directly when there is no access token to revoke', async () => {
      oauthServiceSpy.getAccessToken.and.returnValue(null as unknown as string);

      await service.logout();

      expect(oauthServiceSpy.revokeTokenAndLogout).not.toHaveBeenCalled();
      expect(logOutArgs()).toContain([]);
    });

    it('is a no-op when auth is off', async () => {
      environment.authEnabled = false;
      await service.logout();
      expect(oauthServiceSpy.revokeTokenAndLogout).not.toHaveBeenCalled();
      expect(oauthServiceSpy.logOut).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('passes a same-app target path as the OAuth state', () => {
      service.login('/admin/bans');
      expect(oauthServiceSpy.initCodeFlow).toHaveBeenCalledWith('/admin/bans', jasmine.any(Object));
    });

    it('drops targets that are not same-app paths', () => {
      service.login('//evil.example/phish');
      service.login('https://evil.example/');
      for (const call of oauthServiceSpy.initCodeFlow.calls.all()) {
        expect(call.args[0]).toBe('');
      }
    });
  });

  describe('when auth is off', () => {
    beforeEach(() => {
      environment.authEnabled = false;
    });

    it('hasPermission is true for every permission', () => {
      for (const p of ['packet:create', 'packet:manage-any', 'user:ban', 'admin:access', 'anything:else']) {
        expect(service.hasPermission(p)).withContext(p).toBeTrue();
      }
    });

    it('reports no user and no token', () => {
      expect(service.isAuthenticated()).toBeFalse();
      expect(service.getAccessToken()).toBeNull();
      expect(service.getRoles()).toEqual([]);
    });
  });
});

describe('AuthService login callback', () => {
  let originalAuthEnabled: boolean;

  beforeEach(() => {
    originalAuthEnabled = environment.authEnabled;
    environment.authEnabled = true;
  });

  afterEach(() => {
    environment.authEnabled = originalAuthEnabled;
  });

  function setup(opts: { validToken: boolean; refreshToken: string | null; discoveryFails?: boolean }) {
    const oauth = jasmine.createSpyObj(
      'OAuthService',
      ['configure', 'loadDiscoveryDocument', 'tryLoginCodeFlow', 'hasValidAccessToken',
        'getAccessToken', 'getRefreshToken', 'getIdentityClaims', 'refreshToken', 'logOut'],
      { events: EMPTY }
    );
    oauth.loadDiscoveryDocument.and.returnValue(
      opts.discoveryFails ? Promise.reject(new Error('down')) : Promise.resolve({}));
    oauth.tryLoginCodeFlow.and.returnValue(Promise.resolve());
    oauth.hasValidAccessToken.and.returnValue(opts.validToken);
    oauth.getRefreshToken.and.returnValue(opts.refreshToken);
    oauth.refreshToken.and.callFake(() => {
      oauth.hasValidAccessToken.and.returnValue(true);
      return Promise.resolve({});
    });
    oauth.getAccessToken.and.returnValue(buildFakeAccessToken({ realm_access: { roles: [] } }));
    oauth.getIdentityClaims.and.returnValue({ sub: 'u1', preferred_username: 'u1' });

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: OAuthService, useValue: oauth },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigateByUrl']) },
      ]
    });
    return { oauth, service: TestBed.inject(AuthService) };
  }

  it('refreshes on load when the access token expired but a refresh token remains', fakeAsync(() => {
    const { oauth, service } = setup({ validToken: false, refreshToken: 'r1' });
    flushMicrotasks();
    expect(oauth.refreshToken).toHaveBeenCalledTimes(1);
    expect(service.getCurrentUserId()).toBe('u1');
  }));

  it('does not refresh on load when there is no refresh token', fakeAsync(() => {
    const { oauth } = setup({ validToken: false, refreshToken: null });
    flushMicrotasks();
    expect(oauth.refreshToken).not.toHaveBeenCalled();
  }));
  // NG-R3-05: route guards wait on whenInitialized, so it must not resolve
  // until the refresh-on-reload has finished.
  it('is initialized only after the refresh-on-reload has finished', fakeAsync(() => {
    let finishRefresh!: () => void;
    const { oauth, service } = setup({ validToken: false, refreshToken: 'r1' });
    oauth.refreshToken.and.callFake(() => new Promise(resolve => {
      finishRefresh = () => { oauth.hasValidAccessToken.and.returnValue(true); resolve({}); };
    }));
    let resolved = false;
    service.whenInitialized().then(() => (resolved = true));

    flushMicrotasks();
    expect(oauth.refreshToken).toHaveBeenCalledTimes(1);
    expect(service.isInitialized()).toBeFalse();
    expect(resolved).toBeFalse();

    finishRefresh();
    flushMicrotasks();
    expect(service.isInitialized()).toBeTrue();
    expect(resolved).toBeTrue();
    expect(service.isAuthenticated()).toBeTrue();
  }));

  it('is initialized even when discovery fails', fakeAsync(() => {
    const { service } = setup({ validToken: false, refreshToken: null, discoveryFails: true });
    flushMicrotasks();
    expect(service.isInitialized()).toBeTrue();
  }));

  it('gives up waiting after a timeout when start-up never finishes', fakeAsync(() => {
    const { oauth, service } = setup({ validToken: false, refreshToken: 'r1' });
    oauth.refreshToken.and.returnValue(new Promise(() => { /* never settles */ }));
    flushMicrotasks();
    expect(service.isInitialized()).toBeFalse();

    tick(10_000);
    expect(service.isInitialized()).toBeTrue();
  }));

  it('is initialized immediately when auth is off', () => {
    environment.authEnabled = false;
    const { service } = setup({ validToken: false, refreshToken: null });
    expect(service.isInitialized()).toBeTrue();
  });
});
