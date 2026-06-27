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
 *   when auth is enabled.
 * - On a 403 response (e.g. a banned user) it shows a clear, non-blocking
 *   message instead of letting the error fail silently.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {

  constructor(
    @Optional() private oauthService: OAuthService,
    @Optional() private snackBar: MatSnackBar
  ) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Only add token if auth is enabled
    if (environment.authEnabled && this.oauthService) {
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
