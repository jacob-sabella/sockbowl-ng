import { test, expect } from '@playwright/test';
import { APP_URL } from '../harness/config.js';
import { mkdirSync } from 'node:fs';

const ART = 'artifacts';
mkdirSync(ART, { recursive: true });

/**
 * Cast receiver rendering — device-free integration test. The physical
 * Chromecast handshake can't be exercised without hardware, but everything up
 * to the Cast SDK boundary can: we load the real receiver page and drive it
 * with CastGameState messages (exactly what the sender emits), then assert the
 * board renders. This covers the "connects but shows nothing" failure class.
 */

const CONFIG_STATE = {
  messageType: 'GAME_STATE_UPDATE',
  timestamp: 1,
  theme: 'dark',
  isConfigStage: true,
  joinCode: 'ABCDEF',
  proctorName: 'Alex',
  packetName: '2021 SMH — Packet 1',
  gameMode: 'QUIZ_BOWL_CLASSIC',
  teamRosters: [
    { teamId: 't1', teamName: 'Team 1', playerNames: ['Ada', 'Cleo'] },
    { teamId: 't2', teamName: 'Team 2', playerNames: ['Blaise'] },
  ],
};

const INGAME_STATE = {
  messageType: 'GAME_STATE_UPDATE',
  timestamp: 2,
  isConfigStage: false,
  roundNumber: 5,
  totalTossups: 20,
  category: 'Literature',
  subcategory: 'American Literature',
  roundState: 'AWAITING_ANSWER',
  questionVisible: true,
  questionText: 'This author wrote that "If I were the Head of the Church or the State" in a poem; for 10 points, name this poet of <b>The Age of Anxiety</b>.',
  answerVisible: false,
  answerText: '',
  currentBuzz: { playerName: 'Ada', teamName: 'Team 1' },
  teamScores: [
    { teamName: 'Team 1', score: 30 },
    { teamName: 'Team 2', score: 15 },
  ],
};

test('cast receiver renders config + in-game states', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/cast-receiver.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__castRender === 'function');

  // --- config stage ---
  await page.evaluate((s) => (window as any).__castRender(s), CONFIG_STATE);
  await page.waitForTimeout(400);
  await expect(page.locator('#config-view')).toContainText('ABCDEF');
  await expect(page.locator('#config-teams')).toContainText('Ada');
  await expect(page.locator('#config-teams')).toContainText('Blaise');
  // M5 S2-17: the TV shows a readable mode name, not the wire enum value.
  await expect(page.locator('#config-game-mode')).toHaveText('Classic');
  await page.screenshot({ path: `${ART}/cast-01-config.png` });

  // --- active match ---
  await page.evaluate((s) => (window as any).__castRender(s), INGAME_STATE);
  await page.waitForTimeout(400);
  await expect(page.locator('#scoreboard')).toContainText('30');
  await expect(page.locator('#scoreboard')).toContainText('Team 1');
  await expect(page.locator('#match-view')).toContainText('Anxiety'); // question rendered
  // M5 S2-17: category/subcategory join with a middle dot, not a hyphen.
  await expect(page.locator('#category-info')).toHaveText('Literature · American Literature');
  // M5 S2-32: the same words as the proctor's own header, not "Round N".
  await expect(page.locator('#round-info')).toHaveText('Tossup 5 of 20');
  await page.screenshot({ path: `${ART}/cast-02-ingame.png` });

  await ctx.close();
});

// M5 S2-32: some modes never send a packet tossup count (backend follow-up
// recorded). The receiver still says "Tossup N", never the bare "Round N".
test('cast receiver falls back to "Tossup N" when no total is known', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/cast-receiver.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__castRender === 'function');

  await page.evaluate((s) => (window as any).__castRender(s), { ...INGAME_STATE, totalTossups: null });
  await page.waitForTimeout(200);
  await expect(page.locator('#round-info')).toHaveText('Tossup 5');

  await ctx.close();
});

// M5 S2-01: player and team names are player-chosen text, not markup, and
// must render as literal text rather than being interpreted as HTML.
test('cast receiver escapes player and team names in the buzz indicator', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/cast-receiver.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__castRender === 'function');

  await page.evaluate((s) => (window as any).__castRender(s), {
    ...INGAME_STATE,
    currentBuzz: { playerName: '<b>Evil</b>', teamName: 'Team < 1' },
  });
  await page.waitForTimeout(400);

  const buzzStatus = page.locator('#buzz-status');
  // No <b> element was created from the name — it renders as literal text.
  await expect(buzzStatus.locator('b')).toHaveCount(0);
  await expect(buzzStatus).toContainText('<b>Evil</b>');
  await expect(buzzStatus).toContainText('Team < 1');
  await page.screenshot({ path: `${ART}/cast-03-buzz-escaped.png` });

  await ctx.close();
});

// M5 S2-08: the connection-status toast reports connecting/connected/
// disconnected honestly, at the edge, and never covers the board.
test('cast receiver connection status toast', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/cast-receiver.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__castRender === 'function');

  // A real Cast receiver context starts in "Connecting…" (this test harness
  // has no Presentation API, so it's driven directly via the test hook —
  // the same hook the polish capture harness uses for baseline shots).
  await page.evaluate(() => (window as any).__castSetConnectionStatus('connecting'));
  await expect(page.locator('#status')).toContainText('Connecting');
  await expect(page.locator('#status')).toBeVisible();

  // A rendered frame clears the toast — the board itself is now the truth.
  await page.evaluate((s) => (window as any).__castRender(s), CONFIG_STATE);
  await page.waitForTimeout(200);
  await expect(page.locator('#status')).toBeHidden();

  // A disconnect is reported honestly, without dimming the board.
  await page.evaluate(() => (window as any).__castSetConnectionStatus('disconnected'));
  await page.waitForTimeout(200);
  await expect(page.locator('#status')).toContainText('Waiting for the proctor to reconnect');
  await expect(page.locator('#config-view')).toBeVisible();
  const appOpacity = await page.locator('#app').evaluate((el) => getComputedStyle(el).opacity);
  expect(appOpacity).toBe('1');
  await page.screenshot({ path: `${ART}/cast-04-status-disconnected.png` });

  await ctx.close();
});

// The board must mirror whatever skin the viewer picked (body.theme-<name>).
test('cast receiver mirrors the selected skin', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/cast-receiver.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__castRender === 'function');
  await page.addStyleTag({ content: '.error-overlay,#error,[class*="error"]{display:none!important}' });

  for (const theme of ['dracula', 'light', 'nord']) {
    await page.evaluate((s) => (window as any).__castRender(s), { ...INGAME_STATE, theme });
    await page.waitForTimeout(300);
    const cls = await page.evaluate(() => document.body.className);
    expect(cls).toContain(`theme-${theme}`);
    await page.screenshot({ path: `${ART}/cast-theme-${theme}.png` });
  }
  await ctx.close();
});

// M5 S2-28: a question that never arrives must not read "Question loading…"
// forever — after a bounded wait the board admits it's still waiting on the
// proctor. Uses Playwright's virtual clock so the test doesn't sit on a real
// multi-second timeout.
test('cast receiver admits a question that never arrives after a bounded wait', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.clock.install();
  await page.goto(`${APP_URL}/cast-receiver.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__castRender === 'function');

  await page.evaluate((s) => (window as any).__castRender(s), {
    ...INGAME_STATE,
    questionText: '',
  });
  await expect(page.locator('#question-text')).toHaveText('Question loading…');

  // Still short of the bounded wait: still reads as loading.
  await page.clock.fastForward(7000);
  await expect(page.locator('#question-text')).toHaveText('Question loading…');

  // Past the bounded wait: admits the question never arrived.
  await page.clock.fastForward(2000);
  await expect(page.locator('#question-text')).toHaveText('Waiting for the proctor…');
  await page.screenshot({ path: `${ART}/cast-05-question-never-arrived.png` });

  // A real question landing (e.g. the next round) clears the waiting copy.
  await page.evaluate((s) => (window as any).__castRender(s), INGAME_STATE);
  await expect(page.locator('#question-text')).toContainText('Anxiety');

  await ctx.close();
});

// M5 S2-34: a 100+ character name must not push the buzz pill or the
// scoreboard wide enough to overflow the frame — it single-lines with an
// ellipsis (CSS), and the full name survives in `title`.
test('cast receiver clamps an extreme-length name in the buzz pill and scoreboard', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/cast-receiver.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__castRender === 'function');

  const longName = 'A'.repeat(120);
  await page.evaluate((s) => (window as any).__castRender(s), {
    ...INGAME_STATE,
    currentBuzz: { playerName: longName, teamName: longName },
    teamScores: [
      { teamName: longName, score: 30 },
      { teamName: 'Team 2', score: 15 },
    ],
  });
  await page.waitForTimeout(300);

  const playerNameEl = page.locator('.buzz-player-name');
  const teamNameEl = page.locator('#scoreboard .team-name').first();
  await expect(playerNameEl).toHaveAttribute('title', longName);
  await expect(teamNameEl).toHaveAttribute('title', longName);

  // Clamped rendered width stays well short of the full unclamped name, and
  // the frame itself never scrolls (S2-23's contract, still true here).
  const playerBox = await playerNameEl.boundingBox();
  expect(playerBox!.width).toBeLessThan(1280 * 0.4);
  const scrollHeight = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
  const innerHeight = await page.evaluate(() => window.innerHeight);
  expect(scrollHeight).toBeLessThanOrEqual(innerHeight);

  await page.screenshot({ path: `${ART}/cast-06-extreme-name.png` });
  await ctx.close();
});

// M5 S2-23: the board is a fixed 100vh frame at TV sizes — a long question,
// answer shown, an 8-team config/scoreboard and the plain config view must
// all fit inside it (viewport-only, never full-page) at both TV resolutions.
const LONG_QUESTION_STATE = {
  ...INGAME_STATE,
  category: 'History',
  subcategory: 'World History',
  questionText:
    'This ruler, whose reign saw the construction of an extensive network of royal roads and ' +
    'way-stations to speed communication across a territory stretching from the Indus Valley to ' +
    'the Aegean Sea, organized his domain into provinces called satrapies, each overseen by a ' +
    'governor who answered to roving inspectors known as the "eyes and ears of the king"; for 10 ' +
    'points, name this Achaemenid emperor, the son of Cambyses and successor of Cyrus the Great, ' +
    'who was defeated by a coalition of Greek city-states at the Battle of Marathon.',
};

// M5 FF6 (fix 1 + regression 2): the base (untiered) question class clips
// right alongside the long tier at 1080p (FV5 verdict) — the shorter
// `INGAME_STATE` question above stays under the wrap-boundary this needs to
// exercise, so this uses the same base-tier text the polish capture harness
// renders for `cast-ingame-<theme>` (e2e/polish/scenarios/s2.ts).
const BASE_QUESTION_STATE = {
  ...INGAME_STATE,
  questionText: 'This author wrote that “If I were the Head of the Church or the State, / ' +
    'I’d powder my nose and go to bed” in a poem; for 10 points, name this ' +
    'British-American poet of The Age of Anxiety.',
};

const ANSWER_SHOWN_STATE = {
  ...INGAME_STATE,
  roundState: 'COMPLETED',
  currentBuzz: { playerName: 'Ada', teamName: 'Team 1' },
  answerVisible: true,
  answerText: 'W. H. <b>Auden</b>',
};

const EIGHT_TEAM_SCORES = Array.from({ length: 8 }, (_, i) => ({
  teamId: `t${i + 1}`,
  teamName: `Team ${i + 1}`,
  score: 40 - i * 5,
}));

const EIGHT_TEAM_STATE = { ...INGAME_STATE, teamScores: EIGHT_TEAM_SCORES };

const EIGHT_TEAM_CONFIG_STATE = {
  ...CONFIG_STATE,
  teamRosters: Array.from({ length: 8 }, (_, i) => ({
    teamId: `t${i + 1}`,
    teamName: `Team ${i + 1}`,
    playerNames: ['Ada', 'Cleo', 'Ravi'],
  })),
};

const TV_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

const TV_FIT_STATES: Array<[string, unknown]> = [
  ['config', CONFIG_STATE],
  ['config-8-teams', EIGHT_TEAM_CONFIG_STATE],
  // M5 FF6 (fix 1 + regression 2): the base (untiered) question length clips
  // right alongside the long tier at 1080p — added so this sweep covers both
  // states the FV5 verdict named, not just the long one.
  ['base-question', BASE_QUESTION_STATE],
  ['long-question', LONG_QUESTION_STATE],
  ['answer-shown', ANSWER_SHOWN_STATE],
  ['8-teams', EIGHT_TEAM_STATE],
];

// M5 FF5 (regression 3): the page-scroll check above only proves the outer
// frame doesn't scroll — it can't see text clipped *inside* the question or
// answer card, which is exactly the failure the FF4 verdict found (the last
// line cut off at the card's own bottom edge while the page itself never
// scrolled). Checking the *card's* scrollHeight/clientHeight can't see it
// either: `#question-text`/`#answer-text` are flex items with `overflow:
// hidden` and no `flex-shrink: 0`, so per the flexbox spec their automatic
// minimum size is 0 — when the card doesn't have room, the flex algorithm
// shrinks the text element's own box to fit, absorbing all the "overflow"
// itself rather than growing the card's scrollable region. That also means
// a *bounding-rect* check of the text element against its card can't see it
// either: the shrunk box's own edges land flush with the card regardless of
// whether its content is clipping (confirmed directly by probing a clipped
// render: the text element's own `getBoundingClientRect().bottom` sat
// within half a pixel of the card's content-box edge while its
// `scrollHeight` exceeded `clientHeight` by dozens of pixels). So this
// checks `#question-text`/`#answer-text` directly: their content
// (`scrollHeight`, the height it actually needs) must fit within their own
// rendered box (`clientHeight`) — the same check the fit-to-row step in
// cast-receiver.js uses to decide whether to shrink.
//
// M5 FF6 (regression 3, still open after FF5): that check is sound only once
// the element has actually laid out against its *final* font metrics — the
// FF5 verdict found it passing 17/17 while the capture harness still showed
// the 1080p text cut off, because the capture path renders, waits 350ms,
// and *then* waits for fonts before it screenshots, so Newsreader (the
// reading face) can swap in and wrap differently after this check would
// otherwise have run. Waiting for fonts first, matching that path, is what
// makes the assertion see the same laid-out state the screenshot does.
async function waitForFontsReady(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    try {
      await (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready;
    } catch {
      // `document.fonts` isn't guaranteed everywhere; best-effort.
    }
  });
}

async function assertNoCardClipping(page: import('@playwright/test').Page) {
  await waitForFontsReady(page);
  const clipping = await page.evaluate(() => {
    const results: Array<{ id: string; scrollHeight: number; clientHeight: number }> = [];
    for (const [containerId, textId] of [
      ['question-container', 'question-text'],
      ['answer-container', 'answer-text'],
    ]) {
      const container = document.getElementById(containerId);
      const text = document.getElementById(textId);
      if (container && text && !container.classList.contains('hidden')) {
        results.push({ id: textId, scrollHeight: text.scrollHeight, clientHeight: text.clientHeight });
      }
    }
    return results;
  });
  for (const card of clipping) {
    expect(
      card.scrollHeight,
      `#${card.id} content (scrollHeight ${card.scrollHeight}px) is clipped by its own ` +
        `rendered height (clientHeight ${card.clientHeight}px) — a line is being cut off.`
    ).toBeLessThanOrEqual(card.clientHeight);
  }
}

for (const viewport of TV_VIEWPORTS) {
  for (const [name, state] of TV_FIT_STATES) {
    test(`cast receiver never overflows the ${viewport.width}x${viewport.height} frame (${name})`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      // M5 FF6: `networkidle`, not `domcontentloaded` — matching the polish
      // capture harness's own navigation for these non-loading cast states
      // (e2e/polish/capture.spec.ts). The chrome fonts (Inter/Space Grotesk,
      // used by the "Connecting…" toast on first paint) finish loading
      // during that wait, so the reading face's own load - triggered only
      // once `__castRender` sets question/answer text below - starts and
      // finishes on its own, after this navigation's wait is long over.
      // Under `domcontentloaded`, that chrome-font load can still be
      // in-flight when `__castRender` runs, and Newsreader's load rides
      // along on the same already-pending `document.fonts.ready`
      // (cast-receiver.js) - which hides exactly the timing gap this test
      // exists to catch.
      await page.goto(`${APP_URL}/cast-receiver.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof (window as any).__castRender === 'function');

      await page.evaluate((s) => (window as any).__castRender(s), state);
      await page.waitForTimeout(300);

      const scrollHeight = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
      const scrollWidth = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
      const innerHeight = await page.evaluate(() => window.innerHeight);
      const innerWidth = await page.evaluate(() => window.innerWidth);
      expect(scrollHeight).toBeLessThanOrEqual(innerHeight);
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

      // M5 FF5 (regression 3): the question/answer text itself must fit
      // inside its own card, not just the page inside the viewport.
      await assertNoCardClipping(page);

      await page.screenshot({ path: `${ART}/cast-fit-${viewport.width}x${viewport.height}-${name}.png` });
      await ctx.close();
    });
  }
}
