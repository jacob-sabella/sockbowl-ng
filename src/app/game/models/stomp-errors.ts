import { StompError } from './sockbowl/sockbowl-interfaces';

/**
 * ERROR-frame codes after which the client must stop reconnecting and send the
 * user back to the lobby (M2 plan section 2.5, ng contract). Retrying would
 * only hammer the server with the same rejected credentials.
 */
export const FATAL_STOMP_CODES: ReadonlySet<string> = new Set([
  'BANNED',
  'INVALID_CREDENTIALS',
  'SESSION_NOT_FOUND',
  'PLAYER_NOT_IN_SESSION',
  'IDENTITY_MISMATCH',
  'FORBIDDEN_DESTINATION',
  // M4: an IP ban is as permanent as an account ban from the client's point of
  // view, so it joins the fatal list rather than getting the RATE_LIMITED
  // reconnect treatment.
  'IP_BANNED',
]);

/**
 * ERROR-frame codes that an authenticated player recovers from by refreshing
 * the access token and reconnecting once.
 */
export const TOKEN_STOMP_CODES: ReadonlySet<string> = new Set([
  'TOKEN_EXPIRED',
  'AUTH_REQUIRED',
]);

const FRIENDLY_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Sign in again to keep playing.',
  INVALID_CREDENTIALS: 'Your game credentials are no longer valid. Rejoin the game from the lobby.',
  TOKEN_EXPIRED: 'Your session expired. Sign in again to keep playing.',
  BANNED: 'Your account is banned from playing.',
  SESSION_NOT_FOUND: 'This game no longer exists.',
  PLAYER_NOT_IN_SESSION: 'You are no longer part of this game.',
  IDENTITY_MISMATCH: 'This game seat belongs to a different account.',
  FORBIDDEN_DESTINATION: 'The game connection was refused.',
  INTERNAL: 'The game server had a problem. Reconnecting…',
  IP_BANNED: 'Your network is temporarily blocked from playing.',
  // RATE_LIMITED and QUOTA_EXCEEDED intentionally have no friendly override:
  // the server's `message` already carries the specific, contextual text
  // (which policy or metric tripped), and a static string here would hide it.
};

/** A user-facing sentence for a STOMP error (server detail as a fallback). */
export function describeStompError(error: StompError): string {
  return FRIENDLY_MESSAGES[error.code] ?? error.message ?? 'Something went wrong with the game connection.';
}

/**
 * Parse a StompError from an ERROR frame or a `/user/queue/errors` message.
 * The server sends a JSON body `{code, message, retryAfterSeconds}` (M4 adds
 * optional `policy`, `retryAfterMs`, `droppedDestination`) and the code again
 * in the `x-sockbowl-error` / `message` headers; the body wins, and a bare
 * header (or a non-JSON body) still yields the code.
 */
export function parseStompError(body: string | undefined, headers: Record<string, string> = {}): StompError {
  let parsed: Partial<StompError> | null = null;
  if (body) {
    try {
      const candidate = JSON.parse(body);
      if (candidate && typeof candidate === 'object') {
        parsed = candidate;
      }
    } catch {
      parsed = null;
    }
  }
  const code = (typeof parsed?.code === 'string' && parsed.code)
    || headers['x-sockbowl-error']
    || (isErrorCode(headers['message']) ? headers['message'] : '')
    || 'INTERNAL';
  return {
    ...(parsed ?? {}),
    policy: parsed?.policy ?? null,
    retryAfterMs: parsed?.retryAfterMs ?? null,
    droppedDestination: parsed?.droppedDestination ?? null,
    code,
    message: parsed?.message ?? (body && !parsed ? body : null),
    retryAfterSeconds: parsed?.retryAfterSeconds ?? null,
  };
}

function isErrorCode(value: string | undefined): value is string {
  return !!value && /^[A-Z][A-Z0-9_]*$/.test(value);
}
