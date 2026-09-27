/**
 * Per-tab storage for the credentials of a joined game seat.
 *
 * The seat's secret never goes in the URL (it would land in history, logs and
 * Referer headers). The lobby writes it here after a join, and the game canvas
 * reads it back, including after a reload. sessionStorage is per tab, so two
 * tabs can hold two different seats.
 */
export interface StoredGameJoin {
  playerSessionId: string;
  /** Guest seats only. Seats bound to an account authenticate with a token. */
  playerSecret?: string;
  /** True when the seat was joined as the signed-in account. */
  authenticated: boolean;
}

export const GAME_JOIN_STORAGE_PREFIX = 'sockbowl.join.';

export function gameJoinStorageKey(gameSessionId: string): string {
  return GAME_JOIN_STORAGE_PREFIX + gameSessionId;
}

export function saveGameJoin(gameSessionId: string, join: StoredGameJoin): void {
  try {
    sessionStorage.setItem(gameJoinStorageKey(gameSessionId), JSON.stringify(join));
  } catch {
    // Storage blocked (private mode, quota): the seat still works for this page.
  }
}

export function loadGameJoin(gameSessionId: string): StoredGameJoin | null {
  try {
    const raw = sessionStorage.getItem(gameJoinStorageKey(gameSessionId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.playerSessionId === 'string' ? parsed as StoredGameJoin : null;
  } catch {
    return null;
  }
}

export function clearGameJoin(gameSessionId: string): void {
  try {
    sessionStorage.removeItem(gameJoinStorageKey(gameSessionId));
  } catch {
    // ignore
  }
}
