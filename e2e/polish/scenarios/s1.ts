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
 * `game-session` (the lobby, pre-join) states below (M5 S1-09, AY) use only
 * the game-session REST API (`mock/rest.ts`) and no STOMP at all — no
 * fullstack lock needed, since `create-new-game-session`/
 * `join-game-session-by-code` are S1's own endpoints
 * (`game-session.service.ts`) and their error-response shapes are S1's own
 * `handleGameError`/`RateLimitInterceptor` contract, not guessed.
 */
import type { Page } from '@playwright/test';
import type { CaptureState, SurfaceScenario } from './types.js';
import { stompState, stompStateWithExtra, stompStateWithPatch, stompReconnectingState, blankCanvasState } from './stomp-fixtures.js';
import { mockRest, apiError, type RestRoute } from '../mock/rest.js';

function pending(id: string, reason: string, route = '/game'): CaptureState {
  return { id, route, role: 'player', setupMocks: async () => {}, skip: reason };
}

/**
 * M5 S1-09: the buzzer dome's own layout (M5 S1-04) is the one place S1
 * wants the two extra §2 viewports beyond {mobile, desktop} — the 280px
 * floor (`mobile-min`) and the 820px tablet — on its two most representative
 * states (open dome, self holding the floor). A third viewport the backlog
 * asks for, 844×390 (the same phone rotated to landscape), has no matching
 * key in `manifest.ts`'s `VIEWPORTS` — that file is frozen (handoff H-04)
 * and out of S1's reach; requesting the key is left as a handoff instead of
 * guessed at here (see the surface's own audit notes).
 */
const BUZZER_EXTRA_VIEWPORTS = ['mobile', 'mobile-min', 'tablet', 'desktop'];

/**
 * M5 S1-09: a REST-only `/game-session` capture state. `authEnabled` stays
 * on (the plan's default axis) but the role is `anonymous` (no OIDC
 * session), so the guest name field renders too — the same "Your name"
 * label fixed by S1-30, exercised here instead of only on `/game`.
 */
function gameSessionState(
  id: string,
  opts: { routes?: RestRoute[]; afterGoto: (page: Page) => Promise<void> },
): CaptureState {
  return {
    id,
    route: '/game-session',
    role: 'anonymous',
    setupMocks: async (page: Page) => {
      if (opts.routes) {
        await mockRest(page, opts.routes);
      }
    },
    afterGoto: opts.afterGoto,
  };
}

/**
 * M5 S1-09: fast-forwards a `/game`-route state's page-side clock past
 * `CONNECTING_ESCALATION_MS` (`game-canvas.component.ts`, 15s), instead of a
 * real 15s+ wait per viewport×theme run — used for `canvas-connecting-
 * escalated` below. `page.clock` patches browser-page timers only, so a
 * state with any real network activity of its own keeps working normally
 * underneath it.
 *
 * Deliberately NOT used for a "stuck reconnecting past 15s" buzzer state:
 * `mockStompReplay`'s `page.routeWebSocket` handler answers *every* matching
 * connection, including the client's own automatic reconnect (stompjs's
 * `reconnectDelay`), not just the first one — so fast-forwarding a dropped
 * connection's page-side timers just fast-forwards it straight to a second,
 * fully-successful reconnect (back to the live, connected buzzer, not stuck
 * retrying). Reproducing the real backend's "still unreachable" failure
 * mode needs the mock itself to refuse a reconnect, which
 * `mock/stomp-replay.ts` (shared, H-04) doesn't do today — left as a
 * residual (this surface's own audit notes), not built here as a one-off
 * fork of a frozen file.
 */
function withEscalatedClock(base: CaptureState, forwardMs = 16_000): CaptureState {
  const baseSetup = base.setupMocks;
  const baseAfter = base.afterGoto;
  return {
    ...base,
    setupMocks: async (page: Page) => {
      await page.clock.install();
      await baseSetup(page);
    },
    afterGoto: async (page: Page) => {
      await baseAfter?.(page);
      // `runFor` (not `fastForward`, which "fires due timers at most once"
      // per Playwright's own doc — leaving a recurring `setInterval`-driven
      // reveal, like single-player's word-by-word text, only a handful of
      // ticks in) walks the clock forward and fires every due callback along
      // the way, so a repeating interval actually completes.
      await page.clock.runFor(forwardMs);
      await page.waitForTimeout(50); // let the resulting change detection paint
    },
  };
}

const states: CaptureState[] = [
  // --- Buzzer round states (quiz-bowl-classic/buzzer.json = "Ada", who buzzes rounds 1/5/9) ---
  // Round 1's tossupTimerSeconds is 5 (the fixture's own game settings,
  // `stomp-fixtures.ts`'s BOOTSTRAP_GAME_SETTINGS) — the whole tossup window
  // is inside the "urgent" (<=5s) band from its first tick, so this state
  // alone already exercises `.timer-display--urgent` and the once-per-
  // threshold sr-only announcement (M5 S1-10); no separate "urgent timer"
  // state is needed. Extra viewports (M5 S1-09): the dome layout's own
  // §2 coverage beyond {mobile, desktop}.
  stompState('buzzer-awaiting-buzz', 'quiz-bowl-classic', 'buzzer', 3, { viewports: BUZZER_EXTRA_VIEWPORTS }), // RoundUpdate -> AWAITING_BUZZ
  stompState('buzzer-awaiting-answer-self', 'quiz-bowl-classic', 'buzzer', 5, { viewports: BUZZER_EXTRA_VIEWPORTS }), // PlayerBuzzed -> AWAITING_ANSWER (this seat buzzed)
  // Round 2: Blaise buzzes, not this seat — same AWAITING_ANSWER round state, someone else holds the floor.
  stompState('buzzer-awaiting-answer-other', 'quiz-bowl-classic', 'buzzer', 21),
  stompState('buzzer-bonus', 'quiz-bowl-classic', 'buzzer', 9), // round 1's bonus, part 1: BONUS_AWAITING_ANSWER
  // "Locked out" (can't buzz while another team holds the floor) is the same
  // wire state as "someone else is answering" from this seat's point of view.
  stompState('buzzer-locked-out', 'quiz-bowl-classic', 'buzzer', 21),
  // WIP: the optimistic "BUZZING…" dome (M5 S1-24's `.is-self` styling
  // starts here, before the server ever echoes the buzz back) — a real
  // client-side click on the open dome, not a wire state (M5 S1-09).
  {
    ...stompState('buzzer-pending-self', 'quiz-bowl-classic', 'buzzer', 3),
    afterGoto: async (page: Page) => {
      await page.waitForTimeout(400); // let the replayed prefix finish rendering, as stompState's own default does
      await page.locator('#buzz-button').click();
    },
  },
  // Non-fatal soft-drop: RATE_LIMITED on /user/queue/errors, socket stays open
  // (game-web-socket.service.ts's onConnected handler, not onStompError).
  // Recaptured for M5 S1-09: `app-stomp-error-banner` (5s auto-hide) renders
  // one level up in `game-canvas`, and the 700ms total wait here (300ms
  // frame delay + the 400ms default afterGoto) lands well inside that
  // window, so the banner — not a live, unaffected dome — is what's on
  // screen; the dome underneath stays fully live (`errors` never touches
  // `currentBuzz`), which is exactly the point being shown.
  // `policy: 'stomp-buzz'` (M5 FF1 material_fixes #2): without it, `errors$`'s
  // RATE_LIMITED handler (`game-buzzer.component.ts`'s `errors$` subscription
  // checks `error.policy === 'stomp-buzz'`) never locks the dome, so this
  // capture used to show a live "BUZZ!" dome directly under a banner that
  // says "Try again in 4s" — the dome contradicting the banner it sits below.
  stompStateWithExtra('buzzer-rate-limited-soft-drop', 'quiz-bowl-classic', 'buzzer', 3,
    { target: 'errors', body: { code: 'RATE_LIMITED', policy: 'stomp-buzz', message: 'Buzzes are coming in too fast — try again in a few seconds.', retryAfterSeconds: 4 }, delayMs: 300 }),
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

  // S1-32 (P1) evidence gap (M5 FF1 material_fixes #5): neither proctorless
  // capture above actually shows the FIRST VIEWPORT case — question fully
  // revealed, anchored buzz control on screen, nobody buzzed yet.
  // `auto-proctor-free-for-all` never reaches AWAITING_BUZZ in the real
  // recording at all (this fixture's bot buzzes 4/19 words in, every round,
  // straight from PROCTOR_READING to AWAITING_ANSWER); `single-player-in-game`
  // stops on a later GameSessionUpdate that wholesale-replaces `currentRound`
  // with an empty `question` (an unrelated get-game reply), before its own
  // earlier RoundUpdate's full text ever gets a chance to render.
  //
  // Auto-proctor: patches the one PROCTOR_READING frame's `revealedWordCount`
  // up to its own real `totalWordCount`, and `question` to the exact full
  // text the SAME real round's own later COMPLETED frame sends (frame 60 of
  // this fixture) — nothing invented, just that round's own already-recorded
  // full text, shown at the moment before the bot's near-instant buzz
  // instead of after it.
  stompStateWithPatch('auto-proctor-question-revealed', 'auto-proctor', 'buzzer', 6, body => {
    const gs = body['gameSession'] as Record<string, unknown> | undefined;
    const match = gs?.['currentMatch'] as Record<string, unknown> | undefined;
    const round = match?.['currentRound'] as Record<string, unknown> | undefined;
    if (round) {
      round['revealedWordCount'] = round['totalWordCount'];
      round['question'] = 'Placeholder tossup 1 (M5 H0 AUTO_PROCTOR), for the M5 H0 STOMP recorder; for 10 points, name this synthetic thing.';
    }
  }, { viewports: ['mobile'] }),
  // Solo: the real RoundUpdate at index 5 already carries the round's full
  // question text (solo reveals it client-side, word by word, from that
  // full text — the server never withholds it, unlike auto-proctor above).
  // A faked page clock just fast-forwards past the ~6s client reveal timer
  // (19 words at the default reading speed) instead of a real wait per
  // viewport x theme run.
  withEscalatedClock(
    stompState('single-player-question-revealed', 'single-player', 'buzzer', 5, { viewports: ['mobile'] }),
    6_500,
  ),

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
  // WIP: the "Start New Match" confirm dialog (M5 S1-26), open (M5 S1-09).
  {
    ...stompState('match-summary-new-match-confirm', 'quiz-bowl-classic', 'proctor', 152),
    afterGoto: async (page: Page) => {
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Start a new match' }).click();
      await page.getByRole('dialog').waitFor({ state: 'visible' });
      await page.waitForTimeout(300); // let the Material dialog's own enter animation settle
    },
  },

  pending('guest-seat-vs-account-seat',
    'record-stomp.ts only recorded guest seats (joinByCode); no seat was joined via ' +
    'joinByCodeAuthenticated, so there is no authenticated-seat fixture to contrast against a guest one'),
  blankCanvasState('blank-canvas-before-first-emission'),
  // M5 S1-09: the same pre-emission canvas, left connecting past
  // `CONNECTING_ESCALATION_MS` (15s) — "Still connecting…", not the
  // first-15s "Connecting to the game…" copy.
  withEscalatedClock(blankCanvasState('canvas-connecting-escalated')),

  // --- /game-session lobby: REST-only, no STOMP (M5 S1-09) ---
  gameSessionState('game-session-landing', {
    afterGoto: async () => {}, // the default hero, already rendered by the time setupMocks/goto settle
  }),
  gameSessionState('game-session-join-error-not-found', {
    routes: [{
      method: 'POST', template: '/api/v1/session/join-game-session-by-code',
      handler: () => apiError(404, 'GAME_DOES_NOT_EXIST', 'No game with that join code exists.'),
    }],
    afterGoto: async page => {
      await page.getByText('Join with a code', { exact: true }).click();
      await page.getByLabel('Join code').fill('ZZZZZZ');
      await page.getByLabel('Your name').fill('Ada');
      await page.getByRole('button', { name: 'Join', exact: true }).click();
      await page.getByText('No game with that code. Check it with your host.').waitFor({ state: 'visible' });
    },
  }),
  gameSessionState('game-session-join-error-full', {
    routes: [{
      method: 'POST', template: '/api/v1/session/join-game-session-by-code',
      handler: () => apiError(409, 'SESSION_FULL', 'That game session is full.'),
    }],
    afterGoto: async page => {
      await page.getByText('Join with a code', { exact: true }).click();
      await page.getByLabel('Join code').fill('FULL01');
      await page.getByLabel('Your name').fill('Ada');
      await page.getByRole('button', { name: 'Join', exact: true }).click();
      await page.getByText('That room is full.').waitFor({ state: 'visible' });
    },
  }),
  // Client-side validation, no REST call reaches the mock at all: an empty
  // join code is caught inline before `submitJoinGame` ever calls the API.
  gameSessionState('game-session-join-error-blank-code', {
    afterGoto: async page => {
      await page.getByText('Join with a code', { exact: true }).click();
      await page.getByRole('button', { name: 'Join', exact: true }).click();
      await page.getByText('Enter a join code.').waitFor({ state: 'visible' });
    },
  }),
  // M4-UI-01/M5 S1-05: a 429 `rate_limited` body the real `RequestGuardFilter`
  // would send for the `session-create` policy — `RateLimitInterceptor`
  // (a real, unmocked app service) reacts to it exactly as it would to a
  // live backend's response, driving `sessionCreateLocked`'s cooldown hint.
  gameSessionState('game-session-create-rate-limited', {
    routes: [{
      method: 'POST', template: '/api/v1/session/create-new-game-session',
      handler: () => ({ status: 429, body: { error: 'rate_limited', policy: 'session-create', retryAfterSeconds: 20 } }),
    }],
    afterGoto: async page => {
      await page.getByText('New game', { exact: true }).click();
      await page.getByText('Auto-judged match', { exact: true }).click();
      await page.locator('.cooldown-hint').waitFor({ state: 'visible' });
    },
  }),
];

const s1: SurfaceScenario = { id: 'S1', title: 'Game session and buzzer', tag: 's1', port: 4201, states };
export default s1;
