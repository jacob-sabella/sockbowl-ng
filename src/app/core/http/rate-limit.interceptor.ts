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
 * It reacts to the status codes M4's `RequestGuardFilter` and
 * `AiGenerationGuard` use (429, 503 and, for a subject/IP ban, 403, plan
 * §2.1). GraphQL's always-200 errors (M3's own client) pass through
 * unchanged.
 *
 * WP-E1fix (M4 live-run evidence, auth-ban.spec.ts): a 403 `banned`/
 * `ip_banned` body was originally left for `AuthInterceptor`'s generic 403
 * handling on the assumption that it "already surfaces" a usable message.
 * It doesn't: that body has no `message` field
 * ({"error":"banned","reason":...,"expiresAt":...}), so
 * `AuthInterceptor.extractMessage()` returns null and it falls back to its
 * generic "You do not have permission..." text, which names neither "banned"
 * nor "not allowed" and left the ban silently unreported to the player. This
 * interceptor now classifies 403 the same way it already classifies 429/503
 * (via {@link limitErrorFrom}, which returns `null` for any other 403 shape,
 * so a plain/unclassified 403 still passes through untouched) and shows the
 * correct banned snackbar itself; `AuthInterceptor.fail()` skips its own
 * snackbar for this same classified shape so the ban is reported exactly
 * once (the single-snackbar rule also used for 429/503).
 */
@Injectable()
export class RateLimitInterceptor implements HttpInterceptor {
  private snackBar = inject(MatSnackBar);
  private state = inject(RateLimitStateService);

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse
            && (error.status === 429 || error.status === 503 || error.status === 403)) {
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
