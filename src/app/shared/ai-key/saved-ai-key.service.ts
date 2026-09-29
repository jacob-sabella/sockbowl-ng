import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, defer, throwError } from 'rxjs';
import { catchError, filter, map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/** `GET/PUT/PATCH {questionsApi}/api/me/ai-key` response. */
export interface SavedAiKeyStatus {
  configured: boolean;
  provider: 'anthropic';
  model: string | null;
  last4: string | null;
  updatedAt: string | null;
}

/** Offered before (or instead of, if the fetch fails) the saved key's own `/models` list. */
export const DEFAULT_CLAUDE_MODELS: readonly string[] = [
  'claude-sonnet-5',
  'claude-opus-5-5',
  'claude-haiku-4-5-20251001',
];

export const DEFAULT_CLAUDE_MODEL = DEFAULT_CLAUDE_MODELS[0];

/** What {@link SavedAiKeyService.status$} reports when the status can't be read (503, network, ...). */
const NOT_CONFIGURED: SavedAiKeyStatus = {
  configured: false,
  provider: 'anthropic',
  model: null,
  last4: null,
  updatedAt: null,
};

/**
 * The user's server-side saved Claude (Anthropic) API key (`/api/me/ai-key`
 * on sockbowl-questions). The key itself only ever travels in the PUT body;
 * the server keeps it and answers with just its last four characters, so
 * nothing here (or in its callers) writes the key to browser storage.
 *
 * When a key is saved, generation requests that carry no `X-API-Key` use it
 * (and its saved model) server-side, which is how {@link AiKeyPickerComponent}
 * lets `packet-search` and the builder generate without a pasted key.
 * Every endpoint needs the `question:generate` permission; the bearer comes
 * from `AuthInterceptor` (the questions API is one of its allowed origins).
 */
@Injectable({
  providedIn: 'root'
})
export class SavedAiKeyService {
  private http = inject(HttpClient);

  private readonly url = `${environment.sockbowlQuestionsApiUrl}api/me/ai-key`;

  /** null until the first GET settles. */
  private readonly cache = new BehaviorSubject<SavedAiKeyStatus | null>(null);
  private requested = false;

  /**
   * Cached status: the first subscriber triggers one GET, later ones share
   * its result, and save/updateModel/remove push their responses through it.
   * Never errors: a failed read (feature disabled, network) reads as "not
   * configured" so the pickers fall back to the paste-a-key flow. Callers
   * that need the failure itself (the profile card's 503 state) use
   * {@link refresh}.
   */
  readonly status$: Observable<SavedAiKeyStatus> = defer(() => {
    if (!this.requested) {
      this.refresh().subscribe({ error: () => undefined });
    }
    return this.cache;
  }).pipe(filter((s): s is SavedAiKeyStatus => s !== null));

  /** Re-reads the status from the server, updating {@link status$}. Errors propagate. */
  refresh(): Observable<SavedAiKeyStatus> {
    this.requested = true;
    return this.http.get<SavedAiKeyStatus>(this.url).pipe(
      tap(status => this.cache.next(status)),
      catchError((err: unknown) => {
        // Let a later status$ subscriber try again rather than caching the failure forever.
        this.requested = false;
        this.cache.next(NOT_CONFIGURED);
        return throwError(() => err);
      })
    );
  }

  /** Saves (or replaces) the key; the server validates it against Anthropic first (400 on a bad key/model). */
  save(apiKey: string, model: string): Observable<SavedAiKeyStatus> {
    return this.http.put<SavedAiKeyStatus>(this.url, { apiKey, model }).pipe(
      tap(status => this.setStatus(status))
    );
  }

  /** Changes the saved model without re-entering the key. */
  updateModel(model: string): Observable<SavedAiKeyStatus> {
    return this.http.patch<SavedAiKeyStatus>(this.url, { model }).pipe(
      tap(status => this.setStatus(status))
    );
  }

  remove(): Observable<void> {
    return this.http.delete<void>(this.url).pipe(
      tap(() => this.setStatus(NOT_CONFIGURED))
    );
  }

  /** A write's response is authoritative: status$ serves it without another GET. */
  private setStatus(status: SavedAiKeyStatus): void {
    this.requested = true;
    this.cache.next(status);
  }

  /** Models the saved key can use (404 if no key is saved). */
  listModels(): Observable<string[]> {
    return this.http.get<string[]>(`${this.url}/models`).pipe(
      map(models => Array.isArray(models) ? models : [])
    );
  }
}

/**
 * The server's message for a failed save/update (a plain-text or
 * `{message}`/`{error}` JSON body), or a generic fallback.
 */
export function describeSavedAiKeyError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (typeof body === 'string' && body.trim().length > 0) {
      return body.trim();
    }
    if (body && typeof body === 'object') {
      if (typeof body.message === 'string' && body.message.trim()) {
        return body.message.trim();
      }
      if (typeof body.error === 'string' && body.error.trim()) {
        return body.error.trim();
      }
    }
    if (err.status === 0) {
      return "Can't reach Sockbowl. Check your connection and try again.";
    }
    if (err.status === 503) {
      return "Saved keys aren't enabled on this server.";
    }
  }
  return 'Something went wrong. Please try again.';
}
