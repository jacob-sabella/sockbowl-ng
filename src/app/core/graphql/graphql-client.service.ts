import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, TimeoutError, throwError } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';
import { GraphqlErrorClassification, GraphqlErrorLike, GraphqlRequestError } from './graphql-errors';

interface GraphqlHttpResponse<T> {
  data?: T | null;
  errors?: GraphqlErrorLike[];
}

const DEFAULT_TIMEOUT_MS = 15000;

/** Maps a transport-level (non-GraphQL-body) HTTP failure to a classification. */
function classifyHttpStatus(status: number): GraphqlErrorClassification {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 429:
      return 'RATE_LIMITED';
    case 0:
      return 'NETWORK';
    default:
      return 'INTERNAL_ERROR';
  }
}

function describeHttpStatus(status: number): string {
  if (status === 0) {
    return 'Network error.';
  }
  return `Request failed with status ${status}.`;
}

/** Pulls a GraphQL `errors` array out of an HTTP error body, if there is one. */
function errorsFromHttpBody(body: unknown): GraphqlErrorLike[] {
  if (body && typeof body === 'object' && Array.isArray((body as GraphqlHttpResponse<unknown>).errors)) {
    return (body as GraphqlHttpResponse<unknown>).errors as GraphqlErrorLike[];
  }
  return [];
}

function classificationOf(err: GraphqlErrorLike): GraphqlErrorClassification {
  const raw = err.extensions?.['classification'];
  if (typeof raw === 'string') {
    return raw as GraphqlErrorClassification;
  }
  return 'INTERNAL_ERROR';
}

function toRequestError(err: unknown): GraphqlRequestError {
  if (err instanceof GraphqlRequestError) {
    return err;
  }
  if (err instanceof HttpErrorResponse) {
    const bodyErrors = errorsFromHttpBody(err.error);
    if (bodyErrors.length) {
      const first = bodyErrors[0];
      return new GraphqlRequestError({
        message: first.message,
        classification: classificationOf(first),
        extensions: first.extensions,
        path: first.path,
        httpStatus: err.status,
        all: bodyErrors
      });
    }
    return new GraphqlRequestError({
      message: describeHttpStatus(err.status),
      classification: classifyHttpStatus(err.status),
      httpStatus: err.status
    });
  }
  if (err instanceof TimeoutError) {
    return new GraphqlRequestError({ message: 'The request timed out.', classification: 'NETWORK' });
  }
  const message = err instanceof Error ? err.message : 'Something went wrong.';
  return new GraphqlRequestError({ message, classification: 'INTERNAL_ERROR' });
}

/**
 * Shared GraphQL-over-HTTP client (M3 plan 3.3.1). Every packet-authoring and
 * packet-fetching call is routed through this so GraphQL errors surface as a
 * typed {@link GraphqlRequestError} instead of being swallowed (PB-01).
 */
@Injectable({
  providedIn: 'root'
})
export class GraphqlClientService {
  private http = inject(HttpClient);

  /**
   * Posts `{ query, variables }` to `url` and resolves with `data`.
   *
   * - A 2xx response whose body carries a non-empty `errors` array throws a
   *   {@link GraphqlRequestError} built from its first error (classification
   *   from `extensions.classification`); `all` carries every error.
   * - An HTTP failure (401/403/413/429/0/5xx, or anything else) throws a
   *   {@link GraphqlRequestError} classified from the status code, unless the
   *   error body itself is a GraphQL `errors` response, in which case that
   *   takes precedence.
   */
  request<T>(
    url: string,
    query: string,
    variables?: Record<string, unknown>,
    opts?: { timeoutMs?: number }
  ): Observable<T> {
    return this.http.post<GraphqlHttpResponse<T>>(url, { query, variables: variables ?? {} }).pipe(
      timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      map((response) => {
        if (response?.errors?.length) {
          const first = response.errors[0];
          throw new GraphqlRequestError({
            message: first.message,
            classification: classificationOf(first),
            extensions: first.extensions,
            path: first.path,
            all: response.errors
          });
        }
        return response.data as T;
      }),
      catchError((err) => throwError(() => toRequestError(err)))
    );
  }
}
