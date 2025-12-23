import { Injectable } from '@angular/core';
import { OAuthService, OAuthEvent } from 'angular-oauth2-oidc';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, filter } from 'rxjs';
import { authConfig } from './auth.config';
import { environment } from '../../../environments/environment';

/**
 * Authentication service for managing Keycloak OAuth2/OIDC authentication.
 *
 * Features:
 * - Login/logout via Keycloak
 * - Token management (access token, ID token, refresh token)
 * - User profile extraction from ID token
 * - Authentication state management
 * - Silent token refresh
 */
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  private userProfileSubject = new BehaviorSubject<any>(null);
  public userProfile$ = this.userProfileSubject.asObservable();

  constructor(
    private oauthService: OAuthService,
    private router: Router
  ) {
    if (environment.authEnabled) {
      this.configure();
    }
  }

  /**
   * Configure OAuth2 service and set up automatic token refresh
   */
  private configure(): void {
    this.oauthService.configure(authConfig);
    this.oauthService.setupAutomaticSilentRefresh();

    // Load discovery document and try to login
    this.oauthService.loadDiscoveryDocumentAndTryLogin().then(() => {
      if (this.oauthService.hasValidAccessToken()) {
        this.isAuthenticatedSubject.next(true);
        this.updateUserProfile();
      }
    });

    // Listen to token events
    this.oauthService.events
      .pipe(filter((e: OAuthEvent) => e.type === 'token_received'))
      .subscribe(() => {
        this.isAuthenticatedSubject.next(true);
        this.updateUserProfile();
      });

    this.oauthService.events
      .pipe(filter((e: OAuthEvent) => e.type === 'logout'))
      .subscribe(() => {
        this.isAuthenticatedSubject.next(false);
        this.userProfileSubject.next(null);
      });
  }

  /**
   * Initiate login flow (redirect to Keycloak)
   */
  public login(): void {
    if (!environment.authEnabled) {
      console.warn('Authentication is disabled');
      return;
    }
    this.oauthService.initCodeFlow();
  }

  /**
   * Logout and clear tokens
   */
  public logout(): void {
    if (!environment.authEnabled) {
      return;
    }
    this.oauthService.logOut();
    this.router.navigate(['/game-session']);
  }

  /**
   * Check if user is authenticated
   */
  public isAuthenticated(): boolean {
    if (!environment.authEnabled) {
      return false;
    }
    return this.oauthService.hasValidAccessToken();
  }

  /**
   * Get access token
   */
  public getAccessToken(): string | null {
    if (!environment.authEnabled) {
      return null;
    }
    return this.oauthService.getAccessToken();
  }

  /**
   * Get ID token claims
   */
  public getIdentityClaims(): any {
    if (!environment.authEnabled) {
      return null;
    }
    return this.oauthService.getIdentityClaims();
  }

  /**
   * Get user profile from ID token
   */
  public getUserProfile(): any {
    return this.userProfileSubject.value;
  }

  /**
   * Update user profile from ID token claims
   */
  private updateUserProfile(): void {
    const claims = this.getIdentityClaims();
    if (claims) {
      this.userProfileSubject.next({
        sub: claims['sub'],
        email: claims['email'],
        name: claims['name'] || claims['preferred_username'],
        preferredUsername: claims['preferred_username'],
      });
    }
  }

  /**
   * Manually refresh token
   */
  public async refreshToken(): Promise<OAuthEvent> {
    if (!environment.authEnabled) {
      return Promise.resolve({} as OAuthEvent);
    }
    return this.oauthService.silentRefresh();
  }
}
