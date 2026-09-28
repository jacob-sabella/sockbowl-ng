/**
 * S3: Config and lobby (`/game` CONFIG) — M5 plan §2 row S3. Every state
 * needs an active `MatchState.CONFIG` session reached over STOMP, so every
 * row is `skip`ped until `record-stomp.ts` has run under the fullstack lock
 * (H0 PENDING-LOCK — see `s1.ts`'s header for the full rationale).
 */
import type { CaptureState, SurfaceScenario } from './types.js';

const PENDING_LOCK = 'needs STOMP fixtures from record-stomp.ts, run once under the fullstack lock (H0 PENDING-LOCK)';

function pending(id: string): CaptureState {
  return { id, route: '/game', role: 'player', setupMocks: async () => {}, skip: PENDING_LOCK };
}

const states: CaptureState[] = [
  pending('config-owner-view'),
  pending('config-proctor-unclaimed'),
  pending('config-player-view'),
  pending('config-spectator-view'),
  pending('config-packet-not-chosen'),
  pending('config-packet-loading'),
  pending('config-packet-chosen-ephemeral'),
  pending('config-packet-chosen-draft'),
  pending('config-packet-chosen-published'),
  pending('config-my-packets-empty'),
  pending('config-generate-ai-fails-closed'),
  pending('config-generate-quota-exhausted'),
  pending('config-generate-bring-your-own-key'),
  pending('config-one-team'),
  pending('config-many-teams-12-players'),
  pending('config-cast-button'),
];

const s3: SurfaceScenario = { id: 'S3', title: 'Config and lobby', tag: 's3', port: 4203, states };
export default s3;
