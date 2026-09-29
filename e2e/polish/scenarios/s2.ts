/**
 * S2: Proctor (and cast receiver) — M5 plan §2 row S2. Four of the five
 * proctor states replay a real STOMP fixture recorded by `record-stomp.ts`
 * (M5 H0 follow-up, 2026-09-28, backend M4-int — not yet M3-merged;
 * `quiz-bowl-classic/proctor.json`, truncated per row — see `s1.ts`'s
 * header for the general approach and `stomp-fixtures.ts`). The fifth,
 * `proctor-owner-reclaims-seat`, is a CONFIG-phase (lobby) feature: D18's
 * "owner can reassign the proctor seat" (`game-config.component.ts`
 * `canBecomeProctor()`), captured from a hand-authored CONFIG fixture
 * (M5 S2-16, the same pattern `s3.ts`'s header documents for its own
 * `config-quiz-bowl-classic/*` files) rather than skipped:
 * `fixtures/stomp/config-quiz-bowl-classic/owner-reclaims-seat.json` moves
 * `gameOwner: true` off the already-seated "Proctor" player and onto
 * "Ada", replayed as the viewing seat, so `canBecomeProctor()` is true even
 * though a proctor already holds the seat. The cast receiver needs **no**
 * mocks at all (`__castRender(state)` is already exposed, same as
 * `e2e/scripts/cast-shots.ts`), and its connection-toast states use the
 * `__castSetConnectionStatus` test hook (`cast-receiver.js`, M5 S2-08)
 * instead.
 */
import type { Page } from '@playwright/test';
import type { CaptureState, SurfaceScenario } from './types.js';
import { stompState } from './stomp-fixtures.js';

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

/**
 * Drives the connection-status toast directly via `__castSetConnectionStatus`
 * (M5 S2-08), optionally rendering a game state first so the toast appears
 * over real board content rather than the blank shell — matching how
 * `showDisconnected()` is meant to be seen in the room (M5 S2-16).
 */
function castStatusState(
  id: string,
  status: 'connecting' | 'disconnected',
  opts: Partial<CaptureState> & { onto?: Record<string, unknown> } = {},
): CaptureState {
  const { onto, ...rest } = opts;
  return {
    id,
    route: '/cast-receiver.html',
    role: 'player',
    setupMocks: async () => {},
    afterGoto: async (page: Page) => {
      await page.waitForFunction(() => typeof (window as unknown as { __castRender?: unknown }).__castRender === 'function');
      if (onto) {
        await page.evaluate(s => (window as unknown as { __castRender: (s: unknown) => void }).__castRender(s), onto);
      }
      await page.evaluate(
        s => (window as unknown as { __castSetConnectionStatus: (s: string) => void }).__castSetConnectionStatus(s),
        status,
      );
      await page.waitForTimeout(350);
    },
    themes: ['dark'],
    viewports: ['tv', 'tv-720'],
    ...rest,
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

// M5 S2-16: an 8-team board, the other half of the "2 and 8 teams" axis
// (adapt's S2-14 already covers the CSS grid; this exercises it with real
// scoreboard data at both TV sizes).
const INGAME_STATE_8_TEAMS = {
  ...INGAME_STATE,
  teamScores: [
    { teamId: 't1', teamName: 'Team Vermeer', score: 45 }, { teamId: 't2', teamName: 'Team Curie', score: 40 },
    { teamId: 't3', teamName: 'Team Noether', score: 35 }, { teamId: 't4', teamName: 'Team Turing', score: 30 },
    { teamId: 't5', teamName: 'Team Franklin', score: 25 }, { teamId: 't6', teamName: 'Team Hopper', score: 20 },
    { teamId: 't7', teamName: 'Team Lovelace', score: 15 }, { teamId: 't8', teamName: 'Team Darwin', score: 10 },
  ],
};

// M5 S2-16: a long tossup, the receiver-side counterpart of the proctor's
// own "extreme content" axis (M5 plan §2's "100+ character" bar, well
// past it here since the board sets it in Newsreader at a larger scale).
const INGAME_STATE_LONG_QUESTION = {
  ...INGAME_STATE,
  category: 'History', subcategory: 'World History',
  questionText: 'This ruler, whose reign saw the construction of an extensive network of royal roads and way-stations ' +
    'to speed communication across a territory stretching from the Indus Valley to the Aegean Sea, organized his ' +
    'domain into provinces called satrapies, each overseen by a governor who answered to roving inspectors known ' +
    'as the "eyes and ears of the king"; for 10 points, name this Achaemenid emperor, the son of Cambyses and ' +
    'successor of Cyrus the Great, who was defeated by a coalition of Greek city-states at the Battle of Marathon.',
};

// M5 S2-16: the answer-shown half of the "answer hidden/shown" axis (the
// default INGAME_STATE above is the hidden half, mid-judgment).
const INGAME_STATE_ANSWER_SHOWN = {
  ...INGAME_STATE,
  roundState: 'COMPLETED',
  currentBuzz: { playerName: 'Ada', teamName: 'Team Vermeer', teamId: 't1', correct: true },
  answerVisible: true, answerText: 'W. H. <b>Auden</b>',
};

const states: CaptureState[] = [
  // Round 1, waiting for a buzz: a generically representative "the proctor
  // is running a round" shot, deliberately a different frame than the
  // buzz-pending-judgment row below (M5 S2-16 - the two used to share frame
  // 8 and so produced byte-identical screenshots).
  stompState('proctor-round-states', 'quiz-bowl-classic', 'proctor', 6),
  // The buzz has landed; judgment (correct/incorrect) hasn't been given yet.
  stompState('proctor-buzz-pending-judgment', 'quiz-bowl-classic', 'proctor', 8),
  stompState('proctor-bonus-parts-read', 'quiz-bowl-classic', 'proctor', 13), // GameSessionUpdate -> BONUS_READING_PART
  stompState('proctor-last-question', 'quiz-bowl-classic', 'proctor', 149), // round 9 of 9, AWAITING_ANSWER
  // D18: the game owner sees "Become Proctor" even though a proctor is
  // already seated (see the file header and the fixture's own `_meta`).
  stompState('proctor-owner-reclaims-seat', 'config-quiz-bowl-classic', 'owner-reclaims-seat', 0),
  // Cast receiver: not blocked on STOMP (uses __castRender directly).
  castState('cast-config', CONFIG_STATE, { themes: ['dark'], viewports: ['tv', 'tv-720'] }),
  ...(['dark', 'light', 'nord', 'monokai', 'catppuccin', 'dracula', 'solarized-dark', 'solarized-light'] as const).map(theme =>
    castState(`cast-ingame-${theme}`, { ...INGAME_STATE, theme }, { themes: ['dark'], viewports: theme === 'dark' ? ['tv', 'tv-720'] : ['tv'] })),
  castState('cast-ingame-8-teams', INGAME_STATE_8_TEAMS, { themes: ['dark'], viewports: ['tv', 'tv-720'] }),
  castState('cast-ingame-long-question', INGAME_STATE_LONG_QUESTION, { themes: ['dark'], viewports: ['tv', 'tv-720'] }),
  castState('cast-answer-shown', INGAME_STATE_ANSWER_SHOWN, { themes: ['dark'], viewports: ['tv', 'tv-720'] }),
  // Connection statuses (M5 S2-08/S2-16): "unavailable" is the receiver's
  // own natural first paint in this harness (headless Chromium has no
  // `navigator.presentation.receiver`, so `initializeReceiver` calls
  // `showError` before any `__castRender` - see the backlog's
  // falsePositives entry), captured with no afterGoto at all. "Connecting"
  // and "disconnected" are driven by the test hook; "connected" is already
  // exercised by every `cast-*` row above (`__castRender` always calls
  // `showConnected()` first, M5 S2-08), so it isn't repeated here.
  { id: 'cast-status-unavailable', route: '/cast-receiver.html', role: 'player', setupMocks: async () => {},
    themes: ['dark'], viewports: ['tv', 'tv-720'] },
  castStatusState('cast-status-connecting', 'connecting'),
  castStatusState('cast-status-disconnected', 'disconnected', { onto: INGAME_STATE }),
];

const s2: SurfaceScenario = { id: 'S2', title: 'Proctor and cast receiver', tag: 's2', port: 4202, states };
export default s2;
