import { Injectable, Injector, inject } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { OAuthService } from 'angular-oauth2-oidc';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/**
 * HTTP Interceptor that adds the JWT access token to outgoing requests and
 * handles authorization failures.
 *
 * - Adds the `Authorization: Bearer <token>` header for authenticated users
 *   when auth is enabled, but ONLY for requests to our own backends
 *   (`apiBaseUrl`, the game session API and the questions API, plus relative
 *   URLs). Third-party calls (e.g. api.openai.com) never receive the Keycloak
 *   token: attaching it there would leak the OIDC credential cross-origin and
 *   clobber the caller's own Authorization header.
 * - On a 401 from one of our backends for a request that carried a token, it
 *   refreshes the token once (shared with any other in-flight refresh) and
 *   retries the request once. A second 401, or a failed refresh, ends the
 *   session locally and prompts the user to sign in again (AUTH-13).
 * - On a 403 response (e.g. a banned user) it shows a clear, non-blocking
 *   message instead of letting the error fail silently. WP-E1fix: a 403 body
 *   M4's `RateLimitInterceptor` already classifies and reports itself
 *   (`{error:"banned"|"ip_banned",...}`, plan m4-limits.md §2.1, no
 *   `message` field) is skipped here, so the ban is surfaced exactly once
 *   with real text instead of twice, once with this interceptor's own
 *   generic fallback that names neither "banned" nor "not allowed".
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private oauthService = inject(OAuthService, { optional: true });
  private snackBar = inject(MatSnackBar, { optional: true });
  // AuthService is resolved lazily: OAuthService's own discovery request runs
  // while AuthService is being constructed and passes through this
  // interceptor, so injecting AuthService eagerly would be a DI cycle.
  private injector = inject(Injector);

  /** Origins of our own backends; the bearer is attached only to these. */
  private readonly allowedOrigins: string[] = AuthInterceptor.buildAllowedOrigins();

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Only add token if auth is enabled AND the request targets our backend.
    const attachToken =
      environment.authEnabled && !!this.oauthService && this.isBackendRequest(request.url);
    const accessToken = attachToken ? this.oauthService!.getAccessToken() : null;
    const outgoing = accessToken ? AuthInterceptor.withBearer(request, accessToken) : request;

    return next.handle(outgoing).pipe(
      catchError((error: unknown) => {
        if (accessToken && error instanceof HttpErrorResponse && error.status === 401) {
          return this.refreshAndRetry(request, next, error);
        }
        return this.fail(error);
      })
    );
  }

  /** One refresh, one retry; a second 401 or a refresh failure ends the session. */
  private refreshAndRetry(
    request: HttpRequest<unknown>,
    next: HttpHandler,
    original: HttpErrorResponse
  ): Observable<HttpEvent<unknown>> {
    const auth = this.injector.get(AuthService);
    return from(auth.refreshToken()).pipe(
      catchError(() => {
        auth.handleSessionEnded();
        return throwError(() => original);
      }),
      switchMap((token) => {
        if (!token) {
          auth.handleSessionEnded();
          return throwError(() => original);
        }
        return next.handle(AuthInterceptor.withBearer(request, token)).pipe(
          catchError((retryError: unknown) => {
            if (retryError instanceof HttpErrorResponse && retryError.status === 401) {
              auth.handleSessionEnded();
              return throwError(() => retryError);
            }
            return this.fail(retryError);
          })
        );
      })
    );
  }

  /**
   * Surfaces a 403 to the user, then rethrows the error unchanged. Skips its
   * own snackbar for a body `RateLimitInterceptor` already classifies and
   * reports (403 `banned`/`ip_banned`, WP-E1fix), so a ban is reported once,
   * with real text, instead of once here with an unhelpful generic fallback.
   */
  private fail(error: unknown): Observable<never> {
    if (error instanceof HttpErrorResponse && error.status === 403
        && !AuthInterceptor.isLimitClassified403(error)) {
      const message = this.extractMessage(error)
        || 'You do not have permission to perform this action.';
      this.snackBar?.open(message, 'Dismiss', { duration: 6000 });
    }
    return throwError(() => error);
  }

  /** True for the M4 `{error:"banned"|"ip_banned",...}` 403 body (plan m4-limits.md §2.1). */
  private static isLimitClassified403(error: HttpErrorResponse): boolean {
    const body = error.error;
    return !!body && typeof body === 'object'
      && (body.error === 'banned' || body.error === 'ip_banned');
  }

  private static withBearer(request: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
    return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  /**
   * True if the request targets one of our own backends (or is a relative /
   * same-origin URL). External absolute URLs (e.g. api.openai.com) return false
   * so the Keycloak bearer is never attached to them.
   */
  private isBackendRequest(url: string): boolean {
    // Relative URL -> same-origin app request; safe to attach.
    if (!/^https?:\/\//i.test(url)) {
      return true;
    }
    try {
      return this.allowedOrigins.includes(new URL(url).origin);
    } catch {
      return false;
    }
  }

  private static buildAllowedOrigins(): string[] {
    const configuredUrls = [
      environment.apiBaseUrl,
      environment.sockbowlGameApiUrl,
      environment.sockbowlQuestionsApiUrl,
    ];
    const origins = new Set<string>();
    for (const url of configuredUrls) {
      if (!url) {
        continue;
      }
      try {
        origins.add(new URL(url).origin);
      } catch {
        // ignore malformed config entries
      }
    }
    return [...origins];
  }

  private extractMessage(error: HttpErrorResponse): string | null {
    if (typeof error.error === 'string' && error.error.trim().length > 0) {
      return error.error;
    }
    if (error.error && typeof error.error.message === 'string') {
      return error.error.message;
    }
    return null;
  }
}
