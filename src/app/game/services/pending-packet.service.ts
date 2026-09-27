import { Injectable } from '@angular/core';

const STORAGE_KEY = 'sockbowl.pendingPacketId';

/**
 * Carries a packet id from the builder's "Play test" button (PB-15) across
 * the navigation to `/game-session?mode=single&packetId=...`, via
 * `sessionStorage` so it survives that route change (M3 plan 3.3.1). N5
 * wires the receiving end in `GameConfigComponent`.
 */
@Injectable({
  providedIn: 'root'
})
export class PendingPacketService {
  set(packetId: string): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, packetId);
    } catch {
      // sessionStorage unavailable (private mode, blocked storage) — Play
      // test degrades to the ordinary "pick a packet" flow.
    }
  }

  get(): string | null {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
