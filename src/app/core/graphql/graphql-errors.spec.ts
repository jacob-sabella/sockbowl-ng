import { describeGraphqlError, GraphqlErrorClassification, GraphqlRequestError } from './graphql-errors';

function errorOf(classification: GraphqlErrorClassification, message = 'server message'): GraphqlRequestError {
  return new GraphqlRequestError({ message, classification });
}

describe('describeGraphqlError', () => {
  it('maps CONFLICT to a reload hint', () => {
    expect(describeGraphqlError(errorOf('CONFLICT'))).toBe('This packet changed elsewhere. Reload to see the latest version.');
  });

  it('maps FORBIDDEN to a permission message', () => {
    expect(describeGraphqlError(errorOf('FORBIDDEN'))).toBe("You don't have permission to change this packet.");
  });

  it('maps VALIDATION_FAILED to the server message', () => {
    expect(describeGraphqlError(errorOf('VALIDATION_FAILED', 'Name exceeds 200 characters'))).toBe('Name exceeds 200 characters');
  });

  // INT1: RATE_LIMITED/QUOTA_EXCEEDED/BANNED map to '', not a message --
  // GraphqlClientService's notifyLimit already shows the canonical,
  // cooldown-aware snackbar for these three, so a second, generic message
  // here would either duplicate or (worse) silently blank it out. See the
  // doc comment on describeGraphqlError.
  it('maps RATE_LIMITED to empty (already shown by notifyLimit)', () => {
    expect(describeGraphqlError(errorOf('RATE_LIMITED'))).toBe('');
  });

  it('maps QUOTA_EXCEEDED to empty (already shown by notifyLimit)', () => {
    expect(describeGraphqlError(errorOf('QUOTA_EXCEEDED'))).toBe('');
  });

  it('maps BANNED to empty (already shown by notifyLimit)', () => {
    expect(describeGraphqlError(errorOf('BANNED'))).toBe('');
  });

  it('maps LIMITER_UNAVAILABLE to generic text', () => {
    expect(describeGraphqlError(errorOf('LIMITER_UNAVAILABLE'))).toBe('Temporarily unavailable, try again shortly.');
  });

  it('maps UNAUTHORIZED to a sign-in prompt', () => {
    expect(describeGraphqlError(errorOf('UNAUTHORIZED'))).toBe('Please sign in to do that.');
  });

  it('maps NOT_FOUND to a not-found message', () => {
    expect(describeGraphqlError(errorOf('NOT_FOUND'))).toBe("That couldn't be found. It may have been deleted.");
  });

  it('maps PAYLOAD_TOO_LARGE to a size message', () => {
    expect(describeGraphqlError(errorOf('PAYLOAD_TOO_LARGE'))).toBe('That input is too large.');
  });

  it('maps BAD_REQUEST to the server message', () => {
    expect(describeGraphqlError(errorOf('BAD_REQUEST', 'Missing field'))).toBe('Missing field');
  });

  it('maps NETWORK to a connectivity message', () => {
    expect(describeGraphqlError(errorOf('NETWORK'))).toBe('Network error. Check your connection and try again.');
  });

  it('maps INTERNAL_ERROR to the server message when present', () => {
    expect(describeGraphqlError(errorOf('INTERNAL_ERROR', 'boom'))).toBe('boom');
  });

  it('falls back to a generic message for a plain Error', () => {
    expect(describeGraphqlError(new Error('some other failure'))).toBe('some other failure');
  });

  it('falls back to a generic message for an unrecognized value', () => {
    expect(describeGraphqlError('nope')).toBe('Something went wrong.');
    expect(describeGraphqlError(undefined)).toBe('Something went wrong.');
  });
});
