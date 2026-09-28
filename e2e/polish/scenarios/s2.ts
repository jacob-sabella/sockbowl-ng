/**
 * S2: Proctor (and cast receiver) — M5 plan §2 row S2. Four of the five
 * proctor states replay a real STOMP fixture recorded by `record-stomp.ts`
 * (M5 H0 follow-up, 2026-09-28, backend M4-int — not yet M3-merged;
 * `quiz-bowl-classic/proctor.json`, truncated per row — see `s1.ts`'s
 * header for the general approach and `stomp-fixtures.ts`). The fifth,
 * `proctor-owner-reclaims-seat`, is a CONFIG-phase (lobby) feature no
 * fixture covers — same recording gap as `s1.ts`'s header describes and
 * every `s3.ts` row. The cast receiver needs **no** mocks at all
 * (`__castRender(state)` is already exposed, same as `e2e/scripts/cast-shots.ts`),
 * so its states are captured for real, not skipped.
 */
import type { Page } from '@playwright/test';
import type { CaptureState, SurfaceScenario } from './types.js';
import { stompState } from './stomp-fixtures.js';

function pending(id: string, reason: string): CaptureState {
  return { id, route: '/game', role: 'player', setupMocks: async () => {}, skip: reason };
}

/** Drives the receiver's exposed test hook directly, the same contract `cast-shots.ts` already uses. */
function castState(id: string, state: Record<string, unknown>, opts: Partial<CaptureState> = {}): CaptureState {
  return {
    id,
    route: '/cast-receiver.html',
    role: 'player',
    setupMocks: async () => {},
    afterGoto: async (page: Page) => {
      await page.waitForFunction(() => typeof (window as unknown as { __castRender?: unknown }).__castRender === 'function');
      await page.evaluate(s => (window as unknown as { __castRender: (s: unknown) => void }).__castRender(s), state);
      await page.waitForTimeout(350);
    },
    ...opts,
  };
}

const CONFIG_STATE = {
  messageType: 'GAME_STATE_UPDATE', theme: 'dark', timestamp: 1, isConfigStage: true,
  joinCode: 'PLAY42', proctorName: 'Alex Rivera', packetName: '2026 Sockbowl Invitational — Packet 4', gameMode: 'QUIZ_BOWL_CLASSIC',
  teamRosters: [
    { teamId: 't1', teamName: 'Team Vermeer', playerNames: ['Ada', 'Cleo', 'Ravi'] },
    { teamId: 't2', teamName: 'Team Curie', playerNames: ['Blaise', 'Dov'] },
  ],
};
const INGAME_STATE = {
  messageType: 'GAME_STATE_UPDATE', theme: 'dark', timestamp: 2, isConfigStage: false,
  roundNumber: 5, category: 'Literature', subcategory: 'American Literature', roundState: 'AWAITING_ANSWER',
  questionVisible: true,
  questionText: 'This author wrote that “If I were the Head of the Church or the State, / I’d powder my nose and go to bed” in a poem; for 10 points, name this British-American poet of The Age of Anxiety.',
  answerVisible: false, answerText: '',
  currentBuzz: { playerName: 'Ada', teamName: 'Team Vermeer', teamId: 't1', correct: null },
  teamScores: [{ teamId: 't1', teamName: 'Team Vermeer', score: 30 }, { teamId: 't2', teamName: 'Team Curie', score: 15 }],
};

const states: CaptureState[] = [
  // Round 1, mid-answer: a generically representative "the proctor is running a round" shot.
  stompState('proctor-round-states', 'quiz-bowl-classic', 'proctor', 8),
  // Same moment, framed for the id's specific meaning: the buzz has landed,
  // judgment (correct/incorrect) hasn't been given yet.
  stompState('proctor-buzz-pending-judgment', 'quiz-bowl-classic', 'proctor', 8),
  stompState('proctor-bonus-parts-read', 'quiz-bowl-classic', 'proctor', 13), // GameSessionUpdate -> BONUS_READING_PART
  stompState('proctor-last-question', 'quiz-bowl-classic', 'proctor', 149), // round 9 of 9, AWAITING_ANSWER
  pending('proctor-owner-reclaims-seat',
    'CONFIG-phase (lobby) feature; record-stomp.ts only recorded from GameStartedMessage onward ' +
    '(see s1.ts\'s header) — a follow-up recording pass, not a re-run of the H0 lock, is what unblocks it'),
  // Cast receiver: not blocked on STOMP (uses __castRender directly).
  castState('cast-config', CONFIG_STATE, { themes: ['dark'], viewports: ['tv', 'tv-720'] }),
  ...(['dark', 'light', 'nord', 'monokai', 'catppuccin', 'dracula', 'solarized-dark', 'solarized-light'] as const).map(theme =>
    castState(`cast-ingame-${theme}`, { ...INGAME_STATE, theme }, { themes: ['dark'], viewports: theme === 'dark' ? ['tv', 'tv-720'] : ['tv'] })),
  // Connection statuses (unavailable/disconnected/connecting/connected) are
  // driven by `presentation-connection.service.ts` events, not by
  // `__castRender`, so H0 can't fabricate them the way it can a game state —
  // left to S2's own FX/HD steps, which can drive the receiver end-to-end.
];

const s2: SurfaceScenario = { id: 'S2', title: 'Proctor and cast receiver', tag: 's2', port: 4202, states };
export default s2;
