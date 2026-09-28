/**
 * S1: Game session and buzzer (`/game-session`, `/game` IN_GAME/COMPLETED)
 * — M5 plan §2 row S1. Every state below needs a real STOMP round to reach
 * (buzzer round states, join flows that land in an active match, match
 * summary), so every row is `skip`ped until `record-stomp.ts` has run under
 * the fullstack lock (H0 PENDING-LOCK — see that file). The mock transport
 * itself (`mock/stomp-replay.ts`) is proven working by this spec's
 * `stomp replay self-check` describe block, independent of these fixtures.
 *
 * `game-session` (the lobby, pre-join) does have a couple of states — join
 * errors, rate-limited create — that only need the game-session REST API
 * (`mock/rest.ts`) and no STOMP at all. They're left to S1's own FX/HD
 * steps rather than added speculatively here, so H0 doesn't guess at
 * `create-new-game-session`/`join-game-session-by-code` response shapes it
 * hasn't been asked to mock; `mock/rest.ts` and `harness/rest.ts` already
 * give S1 what it needs to add them.
 */
import type { CaptureState, SurfaceScenario } from './types.js';

const PENDING_LOCK = 'needs STOMP fixtures from record-stomp.ts, run once under the fullstack lock (H0 PENDING-LOCK)';

function pending(id: string, route = '/game'): CaptureState {
  return { id, route, role: 'player', setupMocks: async () => {}, skip: PENDING_LOCK };
}

const states: CaptureState[] = [
  pending('buzzer-awaiting-buzz'),
  pending('buzzer-awaiting-answer-self'),
  pending('buzzer-awaiting-answer-other'),
  pending('buzzer-bonus'),
  pending('buzzer-locked-out'),
  pending('buzzer-rate-limited-soft-drop'),
  pending('buzzer-fatal-error-banned'),
  pending('buzzer-reconnecting'),
  pending('spectator-in-game'),
  pending('single-player-in-game'),
  pending('auto-proctor-free-for-all'),
  pending('match-summary-empty'),
  pending('match-summary-20-rounds'),
  pending('guest-seat-vs-account-seat'),
  pending('blank-canvas-before-first-emission'),
];

const s1: SurfaceScenario = { id: 'S1', title: 'Game session and buzzer', tag: 's1', port: 4201, states };
export default s1;
