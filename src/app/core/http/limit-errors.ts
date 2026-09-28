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
    case 'banned':
    case 'ip_banned':
      snackBar.open(err.reason || 'You have been banned from Sockbowl.', 'Dismiss', { duration: 8000 });
      break;
  }
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
