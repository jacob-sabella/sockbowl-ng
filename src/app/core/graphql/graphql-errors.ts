/**
 * Typed GraphQL/HTTP error surfaced by {@link GraphqlClientService}, and the
 * text it maps to for a snackbar (M3 plan 3.3.1, fixes PB-01).
 *
 * A classification comes from one of two places:
 *  - a business error returned by the GraphQL endpoint (HTTP 200 with an
 *    `errors` array): the classification is the first error's
 *    `extensions.classification`, which is either one of Spring GraphQL's own
 *    `ErrorType` values (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
 *    `BAD_REQUEST`, `INTERNAL_ERROR`) or one of
 *    `com.soulsoftworks.sockbowlquestions.api.SockbowlErrorType` (`CONFLICT`,
 *    `VALIDATION_FAILED`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`,
 *    `QUOTA_EXCEEDED`, `BANNED`, `LIMITER_UNAVAILABLE`);
 *  - a transport-level failure (the request never reached GraphQL execution,
 *    or the response body isn't a GraphQL response at all): the HTTP status
 *    is mapped directly, per 3.3.1.
 */
export type GraphqlErrorClassification =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'BANNED'
  | 'LIMITER_UNAVAILABLE'
  | 'NETWORK';

/** One raw GraphQL error, as it appears in the response's `errors` array. */
export interface GraphqlErrorLike {
  message: string;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

export interface GraphqlRequestErrorInit {
  message: string;
  classification: GraphqlErrorClassification;
  extensions?: Record<string, unknown>;
  path?: (string | number)[];
  httpStatus?: number;
  all?: GraphqlErrorLike[];
}

/**
 * Thrown by {@link GraphqlClientService.request} for every failure, whether it
 * came from a GraphQL `errors` entry or from the HTTP transport.
 */
export class GraphqlRequestError extends Error {
  readonly classification: GraphqlErrorClassification;
  readonly extensions: Record<string, unknown>;
  readonly path?: (string | number)[];
  readonly httpStatus?: number;
  /** Every error the response carried, in case a caller needs more than the first. */
  readonly all: GraphqlErrorLike[];

  constructor(init: GraphqlRequestErrorInit) {
    super(init.message);
    this.name = 'GraphqlRequestError';
    this.classification = init.classification;
    this.extensions = init.extensions ?? {};
    this.path = init.path;
    this.httpStatus = init.httpStatus;
    this.all = init.all ?? [];
    // Restores the prototype chain lost when extending a built-in (Error) in
    // an environment that downlevels classes to ES5, so `instanceof` keeps working.
    Object.setPrototypeOf(this, GraphqlRequestError.prototype);
  }
}

/**
 * User-facing text for a failed request. Anything not thrown as a
 * {@link GraphqlRequestError} (a plain Error, or a non-Error value) falls back
 * to a generic message.
 *
 * INT1: `RATE_LIMITED`, `QUOTA_EXCEEDED` and `BANNED` map to `''`, not a
 * message. `GraphqlClientService` already shows the canonical,
 * cooldown-aware text for exactly these three classifications via
 * `notifyLimit` (see its `notifyIfLimitError`) for every request it makes,
 * so a caller that also calls `snackBar.open(describeGraphqlError(err), ...)`
 * must check the result is non-empty first, or it shows the rejection twice
 * -- once with the right message, once with nothing. Consistent with
 * `isLimitHandled`'s dedupe of `RateLimitInterceptor` for plain HTTP calls.
 */
export function describeGraphqlError(err: unknown): string {
  if (err instanceof GraphqlRequestError) {
    switch (err.classification) {
      case 'CONFLICT':
        return 'This packet changed elsewhere. Reload to see the latest version.';
      case 'FORBIDDEN':
        return "You don't have permission to change this packet.";
      case 'VALIDATION_FAILED':
        return err.message || 'That change is not valid.';
      case 'RATE_LIMITED':
      case 'QUOTA_EXCEEDED':
      case 'BANNED':
        // Already shown by GraphqlClientService's notifyLimit; see the
        // doc comment above.
        return '';
      case 'LIMITER_UNAVAILABLE':
        return 'Temporarily unavailable, try again shortly.';
      case 'UNAUTHORIZED':
        return 'Please sign in to do that.';
      case 'NOT_FOUND':
        return "That couldn't be found. It may have been deleted.";
      case 'PAYLOAD_TOO_LARGE':
        return 'That input is too large.';
      case 'BAD_REQUEST':
        return err.message || 'That request was not valid.';
      case 'NETWORK':
        return 'Network error. Check your connection and try again.';
      case 'INTERNAL_ERROR':
      default:
        return err.message || 'Something went wrong.';
    }
  }
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Something went wrong.';
}
