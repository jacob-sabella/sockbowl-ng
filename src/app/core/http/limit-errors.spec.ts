import { MatSnackBar } from '@angular/material/snack-bar';
import { isLimitHandled, limitErrorFrom, notifyLimit } from './limit-errors';
import { RateLimitStateService } from './rate-limit-state.service';

describe('limitErrorFrom', () => {
  it('maps an HTTP rate_limited body', () => {
    const err = limitErrorFrom('rate_limited', {
      policy: 'session-create',
      retryAfterSeconds: 37,
      message: 'Too many requests',
    });
    expect(err).toEqual({
      kind: 'rate_limited',
      policy: 'session-create',
      retryAfterSeconds: 37,
      message: 'Too many requests',
    });
  });

  it('maps an HTTP quota_exceeded body', () => {
    const err = limitErrorFrom('quota_exceeded', {
      metric: 'ai.generations',
      limit: 20,
      used: 20,
      resetsAt: '2026-09-28T00:00:00Z',
    });
    expect(err).toEqual({
      kind: 'quota_exceeded',
      metric: 'ai.generations',
      limit: 20,
      used: 20,
      resetsAt: '2026-09-28T00:00:00Z',
    });
  });

  it('maps a null resetsAt for a concurrent/owned quota', () => {
    const err = limitErrorFrom('quota_exceeded', { metric: 'hosted-sessions', limit: 2, used: 2, resetsAt: null });
    expect(err).toEqual(jasmine.objectContaining({ kind: 'quota_exceeded', resetsAt: null }));
  });

  it('maps an HTTP limiter_unavailable body', () => {
    const err = limitErrorFrom('limiter_unavailable', { policy: 'ai-generate' });
    expect(err).toEqual({ kind: 'limiter_unavailable', policy: 'ai-generate' });
  });

  it('maps HTTP banned and ip_banned bodies', () => {
    expect(limitErrorFrom('banned', { reason: 'spam', expiresAt: null })).toEqual({
      kind: 'banned', reason: 'spam', expiresAt: null,
    });
    expect(limitErrorFrom('ip_banned', { expiresAt: '2026-10-01T00:00:00Z' })).toEqual({
      kind: 'ip_banned', reason: undefined, expiresAt: '2026-10-01T00:00:00Z',
    });
  });

  it('maps GraphQL classifications the same way', () => {
    expect(limitErrorFrom('RATE_LIMITED', { policy: 'graphql-write', retryAfterSeconds: 5 }))
      .toEqual(jasmine.objectContaining({ kind: 'rate_limited', policy: 'graphql-write' }));
    expect(limitErrorFrom('QUOTA_EXCEEDED', { metric: 'imports', limit: 10 }))
      .toEqual(jasmine.objectContaining({ kind: 'quota_exceeded', metric: 'imports' }));
    expect(limitErrorFrom('BANNED', { reason: 'abuse' }))
      .toEqual(jasmine.objectContaining({ kind: 'banned', reason: 'abuse' }));
    expect(limitErrorFrom('LIMITER_UNAVAILABLE', { policy: 'ai-generate' }))
      .toEqual({ kind: 'limiter_unavailable', policy: 'ai-generate' });
  });

  it('returns null for anything unrecognized, including undefined/null', () => {
    expect(limitErrorFrom('something_else', {})).toBeNull();
    expect(limitErrorFrom(undefined, {})).toBeNull();
    expect(limitErrorFrom(null, null)).toBeNull();
  });
});

// NG-V1-01: components that already skip re-showing a snackbar for the
// status codes `RateLimitInterceptor` handles globally (429, 503, and now a
// 403 classified as `banned`/`ip_banned`) share this one check, so a new
// caller can't drift from the interceptor's own classification.
describe('isLimitHandled', () => {
  it('is true for a 429 or 503 whose body classifies (the interceptor showed a snackbar)', () => {
    expect(isLimitHandled({ status: 429, error: { error: 'rate_limited' } })).toBeTrue();
    expect(isLimitHandled({ status: 429, error: { error: 'quota_exceeded' } })).toBeTrue();
    expect(isLimitHandled({ status: 503, error: { error: 'limiter_unavailable' } })).toBeTrue();
  });

  // FIX3-NG: isLimitHandled must mirror limitErrorFrom -- RateLimitInterceptor
  // only shows a snackbar when the body's `error` field classifies, so a
  // plain 503/429 (no body, or a body with no recognized `error` field) is
  // NOT already handled, and a caller that skips its own error handling here
  // would swallow it with no message shown at all.
  it('is false for a plain 503 with no classifiable body (nothing was shown for it)', () => {
    expect(isLimitHandled({ status: 503 })).toBeFalse();
    expect(isLimitHandled({ status: 503, error: {} })).toBeFalse();
    expect(isLimitHandled({ status: 503, error: { message: 'Service Unavailable' } })).toBeFalse();
  });

  it('is false for a plain 429 with no classifiable body', () => {
    expect(isLimitHandled({ status: 429 })).toBeFalse();
    expect(isLimitHandled({ status: 429, error: { error: 'something_else' } })).toBeFalse();
  });

  it('is true for a 403 whose body classifies as banned or ip_banned', () => {
    expect(isLimitHandled({ status: 403, error: { error: 'banned' } })).toBeTrue();
    expect(isLimitHandled({ status: 403, error: { error: 'ip_banned' } })).toBeTrue();
  });

  it('is false for a 403 that is not a ban (e.g. a plain permission failure)', () => {
    expect(isLimitHandled({ status: 403, error: { error: 'forbidden' } })).toBeFalse();
    expect(isLimitHandled({ status: 403 })).toBeFalse();
    expect(isLimitHandled({ status: 403, error: {} })).toBeFalse();
  });

  it('is false for other statuses, and for null/undefined', () => {
    expect(isLimitHandled({ status: 400 })).toBeFalse();
    expect(isLimitHandled({ status: 500 })).toBeFalse();
    expect(isLimitHandled(null)).toBeFalse();
    expect(isLimitHandled(undefined)).toBeFalse();
  });
});

describe('notifyLimit', () => {
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let state: RateLimitStateService;

  beforeEach(() => {
    snackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    state = new RateLimitStateService();
  });

  it('shows the slow-down snackbar and starts the cooldown for the policy', () => {
    notifyLimit({ kind: 'rate_limited', policy: 'session-create', retryAfterSeconds: 5 }, snackBar, state);

    expect(snackBar.open).toHaveBeenCalledWith('Slow down, try again in 5s', 'Dismiss', jasmine.any(Object));
    expect(state.cooldown('session-create')()).toBe(5);
  });

  it('rounds up a fractional retryAfterSeconds and floors it at 1', () => {
    notifyLimit({ kind: 'rate_limited', policy: 'ai-generate', retryAfterSeconds: 0.2 }, snackBar, state);
    expect(snackBar.open).toHaveBeenCalledWith('Slow down, try again in 1s', 'Dismiss', jasmine.any(Object));
  });

  it('shows the quota-exceeded snackbar with the metric label and limit', () => {
    notifyLimit(
      { kind: 'quota_exceeded', metric: 'ai.generations', limit: 20, used: 20, resetsAt: null },
      snackBar, state
    );
    const [message] = snackBar.open.calls.mostRecent().args;
    expect(message).toContain('AI generation');
    expect(message).toContain('20');
  });

  it('shows the limiter-unavailable snackbar', () => {
    notifyLimit({ kind: 'limiter_unavailable', policy: 'ai-generate' }, snackBar, state);
    expect(snackBar.open).toHaveBeenCalledWith(
      'AI generation is temporarily unavailable', 'Dismiss', jasmine.any(Object));
  });

  // WP-E1fix (M4 live-run evidence, auth-ban.spec.ts): showing the reason
  // ALONE (no earlier version's behavior) broke a live assertion that just
  // checks the shown text says "banned" -- a moderator's free-text reason
  // isn't guaranteed to contain that word itself, so the fixed lead-in must
  // always be there too.
  it('shows a banned snackbar that always says "banned", with the reason appended when present', () => {
    notifyLimit({ kind: 'banned', reason: 'Spamming the buzzer.', expiresAt: null }, snackBar, state);
    expect(snackBar.open).toHaveBeenCalledWith(
      'You have been banned from Sockbowl. Reason: Spamming the buzzer.', 'Dismiss', jasmine.any(Object));
  });

  it('shows the default banned snackbar when no reason is present', () => {
    notifyLimit({ kind: 'banned', reason: undefined, expiresAt: null }, snackBar, state);
    expect(snackBar.open).toHaveBeenCalledWith(
      'You have been banned from Sockbowl.', 'Dismiss', jasmine.any(Object));
  });

  it('shows an ip_banned snackbar with its own wording and the reason appended when present', () => {
    notifyLimit({ kind: 'ip_banned', reason: 'Abuse from this network.', expiresAt: null }, snackBar, state);
    expect(snackBar.open).toHaveBeenCalledWith(
      'Your network has been banned from Sockbowl. Reason: Abuse from this network.', 'Dismiss', jasmine.any(Object));
  });
});
