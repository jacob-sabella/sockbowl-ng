import { test, expect } from '@playwright/test';

// The spectator view: two players run an auto-judged match while a third person
// watches. The recorded page is the spectator, so the clip shows the watch view.
test('Spectating a live auto-judged match', async ({ page, browser }) => {
  // Host creates the room in a side context and reads the join code
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto('/game-session');
  await host.getByRole('button', { name: /New game/ }).click();
  await host.getByRole('button', { name: /Auto-judged match/ }).click();
  await host.waitForURL('**/game;**', { timeout: 25_000 });
  const code = (await host.locator('.code-value').innerText()).trim();
  await host.locator('.team__actions button').first().click();

  // A player joins and takes the other team (side context)
  const playerCtx = await browser.newContext();
  const player = await playerCtx.newPage();
  await player.goto('/game-session');
  await player.getByRole('button', { name: /Join with a code/ }).click();
  await player.getByLabel('Join Code').fill(code);
  await player.getByLabel('Name').fill('Robin');
  await player.getByRole('button', { name: 'Join', exact: true }).click();
  await player.waitForURL('**/game;**', { timeout: 25_000 });
  await player.locator('.team__actions button').last().click();

  // The spectator (this recorded page) joins by code and switches to spectating
  await page.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });
  await page.goto('/game-session');
  await page.getByRole('button', { name: /Join with a code/ }).click();
  await page.getByLabel('Join Code').fill(code);
  await page.getByLabel('Name').fill('Sam');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });
  // not taking a team leaves this player as a spectator
  await page.waitForTimeout(800);

  // Host sets a packet and starts; the spectator watches the tossup read
  await host.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = host.locator('.packet-search-dialog');
  await dialog.getByRole('tab', { name: 'Generate', exact: true }).click();
  await expect(dialog.getByText(/tossups/).first()).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: /Generate & use/ }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await host.getByRole('button', { name: /Start Match/ }).click();

  await expect(page.locator('app-game-spectator')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3500);

  await hostCtx.close();
  await playerCtx.close();
});
