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
 * Join a game by code as the signed-in account behind `accessToken` (the
 * game backend's `join-game-session-authenticated`, mirroring
 * `GameSessionService.joinGameAuthenticated`) — binds the seat to the
 * Keycloak identity so the M2 draft-ownership rule (`PACKET_NOT_AVAILABLE`)
 * sees a real, non-guest player (M3 E1's "draft privacy in game" spec).
 */
export async function joinByCodeAuthenticated(joinCode: string, name: string, accessToken: string): Promise<JoinResult> {
  const res = await fetch(`${HTTP_BASE}/api/v1/session/join-game-session-authenticated`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ joinCode, name }),
  });
  if (!res.ok) throw new Error(`joinAuthenticated ${res.status}: ${await res.text()}`);
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

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${QUESTIONS_BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`graphql ${res.status}: ${await res.text()}`);
  const body: any = await res.json();
  if (body.errors?.length) throw new Error(`graphql errors: ${JSON.stringify(body.errors)}`);
  return body.data as T;
}

export interface SeededPacket { id: string; name: string; tossupCount: number; bonusCount: number; }

/**
 * Look up a real, already-seeded PUBLISHED packet by (exact) name via
 * `searchPacketsByName`, then fetch its full tossup/bonus counts. Used by
 * `full-match` in place of `importQbreaderPacket`: import-random draws from
 * a separate bank of `:BankTossup`/`:BankBonus` nodes this compose stack
 * doesn't seed (a reported M3 follow-up), while this queries the same
 * imported-packet bank the ng Playwright specs use via "Search Existing"
 * (NG-R2-02).
 */
export async function findSeededPacket(name: string): Promise<SeededPacket> {
  const searchQuery = `query($name: String!) { searchPacketsByName(name: $name) { id name } }`;
  const { searchPacketsByName } = await graphql<{ searchPacketsByName: { id: string; name: string }[] }>(
    searchQuery,
    { name },
  );
  const match = searchPacketsByName.find((p) => p.name === name) ?? searchPacketsByName[0];
  if (!match) {
    throw new Error(`findSeededPacket: no packet found matching "${name}"`);
  }

  const detailQuery = `query($id: ID!) { getPacketById(id: $id) { id name tossups { order } bonuses { order } } }`;
  const { getPacketById } = await graphql<{
    getPacketById: { id: string; name: string; tossups: unknown[]; bonuses: unknown[] } | null;
  }>(detailQuery, { id: match.id });
  if (!getPacketById) {
    throw new Error(`findSeededPacket: getPacketById(${match.id}) returned null`);
  }

  return {
    id: getPacketById.id,
    name: getPacketById.name,
    tossupCount: getPacketById.tossups.length,
    bonusCount: getPacketById.bonuses.length,
  };
}
