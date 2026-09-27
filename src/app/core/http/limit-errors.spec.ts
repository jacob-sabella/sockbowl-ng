import { MatSnackBar } from '@angular/material/snack-bar';
import { limitErrorFrom, notifyLimit } from './limit-errors';
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

  it('shows a banned snackbar using the reason when present', () => {
    notifyLimit({ kind: 'banned', reason: 'Spamming the buzzer.', expiresAt: null }, snackBar, state);
    expect(snackBar.open).toHaveBeenCalledWith('Spamming the buzzer.', 'Dismiss', jasmine.any(Object));
  });
});
