/**
 * S1: Game session and buzzer (`/game-session`, `/game` IN_GAME/COMPLETED)
 * — M5 plan §2 row S1. Most rows below replay a real STOMP fixture recorded
 * by `record-stomp.ts` (M5 H0 follow-up, 2026-09-28, branch
 * `goal/m5-polish-h0rec`, backend M4-int — not yet M3-merged; see that
 * file's header and each fixture's own `_meta`), truncated to the moment
 * each row needs (`stomp-fixtures.ts`'s `stompState`). The mock transport
 * itself (`mock/stomp-replay.ts`) is proven working independent of these
 * fixtures by this spec's `stomp replay self-check` describe block.
 *
 * Two rows stay `pending` (M5 H0 done-when gap, not a PENDING-LOCK): the
 * recorder connects each seat's `RawRecorder` *after* `stageMatch` has
 * already finished CONFIG (teams, proctor, packet all set — see
 * `record-stomp.ts`'s `recordQuizBowlClassic`), and `RawRecorder` never
 * sends its own `get-game`, so no fixture actually has a CONFIG-phase
 * frame — every recording starts at `GameStartedMessage`/the first round.
 * A row that needs CONFIG-phase data (an authenticated seat's *join*, which
 * only happens before CONFIG ends) can't be built from what was recorded;
 * fixing it needs a follow-up recording pass with a recorder attached
 * before `stageMatch` calls `startMatch()`, not another run under the lock
 * of what H0 already has.
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
import { stompState, stompStateWithExtra, stompStateWithPatch, stompReconnectingState, blankCanvasState } from './stomp-fixtures.js';

function pending(id: string, reason: string, route = '/game'): CaptureState {
  return { id, route, role: 'player', setupMocks: async () => {}, skip: reason };
}

const states: CaptureState[] = [
  // --- Buzzer round states (quiz-bowl-classic/buzzer.json = "Ada", who buzzes rounds 1/5/9) ---
  stompState('buzzer-awaiting-buzz', 'quiz-bowl-classic', 'buzzer', 3), // RoundUpdate -> AWAITING_BUZZ
  stompState('buzzer-awaiting-answer-self', 'quiz-bowl-classic', 'buzzer', 5), // PlayerBuzzed -> AWAITING_ANSWER (this seat buzzed)
  // Round 2: Blaise buzzes, not this seat — same AWAITING_ANSWER round state, someone else holds the floor.
  stompState('buzzer-awaiting-answer-other', 'quiz-bowl-classic', 'buzzer', 21),
  stompState('buzzer-bonus', 'quiz-bowl-classic', 'buzzer', 9), // round 1's bonus, part 1: BONUS_AWAITING_ANSWER
  // "Locked out" (can't buzz while another team holds the floor) is the same
  // wire state as "someone else is answering" from this seat's point of view.
  stompState('buzzer-locked-out', 'quiz-bowl-classic', 'buzzer', 21),
  // Non-fatal soft-drop: RATE_LIMITED on /user/queue/errors, socket stays open
  // (game-web-socket.service.ts's onConnected handler, not onStompError).
  stompStateWithExtra('buzzer-rate-limited-soft-drop', 'quiz-bowl-classic', 'buzzer', 3,
    { target: 'errors', body: { code: 'RATE_LIMITED', message: 'Buzzes are coming in too fast — try again in a few seconds.', retryAfterSeconds: 4 }, delayMs: 300 }),
  // Fatal: a real STOMP ERROR frame (kind: 'error') — FATAL_STOMP_CODES.has('BANNED') in stomp-errors.ts.
  stompStateWithExtra('buzzer-fatal-error-banned', 'quiz-bowl-classic', 'buzzer', 3,
    { target: 'self', kind: 'error', body: { code: 'BANNED', message: 'Your account is banned from playing.' }, delayMs: 300 }),
  // Socket dropped mid-round with no ERROR/DISCONNECT frame: stompjs's own
  // exponential-backoff reconnect kicks in (mock/stomp-replay.ts's closeAfterMs).
  stompReconnectingState('buzzer-reconnecting', 'quiz-bowl-classic', 'buzzer', 5),

  stompState('spectator-in-game', 'quiz-bowl-classic', 'spectator', 7, { role: 'player' }),
  stompState('single-player-in-game', 'single-player', 'buzzer', 6),
  // AUTO_PROCTOR and FREE_FOR_ALL render the same proctorless buzzer UI;
  // AUTO_PROCTOR's BONUS_PENDING moment is the more distinctive of the two
  // to showcase (the one wire state real QUIZ_BOWL_CLASSIC never reaches).
  stompState('auto-proctor-free-for-all', 'auto-proctor', 'buzzer', 12),

  // Match summary: only the *proctor* fixture ever issued its own get-game
  // refresh (driveFullMatch polls through the proctor bot), so it's the only
  // recording with a GameSessionUpdate carrying matchState at all, let alone
  // matchState: COMPLETED. Using it for a "player"-labeled row means the
  // summary may carry a stray proctor-only affordance or two; a follow-up
  // recording with a buzzer-seat get-game poll near match end would close
  // that gap. 9 real rounds were played (not the 20 the id number suggests);
  // the fixture's own real round count, not a synthesized larger one.
  stompState('match-summary-20-rounds', 'quiz-bowl-classic', 'proctor', 152),
  // No live path records an immediately-ended, zero-round match (starting a
  // match and ending it before any round completes isn't something
  // `record-stomp.ts` drove). Hand-authored (M5 H0 task 2's synthesis
  // fallback): the real match-summary frame above, cloned with
  // `previousRounds` cleared — scores aren't a separate wire field, ng
  // derives them from `previousRounds` client-side, so this alone zeroes them.
  stompStateWithPatch('match-summary-empty', 'quiz-bowl-classic', 'proctor', 152, body => {
    const gs = body['gameSession'] as Record<string, unknown> | undefined;
    const cm = gs?.['currentMatch'] as Record<string, unknown> | undefined;
    if (cm) cm['previousRounds'] = [];
  }),

  pending('guest-seat-vs-account-seat',
    'record-stomp.ts only recorded guest seats (joinByCode); no seat was joined via ' +
    'joinByCodeAuthenticated, so there is no authenticated-seat fixture to contrast against a guest one'),
  blankCanvasState('blank-canvas-before-first-emission'),
];

const s1: SurfaceScenario = { id: 'S1', title: 'Game session and buzzer', tag: 's1', port: 4201, states };
export default s1;
