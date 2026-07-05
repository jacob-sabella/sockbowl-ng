import { Injectable, Optional } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { OAuthService } from 'angular-oauth2-oidc';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';

/**
 * HTTP Interceptor that adds the JWT access token to outgoing requests and
 * surfaces authorization failures (bans / forbidden) to the user.
 *
 * - Adds the `Authorization: Bearer <token>` header for authenticated users
 *   when auth is enabled, but ONLY for requests to our own backends. Third-
 *   party calls (e.g. api.openai.com) never receive the Keycloak token —
 *   attaching it there would leak the OIDC credential cross-origin and clobber
 *   the caller's own Authorization header.
 * - On a 403 response (e.g. a banned user) it shows a clear, non-blocking
 *   message instead of letting the error fail silently.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {

  /** Origins of our own backends; the bearer is attached only to these. */
  private readonly allowedOrigins: string[] = AuthInterceptor.buildAllowedOrigins();

  constructor(
    @Optional() private oauthService: OAuthService,
    @Optional() private snackBar: MatSnackBar
  ) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Only add token if auth is enabled AND the request targets our backend.
    if (environment.authEnabled && this.oauthService && this.isBackendRequest(request.url)) {
      const accessToken = this.oauthService.getAccessToken();
      if (accessToken) {
        request = request.clone({
          setHeaders: {
            Authorization: `Bearer ${accessToken}`
          }
        });
      }
    }

    return next.handle(request).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 403) {
          const message = this.extractMessage(error)
            || 'You do not have permission to perform this action.';
          this.snackBar?.open(message, 'Dismiss', { duration: 6000 });
        }
        return throwError(() => error);
      })
    );
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
