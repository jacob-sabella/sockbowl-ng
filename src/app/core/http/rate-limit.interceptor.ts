import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RateLimitStateService } from './rate-limit-state.service';
import { limitErrorFrom, notifyLimit } from './limit-errors';

/**
 * Global HTTP interceptor for M4 rate limiting and quotas (plan §2.9,
 * M4-UI-01). Registered in `app.module.ts` after `AuthInterceptor`, so it
 * sits closer to the backend and sees 429/503 responses before
 * `AuthInterceptor`'s own 403 handling runs on the way back up.
 *
 * It only reacts to the two status codes M4's `RequestGuardFilter` and
 * `AiGenerationGuard` use (429 and 503, plan §2.1); every other response,
 * including 403 `banned`/`ip_banned` (left to `AuthInterceptor`'s existing
 * message) and GraphQL's always-200 errors (M3's own client), passes
 * through unchanged.
 */
@Injectable()
export class RateLimitInterceptor implements HttpInterceptor {
  private snackBar = inject(MatSnackBar);
  private state = inject(RateLimitStateService);

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && (error.status === 429 || error.status === 503)) {
          this.handle(error);
        }
        return throwError(() => error);
      })
    );
  }

  private handle(error: HttpErrorResponse): void {
    const body = (error.error && typeof error.error === 'object' ? error.error : {}) as Record<string, unknown>;
    const classification = typeof body['error'] === 'string' ? (body['error'] as string) : undefined;
    if (!classification) {
      return;
    }
    const retryAfterHeader = error.headers?.get('Retry-After');
    const extensions: Record<string, unknown> = {
      ...body,
      retryAfterSeconds: body['retryAfterSeconds'] ?? (retryAfterHeader ? Number(retryAfterHeader) : undefined),
    };
    const limitError = limitErrorFrom(classification, extensions);
    if (limitError) {
      notifyLimit(limitError, this.snackBar, this.state);
    }
  }
}
