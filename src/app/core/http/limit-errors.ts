import { MatSnackBar } from '@angular/material/snack-bar';
import { RateLimitStateService } from './rate-limit-state.service';
import { metricLabel, resetsPhrase } from './limit-messages';

/** A rejected request that tripped a Redis-backed rate-limit policy (429 `rate_limited`). */
export interface RateLimitError {
  kind: 'rate_limited';
  policy?: string;
  retryAfterSeconds: number;
  message?: string;
}

/** A rejected request that hit a per-tier daily/concurrent quota (429 `quota_exceeded`). */
export interface QuotaError {
  kind: 'quota_exceeded';
  metric?: string;
  limit?: number;
  used?: number;
  resetsAt?: string | null;
}

/** A fail-closed policy (AI generation today) whose limiter is unreachable (503 `limiter_unavailable`). */
export interface LimiterUnavailableError {
  kind: 'limiter_unavailable';
  policy?: string;
}

/** A subject or IP ban (403 `banned` / `ip_banned`, or the GraphQL `BANNED` classification). */
export interface BannedError {
  kind: 'banned' | 'ip_banned';
  reason?: string;
  expiresAt?: string | null;
}

export type LimitError = RateLimitError | QuotaError | LimiterUnavailableError | BannedError;

/**
 * Maps an HTTP JSON body's `error` field (`rate_limited`, `quota_exceeded`,
 * `limiter_unavailable`, `banned`, `ip_banned`) or a GraphQL error's
 * `extensions.classification` (`RATE_LIMITED`, `QUOTA_EXCEEDED`, `BANNED`,
 * `LIMITER_UNAVAILABLE`, per plan §2.1) to a typed {@link LimitError}.
 * Returns `null` for anything else, so callers can pass every error through
 * unconditionally.
 *
 * This is a pure function (no Angular DI) so both the ng HTTP interceptor
 * and, after INT1, M3's GraphQL error helper can call it directly.
 */
export function limitErrorFrom(
  classificationOrBodyError: string | null | undefined,
  extensions: Record<string, unknown> | null | undefined
): LimitError | null {
  const ext = extensions ?? {};
  switch (classificationOrBodyError) {
    case 'rate_limited':
    case 'RATE_LIMITED':
      return {
        kind: 'rate_limited',
        policy: asString(ext['policy']),
        retryAfterSeconds: asNumber(ext['retryAfterSeconds']) ?? 0,
        message: asString(ext['message']),
      };
    case 'quota_exceeded':
    case 'QUOTA_EXCEEDED':
      return {
        kind: 'quota_exceeded',
        metric: asString(ext['metric']),
        limit: asNumber(ext['limit']),
        used: asNumber(ext['used']),
        resetsAt: asString(ext['resetsAt']) ?? null,
      };
    case 'limiter_unavailable':
    case 'LIMITER_UNAVAILABLE':
      return { kind: 'limiter_unavailable', policy: asString(ext['policy']) };
    case 'banned':
    case 'ip_banned':
    case 'BANNED':
      return {
        kind: classificationOrBodyError === 'ip_banned' ? 'ip_banned' : 'banned',
        reason: asString(ext['reason']),
        expiresAt: asString(ext['expiresAt']) ?? null,
      };
    default:
      return null;
  }
}

/**
 * Shows the standard snackbar for a {@link LimitError} and, for a
 * `rate_limited` rejection, starts the matching {@link RateLimitStateService}
 * cooldown so bound buttons disable themselves (plan §2.9). `RateLimitInterceptor`
 * calls this for a classified 403 `banned`/`ip_banned` body too (WP-E1fix:
 * `AuthInterceptor`'s generic 403 handling can't render that body's
 * `{error,reason,expiresAt}` shape into a useful message, so it defers to
 * this one instead of double-showing a snackbar). Callers that classify a
 * GraphQL `BANNED` error (INT1) may still choose to call this for that case.
 * The `banned`/`ip_banned` message always leads with fixed wording that says
 * "banned" and appends a moderator's free-text reason, if any, rather than
 * showing the reason alone -- a caller-supplied reason has no guarantee of
 * containing that word itself.
 */
export function notifyLimit(
  err: LimitError,
  snackBar: MatSnackBar,
  state: RateLimitStateService
): void {
  switch (err.kind) {
    case 'rate_limited': {
      const seconds = Math.max(1, Math.ceil(err.retryAfterSeconds || 1));
      snackBar.open(`Slow down, try again in ${seconds}s`, 'Dismiss', { duration: 5000 });
      if (err.policy) {
        state.setCooldown(err.policy, seconds);
      }
      break;
    }
    case 'quota_exceeded': {
      const label = metricLabel(err.metric);
      const resets = resetsPhrase(err.resetsAt);
      const limitText = err.limit != null ? ` (${err.limit})` : '';
      snackBar.open(`You've reached your ${label} limit${limitText}. Resets ${resets}`, 'Dismiss', {
        duration: 6000,
      });
      break;
    }
    case 'limiter_unavailable':
      snackBar.open('AI generation is temporarily unavailable', 'Dismiss', { duration: 6000 });
      break;
    case 'banned': {
      // Always say "banned" even when a moderator's free-text reason doesn't
      // happen to include that word itself (found live: auth-ban.spec.ts's
      // own ban reason, e.g. "e2e ban test (auth-ban.spec.ts)", showed with
      // no other wording and so never matched a /banned/i-style assertion --
      // the STOMP-side fatal ban notice, stomp-errors.ts's fixed
      // 'Your account is banned from playing.', never had this gap because
      // it never mixes in caller-supplied text).
      const base = 'You have been banned from Sockbowl.';
      snackBar.open(err.reason ? `${base} Reason: ${err.reason}` : base, 'Dismiss', { duration: 8000 });
      break;
    }
    case 'ip_banned': {
      const base = 'Your network has been banned from Sockbowl.';
      snackBar.open(err.reason ? `${base} Reason: ${err.reason}` : base, 'Dismiss', { duration: 8000 });
      break;
    }
  }
}

/**
 * True when `err` (an `HttpErrorResponse`, or anything shaped like one --
 * component `error` callbacks in tests are often given a plain object) is
 * one `RateLimitInterceptor` already turned into a snackbar (plan §2.9,
 * NG-V1-01): 429 `rate_limited`/`quota_exceeded`, 503 `limiter_unavailable`,
 * or a 403 whose body classifies as `banned`/`ip_banned`. Callers whose own
 * error handler would otherwise show a second, generic failure message
 * (`packet-search`'s Generate/Import, `admin-usage`'s quota/ban/reset
 * actions) check this first and return early when it's true, so a rejection
 * the interceptor already reported is never shown twice.
 *
 * A 403 that ISN'T a ban (a plain permission failure, or no classifiable
 * body at all) returns `false` -- `RateLimitInterceptor` doesn't touch it
 * either (`limitErrorFrom` returns `null` for it), so the caller's own
 * error handling still needs to run.
 *
 * FIX3-NG: this must mirror `limitErrorFrom` exactly, for every status the
 * interceptor reacts to, not just 403. `RateLimitInterceptor` only shows a
 * snackbar when the body's `error` field classifies (`handle()` bails out
 * early otherwise), so a plain 429/503 -- no body, or a body with no
 * recognized `error` field -- was NOT already handled. Returning `true` for
 * it anyway made a caller skip its own error handling too, so a plain 503
 * (e.g. an upstream outage with no JSON body) was swallowed with no message
 * shown at all.
 */
export function isLimitHandled(err: unknown): boolean {
  const candidate = err as { status?: number; error?: { error?: unknown } } | null | undefined;
  if (!candidate || typeof candidate.status !== 'number') {
    return false;
  }
  if (candidate.status === 429 || candidate.status === 503 || candidate.status === 403) {
    const bodyError = candidate.error?.error;
    return typeof bodyError === 'string' && limitErrorFrom(bodyError, null) !== null;
  }
  return false;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}
