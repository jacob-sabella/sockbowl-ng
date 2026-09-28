/**
 * S3: Config and lobby (`/game` CONFIG) — M5 plan §2 row S3. Every state
 * needs an active `MatchState.CONFIG` session reached over STOMP.
 * `record-stomp.ts` (M5 H0 follow-up, 2026-09-28) ran under the fullstack
 * lock and recorded QUIZ_BOWL_CLASSIC/SINGLE_PLAYER/AUTO_PROCTOR/
 * FREE_FOR_ALL — but every one of those recordings' `RawRecorder`s connect
 * *after* `stageMatch`/the proctorless setup has already finished CONFIG
 * (teams picked, proctor claimed, packet set) and gone on to
 * `startMatch()`, and `RawRecorder` never sends its own `get-game`
 * (`record-stomp.ts`'s doc comment), so **no recorded fixture contains a
 * single CONFIG-phase frame** — every one starts at `GameStartedMessage`/
 * the first round. This was PENDING-LOCK before the recording ran; it is
 * now a real gap in what was recorded, not a lock wait, so re-running
 * H0's lock protocol on the same recording script would not fix it. A
 * follow-up needs a recorder (or a bot polling get-game) attached while the
 * session is still in CONFIG — e.g. right after `createGame`/`joinByCode`,
 * before any `setPacket`/`becomeProctor`/`startMatch` call.
 */
import type { CaptureState, SurfaceScenario } from './types.js';

const PENDING_CONFIG_GAP =
  'no recorded fixture contains a CONFIG-phase frame (every record-stomp.ts recording starts at ' +
  'GameStartedMessage, after CONFIG already finished) — see this file\'s header; a follow-up recording ' +
  'pass, not a re-run of the H0 lock, is what unblocks it';

function pending(id: string): CaptureState {
  return { id, route: '/game', role: 'player', setupMocks: async () => {}, skip: PENDING_CONFIG_GAP };
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
