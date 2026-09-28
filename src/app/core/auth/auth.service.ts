import { Injectable, inject } from '@angular/core';
import { OAuthService, OAuthEvent } from 'angular-oauth2-oidc';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { authConfig } from './auth.config';
import { environment } from '../../../environments/environment';
import { ThemeService } from '../services/theme.service';
import { clearAllGameJoins } from '../../game/services/game-join-storage';

/** OAuth events that mean the session is gone and the user must sign in again. */
const SESSION_ENDING_EVENTS: ReadonlySet<string> = new Set([
  'token_refresh_error',
  'token_error',
  'session_terminated',
  'session_error',
]);

/** A token with fewer than this many ms left is refreshed before use. */
const MIN_TOKEN_VALIDITY_MS = 30_000;

/**
 * Longest the route guards wait for {@link AuthService.whenInitialized}
 * before deciding anyway (an unreachable Keycloak must not hang navigation).
 */
const INIT_TIMEOUT_MS = 10_000;

/** Message shown when the session ends underneath the user (AUTH-13). */
export const SESSION_ENDED_MESSAGE = 'Your session ended. Sign in again.';

/**
 * Authentication service for managing Keycloak OAuth2/OIDC authentication.
 *
 * Token lifecycle (AUTH-13):
 * - Authorization code flow with PKCE, then the refresh-token flow (no
 *   silent-refresh iframe). Keycloak rotates refresh tokens and allows no
 *   reuse, so every refresh in the app goes through {@link refreshToken},
 *   which shares a single in-flight request between concurrent callers.
 * - `token_expires` (the library's timer at 75% of the token lifetime)
 *   triggers a refresh.
 * - `token_refresh_error`, `token_error`, `session_terminated` and
 *   `session_error` end the session locally (`logOut(true)`), flip
 *   `isAuthenticated$` to false and prompt the user to sign in again.
 * - {@link logout} revokes the tokens and ends the Keycloak session, which
 *   sends the browser to `postLogoutRedirectUri`.
 * - Both logout and a session end clear the tab's stored game seats
 *   (`sockbowl.join.*`).
 */
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private oauthService = inject(OAuthService);
  private router = inject(Router);
  private themeService = inject(ThemeService);
  private snackBar = inject(MatSnackBar, { optional: true });

  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  private userProfileSubject = new BehaviorSubject<any>(null);
  public userProfile$ = this.userProfileSubject.asObservable();

  private sessionEndedSubject = new BehaviorSubject<boolean>(false);
  /**
   * True once {@link handleSessionEnded} has fired and no new token has
   * arrived since (S6-06). The navbar keeps a persistent sign-in path
   * visible in `/game` while this is true, since the ordinary guest chrome
   * is hidden there for legitimate anonymous seat play.
   */
  public readonly sessionEnded$: Observable<boolean> = this.sessionEndedSubject.asObservable();

  private tokenChangesSubject = new Subject<string>();
  /**
   * Emits the new access token each time it is refreshed. Long-lived
   * consumers that hold a token outside HTTP (the STOMP socket) listen here.
   */
  public readonly tokenChanges$: Observable<string> = this.tokenChangesSubject.asObservable();

  /** The refresh currently on the wire, shared by every concurrent caller. */
  private refreshInFlight: Promise<string | null> | null = null;

  /** Set once the "session ended" prompt is shown; cleared by a new token. */
  private sessionEndNotified = false;

  private initializedFlag = false;
  private resolveInitialized!: () => void;
  private readonly initializedPromise = new Promise<void>(resolve => { this.resolveInitialized = resolve; });
  private initTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (environment.authEnabled) {
      this.initTimer = setTimeout(() => this.markInitialized(), INIT_TIMEOUT_MS);
      this.configure();
    } else {
      this.markInitialized();
    }
  }

  /**
   * Whether start-up has finished: discovery, the login callback and the
   * refresh-on-reload of an expired access token (NG-R3-05). Always true
   * when auth is off.
   */
  public isInitialized(): boolean {
    return this.initializedFlag;
  }

  /**
   * Resolves once start-up has finished (see {@link isInitialized}), or after
   * a timeout if Keycloak can't be reached. Route guards wait on this so a
   * reload with an expired access token but a live refresh token refreshes
   * instead of bouncing through a full Keycloak login redirect.
   */
  public whenInitialized(): Promise<void> {
    return this.initializedPromise;
  }

  private markInitialized(): void {
    if (this.initTimer) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    if (!this.initializedFlag) {
      this.initializedFlag = true;
      this.resolveInitialized();
    }
  }

  /**
   * Configure the OAuth2 service, wire up the token lifecycle and process a
   * login callback if this page load is one.
   */
  private configure(): void {
    this.oauthService.configure(authConfig);

    this.oauthService.events.subscribe((e: OAuthEvent) => this.onOAuthEvent(e));

    // Whether this page load is the redirect back from Keycloak.
    const isLoginCallback = window.location.search.includes('code=');

    // Load discovery document and try to login
    this.oauthService.loadDiscoveryDocument().then(() => {
      return this.oauthService.tryLoginCodeFlow();
    }).then(async () => {
      if (!this.oauthService.hasValidAccessToken() && this.oauthService.getRefreshToken()) {
        // Page reload after the access token expired: the refresh token may
        // still be good. A failure ends the session via token_refresh_error.
        await this.refreshToken().catch(() => undefined);
      }

      if (this.oauthService.hasValidAccessToken()) {
        this.isAuthenticatedSubject.next(true);
        this.updateUserProfile();

        // Clean up URL if we just processed a callback
        if (window.location.href.includes('code=')) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        if (isLoginCallback) {
          this.navigateToLoginTarget();
        }
      }
    }).catch(error => {
      console.error('[AuthService] Authentication error:', error);
    }).finally(() => this.markInitialized());
  }

  private onOAuthEvent(e: OAuthEvent): void {
    switch (e.type) {
      case 'token_received':
        this.sessionEndNotified = false;
        this.sessionEndedSubject.next(false);
        this.isAuthenticatedSubject.next(true);
        this.updateUserProfile();
        break;
      case 'token_refreshed': {
        this.sessionEndedSubject.next(false);
        this.isAuthenticatedSubject.next(true);
        this.updateUserProfile();
        const token = this.oauthService.getAccessToken();
        if (token) {
          this.tokenChangesSubject.next(token);
        }
        break;
      }
      case 'token_expires':
        if ((e as OAuthEvent & { info?: unknown }).info === 'access_token') {
          this.refreshToken().catch(() => this.handleSessionEnded());
        }
        break;
      case 'logout':
        this.isAuthenticatedSubject.next(false);
        this.userProfileSubject.next(null);
        break;
      default:
        if (SESSION_ENDING_EVENTS.has(e.type)) {
          this.handleSessionEnded();
        }
    }
  }

  /**
   * Ends the session locally after the tokens became unusable (refresh
   * failed, the IdP ended the session, or the backend kept rejecting the
   * token). Clears the stored tokens without a redirect, flips the auth
   * state, and prompts once to sign in again. Idempotent.
   */
  public handleSessionEnded(): void {
    if (!environment.authEnabled) {
      return;
    }
    this.refreshInFlight = null;
    clearAllGameJoins();
    this.oauthService.logOut(true);
    this.isAuthenticatedSubject.next(false);
    this.userProfileSubject.next(null);
    this.sessionEndedSubject.next(true);

    if (!this.sessionEndNotified) {
      this.sessionEndNotified = true;
      this.snackBar
        ?.open(SESSION_ENDED_MESSAGE, 'Sign in', { duration: 10000 })
        ?.onAction()
        .subscribe(() => this.login(this.router.url));
    }
  }

  /**
   * Initiate login flow (redirect to Keycloak).
   *
   * @param targetUrl app path to return to after login (e.g. the guarded
   *   route that sent the user here). Only same-app paths are honoured.
   */
  public login(targetUrl?: string): void {
    if (!environment.authEnabled) {
      console.warn('Authentication is disabled');
      return;
    }
    const state = AuthService.isSafeAppPath(targetUrl) ? targetUrl : '';
    // Carry the user's current theme through to the Keycloak login page so it
    // matches the app (the sockbowl login theme reads ?ui_theme via a head script).
    this.oauthService.initCodeFlow(state, { ui_theme: this.themeService.getResolvedTheme() });
  }

  /**
   * Log out: revoke the access and refresh tokens, then end the Keycloak
   * session. Keycloak redirects the browser to `postLogoutRedirectUri`.
   * If revocation fails, the plain end-session redirect still runs.
   */
  public async logout(): Promise<void> {
    if (!environment.authEnabled) {
      return;
    }
    // Stored seats belong to this session; don't leave them for the next user.
    clearAllGameJoins();
    if (!this.oauthService.getAccessToken()) {
      // revokeTokenAndLogout is a no-op without an access token.
      this.oauthService.logOut();
      return;
    }
    try {
      await this.oauthService.revokeTokenAndLogout();
    } catch (error) {
      console.warn('[AuthService] Token revocation failed; ending session anyway', error);
      this.oauthService.logOut();
    }
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
   * Get the current access token as stored (it may be close to expiry; use
   * {@link getFreshAccessToken} for long-lived channels like STOMP CONNECT).
   */
  public getAccessToken(): string | null {
    if (!environment.authEnabled) {
      return null;
    }
    return this.oauthService.getAccessToken();
  }

  /**
   * An access token with at least 30s of validity left, refreshing first
   * when needed. Resolves to null when auth is off, nobody is signed in, or
   * the refresh fails.
   */
  public async getFreshAccessToken(): Promise<string | null> {
    if (!environment.authEnabled) {
      return null;
    }
    const token = this.oauthService.getAccessToken();
    const expiresAt = this.oauthService.getAccessTokenExpiration();
    if (token && (!expiresAt || expiresAt - Date.now() > MIN_TOKEN_VALIDITY_MS)) {
      return token;
    }
    if (!this.oauthService.getRefreshToken()) {
      return token && this.oauthService.hasValidAccessToken() ? token : null;
    }
    try {
      return await this.refreshToken();
    } catch {
      return null;
    }
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
   * Decode the access token payload (where Keycloak realm roles live).
   * Returns null if there is no valid token.
   */
  private getAccessTokenPayload(): any {
    const token = this.getAccessToken();
    if (!token) {
      return null;
    }
    try {
      const payload = token.split('.')[1];
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(window.atob(normalized))));
    } catch (e) {
      console.error('[AuthService] Failed to decode access token', e);
      return null;
    }
  }

  /**
   * Realm roles carried in the access token (realm_access.roles).
   */
  public getRoles(): string[] {
    if (!environment.authEnabled) {
      return [];
    }
    const payload = this.getAccessTokenPayload();
    const roles = payload?.realm_access?.roles;
    return Array.isArray(roles) ? roles : [];
  }

  /**
   * Whether the current user holds the given realm role.
   */
  public hasRole(role: string): boolean {
    return this.getRoles().includes(role);
  }

  /**
   * Whether the current user holds the given fine-grained permission (realm role).
   *
   * Keycloak expands composite roles into `realm_access.roles`, so a
   * fine-grained permission like `packet:create` or `user:ban` is just
   * membership in that same array. When auth is disabled (self-hosted
   * single-user mode) every feature permission is granted, so the app is
   * fully usable without Keycloak; otherwise it is role membership in a
   * still-valid access token (an expired token grants nothing).
   */
  public hasPermission(permission: string): boolean {
    if (!environment.authEnabled) {
      return true;
    }
    if (!this.oauthService.hasValidAccessToken()) {
      return false;
    }
    return this.getRoles().includes(permission);
  }

  /**
   * Get user profile from ID token
   */
  public getUserProfile(): any {
    return this.userProfileSubject.value;
  }

  /**
   * Get the current user's Keycloak id (the `sub` claim), or null if there
   * is no authenticated user (guest mode).
   *
   * Falls back to decoding `sub` straight out of the access token when the
   * ID-token-derived profile hasn't loaded yet: `updateUserProfile` resolves
   * asynchronously after login, and a caller (e.g. an ownership check) can
   * run before it does. Without the fallback, `getCurrentUserId()` returned
   * null during that window, and since a non-owned packet's `owner.id` is
   * also null (D2's answer-free projection redacts it), an ownership
   * comparison against a not-yet-loaded id could spuriously match
   * `null === null` (NG-R2-04).
   */
  public getCurrentUserId(): string | null {
    return this.getUserProfile()?.sub ?? this.getAccessTokenPayload()?.sub ?? null;
  }

  /**
   * Update user profile from ID token claims
   */
  private updateUserProfile(): void {
    const claims = this.getIdentityClaims();
    if (claims) {
      const roles = this.getRoles();
      const profile = {
        sub: claims['sub'],
        email: claims['email'],
        name: claims['name'] || claims['preferred_username'] || claims['email'] || 'User',
        preferredUsername: claims['preferred_username'],
        roles,
      };
      this.userProfileSubject.next(profile);
    }
  }

  /**
   * Refresh the access token with the refresh token. Concurrent callers
   * share one request: Keycloak rotates refresh tokens with no reuse, so two
   * parallel refreshes would invalidate each other and end the session.
   *
   * Resolves to the new access token; rejects when there is no refresh token
   * or the token endpoint refuses it (the library then emits
   * `token_refresh_error`, which ends the session).
   *
   * Always returns a promise, even if `oauthService` throws synchronously
   * instead of rejecting (NG-R4-01): every caller does
   * `refreshToken().catch(...)` or `await`s it expecting a rejection, never a
   * thrown exception, and a synchronous throw here would otherwise escape
   * `catch` chained onto the call and surface as an unhandled rejection out
   * of the caller's own async function (e.g. `GameWebSocketService`'s
   * `refreshAndReconnect`), silently skipping its `stop()` fallback.
   */
  public refreshToken(): Promise<string | null> {
    try {
      if (!environment.authEnabled) {
        return Promise.resolve(null);
      }
      if (!this.refreshInFlight) {
        if (!this.oauthService.getRefreshToken()) {
          return Promise.reject(new Error('No refresh token available'));
        }
        const inFlight = this.oauthService.refreshToken()
          .then(() => this.oauthService.getAccessToken() || null)
          .finally(() => {
            if (this.refreshInFlight === inFlight) {
              this.refreshInFlight = null;
            }
          });
        this.refreshInFlight = inFlight;
      }
      return this.refreshInFlight;
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * After the login callback, return to the route that asked for login
   * (passed as the OAuth `state`). Only same-app paths are followed.
   */
  private navigateToLoginTarget(): void {
    const raw = this.oauthService.state;
    if (!raw) {
      return;
    }
    let target: string;
    try {
      target = decodeURIComponent(raw);
    } catch {
      return;
    }
    if (AuthService.isSafeAppPath(target)) {
      this.router.navigateByUrl(target);
    }
  }

  /** A path inside this app: starts with a single '/', no scheme or host. */
  private static isSafeAppPath(url: string | undefined | null): url is string {
    return !!url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
  }
}
