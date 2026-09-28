/**
 * M5 H0 follow-up: turns a `record-stomp.ts` fixture (or a self-authored
 * frame list) into a `CaptureState`'s `route` + `setupMocks`, for S1/S2/S3.
 *
 * A fixture is the *entire* wire history of one real match from one seat's
 * point of view (up to ~230 frames with real inter-message delays matching
 * the game's actual timers). A capture state wants one specific moment.
 * `sliceFixture` gets there by taking a prefix of the real frames — up to
 * and including the frame that first put the seat into the state being
 * captured — and replaying that prefix with (almost) no delay, so
 * `mockStompReplay` delivers it well inside `capture.spec.ts`'s
 * `networkidle` wait. Nothing after the cut point is fabricated: every frame
 * that *is* sent is byte-for-byte what the real M4-int backend sent (see
 * each fixture's own `_meta`), just compressed in time.
 */
import type { Page } from '@playwright/test';
import type { CaptureState, SurfaceScenario } from './types.js';
import { mockStompReplay, type ReplayFrame } from '../mock/stomp-replay.js';
import { loadFixture } from '../fixtures/load.js';

export interface StompFixture {
  _meta: Record<string, unknown>;
  gameSessionId: string;
  playerSessionId: string;
  frames: ReplayFrame[];
}

/** Loads one `record-stomp.ts` output file (`fixtures/stomp/<game-mode>/<seat>.json`). */
export function loadStompFixture(gameMode: string, seat: string): StompFixture {
  return loadFixture<StompFixture>(`stomp/${gameMode}/${seat}.json`);
}

/**
 * Real, structural (non-spoiler) `gameSettings` to seed {@link ensureBootstrap}
 * with, per game mode — `createGame`'s actual `record-stomp.ts` call params
 * for that mode. `QUIZ_BOWL_CLASSIC`'s values are copied verbatim from
 * `quiz-bowl-classic/proctor.json`'s own real `GameSessionUpdate` (same
 * `gameSessionId` as `quiz-bowl-classic/buzzer.json` — the one fixture this
 * is currently needed for), so it's exactly right, not guessed.
 */
const BOOTSTRAP_GAME_SETTINGS: Record<string, Record<string, unknown>> = {
  'quiz-bowl-classic': {
    proctorType: 'ONLINE_PROCTOR', gameMode: 'QUIZ_BOWL_CLASSIC', bonusesEnabled: true,
    timerSettings: { tossupTimerSeconds: 5, bonusTimerSeconds: 5, autoTimerEnabled: true, readingWordsPerSecond: 4 },
    autoJudgedMultiplayer: false, proctorless: false,
  },
  'single-player': {
    proctorType: 'NO_PROCTOR', gameMode: 'SINGLE_PLAYER', bonusesEnabled: false,
    timerSettings: { tossupTimerSeconds: 5, bonusTimerSeconds: 5, autoTimerEnabled: true, readingWordsPerSecond: 4 },
    autoJudgedMultiplayer: true, proctorless: true,
  },
  'auto-proctor': {
    proctorType: 'NO_PROCTOR', gameMode: 'AUTO_PROCTOR', bonusesEnabled: true,
    timerSettings: { tossupTimerSeconds: 5, bonusTimerSeconds: 5, autoTimerEnabled: true, readingWordsPerSecond: 4 },
    autoJudgedMultiplayer: true, proctorless: true,
  },
  'free-for-all': {
    proctorType: 'NO_PROCTOR', gameMode: 'FREE_FOR_ALL', bonusesEnabled: true,
    timerSettings: { tossupTimerSeconds: 5, bonusTimerSeconds: 5, autoTimerEnabled: true, readingWordsPerSecond: 4 },
    autoJudgedMultiplayer: true, proctorless: true,
  },
};

/**
 * `GameStateService.gameSessionState` starts as `{} as GameSession`
 * (`game-state.service.ts`) and is only ever wholesale-replaced by a
 * `GameSessionUpdate`; every other handler (`GameStartedMessage`,
 * `RoundUpdate`, ...) mutates `currentMatch.*` in place and throws
 * (`Cannot set properties of undefined`) if no `GameSessionUpdate` has
 * landed yet. Every `record-stomp.ts` recording's `RawRecorder` subscribes
 * moments *after* that seat's own connect-time bootstrapping `get-game`
 * reply already went out (this file's header), so most fixtures are missing
 * one — except where the seat's own driving logic re-polls `get-game` early
 * enough for the recorder to catch a later reply (`quiz-bowl-classic/
 * proctor.json`'s proctor-driving loop; the proctorless bots' own `waitFor`
 * polling). `quiz-bowl-classic/buzzer.json` has no `GameSessionUpdate`
 * anywhere in the whole recording (confirmed by scanning it), so any slice
 * of it needs one prepended. This synthesizes the minimal one needed to
 * stop the crash: everything it sets except `gameSettings` (never patched
 * again by any later message) is overwritten within the first 1-3 real
 * frames that always follow (`PlayerRosterUpdate`/`GameStartedMessage`/
 * `RoundUpdate`, each a wholesale field replacement, not a merge) well
 * before the capture's screenshot, so nothing invented survives into the
 * final render.
 */
function ensureBootstrap(gameMode: string, fixture: StompFixture, frames: ReplayFrame[]): ReplayFrame[] {
  const hasSnapshot = frames.some(f => (f.body as Record<string, unknown> | undefined)?.['messageContentType'] === 'GameSessionUpdate');
  if (hasSnapshot) return frames;
  const gameSettings = BOOTSTRAP_GAME_SETTINGS[gameMode] ?? BOOTSTRAP_GAME_SETTINGS['quiz-bowl-classic'];
  const bootstrap: ReplayFrame = {
    target: 'self',
    kind: 'message',
    delayMs: 0,
    synthesized: true,
    body: {
      messageContentType: 'GameSessionUpdate',
      messageType: 'PROGRESSION',
      gameSession: {
        id: fixture.gameSessionId,
        joinCode: 'H0MOCK',
        gameSettings,
        gameOwnerId: null,
        playerList: [],
        teamList: [],
        currentMatch: { matchState: 'CONFIG', packet: null, previousRounds: [], currentRound: null },
        currentRound: null,
        proctor: null,
      },
    },
  };
  return [bootstrap, ...frames];
}

/**
 * A prefix of `fixture.frames` ending at (and including) `endIndex`, with
 * every `delayMs` collapsed to 0 except the very first frame's (kept small
 * but non-zero so the mock's `deliver()` loop — which awaits each delay in
 * turn — yields at least once per frame rather than blocking the event loop
 * in one synchronous burst), and a synthetic bootstrap prepended if needed
 * (see {@link ensureBootstrap}).
 */
function truncate(gameMode: string, fixture: StompFixture, endIndex: number): ReplayFrame[] {
  const sliced = ensureBootstrap(gameMode, fixture, fixture.frames.slice(0, endIndex + 1));
  return sliced.map((f, i) => ({ ...f, delayMs: i === 0 ? (f.delayMs ? 1 : 0) : 0 }));
}

/** The `/game` route with the matrix params `game-canvas`'s resolver reads (CLAUDE.md routing note). */
function gameRoute(gameSessionId: string, playerSessionId: string, playerSecret = 'h0-mock-secret'): string {
  return `/game;gameSessionId=${gameSessionId};playerSessionId=${playerSessionId};playerSecret=${playerSecret}`;
}

/**
 * Build a `/game` capture state that replays a real fixture's frames up
 * through `endIndex`, then stops (the mock never sends anything after the
 * chosen moment, so the canvas stays parked there for the screenshot).
 */
export function stompState(
  id: string,
  gameMode: string,
  seat: string,
  endIndex: number,
  opts: Partial<CaptureState> & { note?: string } = {},
): CaptureState {
  const fixture = loadStompFixture(gameMode, seat);
  const frames = truncate(gameMode, fixture, endIndex);
  const { note: _note, ...rest } = opts;
  return {
    id,
    route: gameRoute(fixture.gameSessionId, fixture.playerSessionId),
    role: 'player',
    setupMocks: async (page: Page) => {
      await mockStompReplay(page, { gameSessionId: fixture.gameSessionId, playerSessionId: fixture.playerSessionId, frames });
    },
    afterGoto: async (page: Page) => { await page.waitForTimeout(400); }, // let the replayed prefix finish rendering
    ...rest,
  };
}

/**
 * Same as {@link stompState}, but appends one extra hand-authored frame
 * after the real prefix (a STOMP error, most often — see `s1.ts`'s
 * `buzzer-fatal-error-banned`/`buzzer-rate-limited-soft-drop`). `extra`'s
 * `delayMs` is left as given (small, explicit), not zeroed.
 */
export function stompStateWithExtra(
  id: string,
  gameMode: string,
  seat: string,
  endIndex: number,
  extra: ReplayFrame,
  opts: Partial<CaptureState> = {},
): CaptureState {
  const fixture = loadStompFixture(gameMode, seat);
  const frames = [...truncate(gameMode, fixture, endIndex), extra];
  return {
    id,
    route: gameRoute(fixture.gameSessionId, fixture.playerSessionId),
    role: 'player',
    setupMocks: async (page: Page) => {
      await mockStompReplay(page, { gameSessionId: fixture.gameSessionId, playerSessionId: fixture.playerSessionId, frames });
    },
    afterGoto: async (page: Page) => { await page.waitForTimeout(400); },
    ...opts,
  };
}

/**
 * A `/game` capture state with a real fixture's frames replayed, then the
 * mock socket dropped (no ERROR/DISCONNECT) after `closeAfterMs` — for a
 * `*-reconnecting` row (`mock/stomp-replay.ts`'s `closeAfterMs`).
 */
export function stompReconnectingState(
  id: string,
  gameMode: string,
  seat: string,
  endIndex: number,
  closeAfterMs = 300,
  opts: Partial<CaptureState> = {},
): CaptureState {
  const fixture = loadStompFixture(gameMode, seat);
  const frames = truncate(gameMode, fixture, endIndex);
  return {
    id,
    route: gameRoute(fixture.gameSessionId, fixture.playerSessionId),
    role: 'player',
    setupMocks: async (page: Page) => {
      await mockStompReplay(page, {
        gameSessionId: fixture.gameSessionId, playerSessionId: fixture.playerSessionId, frames, closeAfterMs,
      });
    },
    // Wait past closeAfterMs plus BASE_RECONNECT_DELAY_MS's first tick
    // (`game-web-socket.service.ts`) so the client has actually dropped and
    // started visibly retrying before the screenshot.
    afterGoto: async (page: Page) => { await page.waitForTimeout(closeAfterMs + 900); },
    ...opts,
  };
}

/**
 * Same as {@link stompState}, but deep-clones the frame at `endIndex` and
 * runs `patch` on its `body` before replaying (in place, no return value) —
 * for a hand-authored variant of a real moment (M5 H0 task 2's synthesis
 * fallback), e.g. "the same match-summary payload, with no rounds played".
 * Every frame before `endIndex` is replayed unpatched, exactly as recorded.
 */
export function stompStateWithPatch(
  id: string,
  gameMode: string,
  seat: string,
  endIndex: number,
  patch: (body: Record<string, unknown>) => void,
  opts: Partial<CaptureState> = {},
): CaptureState {
  const fixture = loadStompFixture(gameMode, seat);
  const frames = truncate(gameMode, fixture, endIndex);
  const last = frames[frames.length - 1];
  const patchedBody = JSON.parse(JSON.stringify(last.body)) as Record<string, unknown>;
  patch(patchedBody);
  frames[frames.length - 1] = { ...last, body: patchedBody, synthesized: true } as ReplayFrame;
  return {
    id,
    route: gameRoute(fixture.gameSessionId, fixture.playerSessionId),
    role: 'player',
    setupMocks: async (page: Page) => {
      await mockStompReplay(page, { gameSessionId: fixture.gameSessionId, playerSessionId: fixture.playerSessionId, frames });
    },
    afterGoto: async (page: Page) => { await page.waitForTimeout(400); },
    ...opts,
  };
}

/** A `/game` state with no STOMP traffic at all — the canvas before its first message. */
export function blankCanvasState(id: string, opts: Partial<CaptureState> = {}): CaptureState {
  const gameSessionId = 'h0-blank-canvas-session';
  const playerSessionId = 'h0-blank-canvas-player';
  return {
    id,
    route: gameRoute(gameSessionId, playerSessionId),
    role: 'player',
    setupMocks: async (page: Page) => {
      await mockStompReplay(page, { gameSessionId, playerSessionId, frames: [] });
    },
    ...opts,
  };
}

export type { SurfaceScenario };
