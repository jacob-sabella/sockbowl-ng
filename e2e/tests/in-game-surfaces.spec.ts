import { test } from '@playwright/test';
import { createGame, joinByCode, importQbreaderPacket, type JoinResult } from '../harness/rest.js';
import { SockbowlBot, spawnBot } from '../harness/bot.js';
import { APP_URL } from '../harness/config.js';
import { mkdirSync } from 'node:fs';

const ART = 'artifacts';
mkdirSync(ART, { recursive: true });
const deepLink = (j: JoinResult) =>
  `${APP_URL}/game;gameSessionId=${j.gameSessionId};playerSecret=${j.playerSecret};playerSessionId=${j.playerSessionId}`;

// Stage a bot-run match with a real packet, drop a real browser player into it,
// and screenshot the redesigned in-game surfaces in genuine states.
test('capture buzzer + in-game surfaces', async ({ browser }) => {
  const game = await createGame();
  const packetId = await importQbreaderPacket('2021 SMH', 1);

  // Proctor + two teammate bots
  const pj = await joinByCode(game.joinCode, 'Proctor');
  const proctor = new SockbowlBot('Proctor', pj.gameSessionId, pj.playerSecret, pj.playerSessionId);
  await proctor.connect();
  await proctor.waitFor((g) => !!g.teamList?.length, 8000, 'teams');
  const teams = proctor.teams;

  const blaise = await spawnBot(joinByCode, game.joinCode, 'Blaise');
  const cleo = await spawnBot(joinByCode, game.joinCode, 'Cleo');
  blaise.joinTeam(teams[1].teamId);
  cleo.joinTeam(teams[1].teamId);

  // Browser player "Ada" — joins Team 1 through the real UI (the buzzer seat)
  const adaJoin = await joinByCode(game.joinCode, 'Ada');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(deepLink(adaJoin), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: /Join Team 1/i }).click();
  await page.waitForTimeout(1200);

  // Browser spectator "Val" — joins but stays off a team (the spectator surface)
  const valJoin = await joinByCode(game.joinCode, 'Val');
  const specCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const specPage = await specCtx.newPage();
  await specPage.goto(deepLink(valJoin), { waitUntil: 'domcontentloaded' });
  await specPage.waitForTimeout(3500);

  // Proctor takes the chair + sets the packet, then we start
  proctor.becomeProctor();
  proctor.setPacket(packetId);
  await proctor.waitFor(
    (g) => g.currentMatch?.packet?.id === packetId &&
      (g.teamList ?? []).reduce((n: number, t: any) => n + (t.teamPlayers?.length ?? 0), 0) >= 3,
    15000,
    'ready to start',
  );

  proctor.startMatch();
  await proctor.waitFor((g) => g.currentMatch?.matchState === 'IN_GAME', 12000, 'IN_GAME');
  if (proctor.roundState === 'PROCTOR_READING') proctor.finishedReading();
  await proctor.waitFor((g) => g.currentMatch?.currentRound?.roundState === 'AWAITING_BUZZ', 12000, 'AWAITING_BUZZ');

  // (1) Buzzer armed — the signature dome, ready to buzz
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${ART}/01-buzzer-armed.png` });

  // (2) Spectator view — the question set in the Newsreader reading serif
  await specPage.screenshot({ path: `${ART}/02-spectator-reading.png` });

  // (3) Ada slams the buzzer (real click in the browser)
  await page.locator('#buzz-button, .buzz-button').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${ART}/03-buzzer-buzzed.png` });

  await ctx.close();
  await specCtx.close();
  proctor.disconnect();
  blaise.disconnect();
  cleo.disconnect();
});
