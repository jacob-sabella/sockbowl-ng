import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';
import { EMPTY } from 'rxjs';

import { AuthService } from './auth.service';

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

  beforeEach(() => {
    oauthServiceSpy = jasmine.createSpyObj(
      'OAuthService',
      [
        'configure',
        'loadDiscoveryDocument',
        'tryLoginCodeFlow',
        'hasValidAccessToken',
        'getAccessToken',
        'getIdentityClaims',
        'setupAutomaticSilentRefresh',
        'initCodeFlow',
        'logOut',
        'silentRefresh'
      ],
      { events: EMPTY }
    );

    // Constructor calls configure(), which chains discovery -> login promises.
    oauthServiceSpy.loadDiscoveryDocument.and.returnValue(Promise.resolve({} as any));
    oauthServiceSpy.tryLoginCodeFlow.and.returnValue(Promise.resolve());
    oauthServiceSpy.hasValidAccessToken.and.returnValue(false);

    const accessToken = buildFakeAccessToken({
      realm_access: { roles: ['packet:read', 'game:host'] }
    });
    oauthServiceSpy.getAccessToken.and.returnValue(accessToken);

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: OAuthService, useValue: oauthServiceSpy },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) }
      ]
    });

    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('reads realm roles from the decoded access token', () => {
    expect(service.getRoles()).toEqual(['packet:read', 'game:host']);
  });

  it('hasPermission is true for a role present in realm_access.roles', () => {
    expect(service.hasPermission('packet:read')).toBeTrue();
  });

  it('hasPermission is false for a role not present in realm_access.roles', () => {
    expect(service.hasPermission('packet:create')).toBeFalse();
  });

  it('isAdmin is false when the admin role is absent', () => {
    expect(service.isAdmin()).toBeFalse();
  });
});
