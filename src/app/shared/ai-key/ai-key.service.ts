import { Injectable } from '@angular/core';

/** Same key `packet-search.component.ts` has always used; kept so a remembered key survives N5's extraction. */
const STORAGE_KEY = 'openai_api_key';

/**
 * The API-key/remember-key half of the AI assist picker (PB-08), extracted
 * out of `packet-search.component.ts`'s inline logic so both the game's
 * packet search and the builder's AI-assist form (N3) can share it (M3 plan
 * 3.3.1/3.3.5). N5 finishes the extraction and switches `packet-search` to
 * use this service.
 */
@Injectable({
  providedIn: 'root'
})
export class AiKeyService {
  /** Reads the remembered key, if any. Tolerates storage being unavailable. */
  loadKey(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  /** Remembers `apiKey`, or forgets it when `remember` is false or the key is empty. */
  saveKey(apiKey: string, remember: boolean): void {
    try {
      if (remember && apiKey) {
        localStorage.setItem(STORAGE_KEY, apiKey);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable — the key just isn't remembered across reloads.
    }
  }

  forgetKey(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
