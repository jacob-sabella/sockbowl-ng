import { test, expect, type Browser, type Page } from '@playwright/test';
import { loginAs } from './helpers/login';
import { seedBankFixture } from './helpers/bank';

// D15 with AUTH_ENABLED=true (NG-R3-01): a guest and a player-tier account
// (no packet:create) can still use the "Generate" tab. import-random gives
// them an EPHEMERAL packet that only the game service may read, so the dialog
// must close with the metadata import-random returned instead of re-reading
// it through getPacketById (which is null for them). The game server loads
// the packet with its service token and the match starts and plays.
//
// Also checks the WP-FIXG5 wire contract from the joining non-proctor's side:
// it sees the packet's name and bonus count but never the packet id, in the
// UI or in any STOMP frame it receives.
//
// Needs a seeded question bank: set SOCKBOWL_E2E_NEO4J_PASSWORD (or
// NEO4J_PASSWORD, plus SOCKBOWL_E2E_NEO4J_URL if Neo4j's HTTP port isn't
// http://localhost:7474) and the spec seeds a small tagged fixture itself;
// otherwise seed the bank before running.

const PLAYER = process.env.E2E_PLAYER || 'player2';
const TOSSUPS = 2;
const BONUSES = 2;

type GeneratedPacket = { id: string; name: string; tossupCount?: number; bonusCount?: number };

test.beforeAll(async () => {
  await seedBankFixture();
});

async function disableTts(page: Page): Promise<void> {
  await page.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });
}

/** Records the text of every STOMP frame the page receives. */
function recordFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on('websocket', ws => {
    ws.on('framereceived', f => frames.push(typeof f.payload === 'string' ? f.payload : f.payload.toString('utf8')));
  });
  return frames;
}

async function hostAutoJudgedGame(page: Page): Promise<string> {
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Auto-judged match/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });
  const code = (await page.locator('.code-value').innerText()).trim();
  await page.locator('.team__actions button').first().click();
  return code;
}

async function joinByCode(page: Page, code: string, guestName?: string): Promise<void> {
  await page.goto('/game-session');
  await page.getByRole('button', { name: /Join with a code/ }).click();
  await page.getByLabel('Join Code').fill(code);
  if (guestName) {
    await page.getByLabel('Name').fill(guestName);
  }
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });
  await page.locator('.team__actions button').last().click();
}

/** Uses the Generate tab and returns import-random's response body. */
async function generatePacket(page: Page): Promise<GeneratedPacket> {
  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Generate', exact: true }).click();
  await expect(dialog.getByText(/tossups/).first()).toBeVisible({ timeout: 20_000 });
  const nums = dialog.locator('.qb-num-field input');
  await nums.nth(0).fill(String(TOSSUPS));
  await nums.nth(1).fill(String(BONUSES));
  await page.waitForTimeout(600);

  const importResponse = page.waitForResponse(r =>
    r.url().includes('/api/qbreader/import-random') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: /Generate & use/ }).click();
  const response = await importResponse;
  expect(response.status(), 'import-random failed: is the question bank seeded?').toBe(200);
  const body = await response.json() as GeneratedPacket;
  expect(body.id).toBeTruthy();
  // WP-FIXQ5: answer-free counts, so the client never has to read the packet.
  expect(body.tossupCount).toBe(TOSSUPS);
  expect(body.bonusCount).toBe(BONUSES);
  expect(JSON.stringify(body)).not.toMatch(/Generated answer|Part answer/);

  // The regression: the dialog used to re-read the packet, get null and stay
  // open with "Could not build a packet".
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(/Could not build a packet/)).toHaveCount(0);
  return body;
}

/** The packet really is EPHEMERAL: an anonymous questions read gets nothing. */
async function expectUnreadableFromQuestions(page: Page, packetId: string): Promise<void> {
  const graphqlUrl = await page.evaluate(() => ((window as any).__env?.sockbowlQuestionsApiUrl || 'http://localhost:7009/') + 'graphql');
  const res = await page.request.post(graphqlUrl, {
    data: { query: 'query($id: ID!){ getPacketById(id: $id){ id name } }', variables: { id: packetId } },
  });
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json.data?.getPacketById ?? null).toBeNull();
}

/** The joining non-proctor sees name and bonus count, never the id. */
async function expectNonProctorPacketView(page: Page, frames: string[], packet: GeneratedPacket): Promise<void> {
  await expect(page.locator('.kv__row', { hasText: 'Name:' })).toContainText(packet.name, { timeout: 15_000 });
  await expect(page.getByText(new RegExp(`contains\\s+${BONUSES}\\s+bonus questions`))).toBeVisible();
  await expect(page.getByText('Packet ID:')).toHaveCount(0);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.filter(f => f.includes(packet.id)), 'a non-proctor frame carried the packet id').toEqual([]);
}

/** Starts the match and plays the first tossup (both teams answer wrong). */
async function startAndPlayFirstTossup(host: Page, joiner: Page): Promise<void> {
  const start = host.getByRole('button', { name: /Start Match/ });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(host.locator('.game-proctor .question-section')).toBeVisible({ timeout: 20_000 });

  await host.waitForTimeout(1200);
  await host.locator('.buzz-btn').click();
  const hostInput = host.locator('.answer-input');
  await expect(hostInput).toBeVisible({ timeout: 10_000 });
  await hostInput.fill('not the answer');
  await host.waitForTimeout(500);
  await host.locator('.answer-form button[type="submit"]').click();

  const joinerBuzz = joiner.locator('.buzz-btn');
  await expect(joinerBuzz).toBeEnabled({ timeout: 10_000 });
  await joinerBuzz.click();
  const joinerInput = joiner.locator('.answer-input');
  await expect(joinerInput).toBeVisible({ timeout: 10_000 });
  await joinerInput.fill('not the answer');
  await joiner.waitForTimeout(500);
  await joiner.locator('.answer-form button[type="submit"]').click();

  // The round completed on the game server, which read the EPHEMERAL packet.
  await expect(host.locator('.advance-bar')).toBeVisible({ timeout: 15_000 });
}

async function newPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await disableTts(page);
  return { page, close: () => ctx.close() };
}

test('A guest generates a bank packet, a signed-in player joins, and the match starts', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await disableTts(page);

  await page.goto('/game-session');
  await expect(page.getByText('Playing as Guest')).toBeVisible();
  const code = await hostAutoJudgedGame(page);

  const player = await newPage(browser);
  const playerFrames = recordFrames(player.page);
  await loginAs(player.page, PLAYER);
  await joinByCode(player.page, code);

  const packet = await generatePacket(page);
  await expectUnreadableFromQuestions(page, packet.id);
  // The owner of a proctorless game is the one sent the id.
  await expect(page.locator('.kv__row', { hasText: 'Name:' })).toContainText(packet.name);
  await expect(page.getByText(new RegExp(`contains\\s+${BONUSES}\\s+bonus questions`))).toBeVisible();

  await expectNonProctorPacketView(player.page, playerFrames, packet);
  await startAndPlayFirstTossup(page, player.page);
  expect(playerFrames.filter(f => f.includes(packet.id))).toEqual([]);

  await player.close();
});

test('A player-tier account generates a bank packet, a guest joins, and the match starts', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await disableTts(page);

  await loginAs(page, PLAYER);
  const code = await hostAutoJudgedGame(page);

  const guest = await newPage(browser);
  const guestFrames = recordFrames(guest.page);
  await joinByCode(guest.page, code, 'Generate Guest');

  const packet = await generatePacket(page);
  await expectUnreadableFromQuestions(page, packet.id);

  await expectNonProctorPacketView(guest.page, guestFrames, packet);
  await startAndPlayFirstTossup(page, guest.page);
  expect(guestFrames.filter(f => f.includes(packet.id))).toEqual([]);

  await guest.close();
});
