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

/** Import a real qbreader packet and return its id (for a match with genuine questions). */
export async function importQbreaderPacket(setName: string, packetNumber: number): Promise<string> {
  const res = await fetch(`${QUESTIONS_BASE}/api/qbreader/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setName, packetNumber }),
  });
  if (!res.ok) throw new Error(`importPacket ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}
