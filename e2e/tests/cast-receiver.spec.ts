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
