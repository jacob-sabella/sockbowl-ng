import { HTTP_BASE, QUESTIONS_BASE } from './config.js';

export interface CreatedGame { gameSessionId: string; joinCode: string; }
export interface JoinResult {
  gameSessionId: string;
  playerSecret: string;
  playerSessionId: string;
  joinStatus?: string;
  userId?: string | null;
}

/** Create a new game session. proctorType ONLINE_PROCTOR drives the read/judge flow. */
export async function createGame(
  gameMode = 'QUIZ_BOWL_CLASSIC',
  proctorType = 'ONLINE_PROCTOR',
  bonusesEnabled = true,
): Promise<CreatedGame> {
  const res = await fetch(`${HTTP_BASE}/api/v1/session/create-new-game-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameSettings: { gameMode, proctorType, bonusesEnabled } }),
  });
  if (!res.ok) throw new Error(`createGame ${res.status}: ${await res.text()}`);
  const d: any = await res.json();
  return { gameSessionId: d.id, joinCode: d.joinCode };
}

/** Join a game by its join code as a guest with a display name. */
export async function joinByCode(joinCode: string, name: string): Promise<JoinResult> {
  const res = await fetch(`${HTTP_BASE}/api/v1/session/join-game-session-by-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ joinCode, name }),
  });
  if (!res.ok) throw new Error(`join ${res.status}: ${await res.text()}`);
  return (await res.json()) as JoinResult;
}

/**
 * Generate a packet from the local question bank and return its id, for a match
 * with genuine questions. Backed by `POST /api/qbreader/import-random` (D15),
 * which is guest-allowed in both auth modes: with auth off it returns an
 * ownerless DRAFT packet as before; with auth on and no bearer (the harness
 * never sends one) it returns an ownerless, game-only EPHEMERAL packet, usable
 * only via `SetMatchPacket`. The now-removed `/api/qbreader/import` (a
 * setName/packetNumber lookup against the real qbreader.org) is gone —
 * questions come from the local bank, selected by count instead of by set.
 */
export async function importQbreaderPacket(
  tossupCount = 13,
  bonusCount = 5,
  name?: string,
): Promise<string> {
  const res = await fetch(`${QUESTIONS_BASE}/api/qbreader/import-random`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tossupCount, bonusCount, name }),
  });
  if (!res.ok) throw new Error(`importRandomPacket ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}
