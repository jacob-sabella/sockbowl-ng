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
  await page.screenshot({ path: `${ART}/cast-01-config.png` });

  // --- active match ---
  await page.evaluate((s) => (window as any).__castRender(s), INGAME_STATE);
  await page.waitForTimeout(400);
  await expect(page.locator('#scoreboard')).toContainText('30');
  await expect(page.locator('#scoreboard')).toContainText('Team 1');
  await expect(page.locator('#match-view')).toContainText('Anxiety'); // question rendered
  await page.screenshot({ path: `${ART}/cast-02-ingame.png` });

  await ctx.close();
});
