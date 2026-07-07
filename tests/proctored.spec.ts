import { test, expect } from '@playwright/test';

// A classic proctored match: a human proctor reads the tossup and judges answers.
// The recorded page is the proctor, so the clip shows the proctor control surface.
test('Proctored match: read the tossup, buzz, and judge', async ({ page, browser }) => {
  // Proctor creates a classic (in-person proctor) match
  await page.goto('/game-session');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Proctored match/ }).click();
  await page.getByLabel('Your name').fill('Alex');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });
  await page.getByRole('button', { name: /Become Proctor/ }).click();
  const code = (await page.locator('.code-value').innerText()).trim();

  // A player joins and takes a team (side context)
  const playerCtx = await browser.newContext();
  const player = await playerCtx.newPage();
  await player.goto('/game-session');
  await player.getByRole('button', { name: /Join with a code/ }).click();
  await player.getByLabel('Join Code').fill(code);
  await player.getByLabel('Name').fill('Robin');
  await player.getByRole('button', { name: 'Join', exact: true }).click();
  await player.waitForURL('**/game;**', { timeout: 25_000 });
  await player.locator('.team__actions button').first().click();

  // A second player joins the other team so both sides are staffed
  const player2Ctx = await browser.newContext();
  const player2 = await player2Ctx.newPage();
  await player2.goto('/game-session');
  await player2.getByRole('button', { name: /Join with a code/ }).click();
  await player2.getByLabel('Join Code').fill(code);
  await player2.getByLabel('Name').fill('Jordan');
  await player2.getByRole('button', { name: 'Join', exact: true }).click();
  await player2.waitForURL('**/game;**', { timeout: 25_000 });
  await player2.locator('.team__actions button').last().click();

  // Proctor sets a packet and starts the match
  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await dialog.getByRole('tab', { name: 'Generate', exact: true }).click();
  await expect(dialog.getByText(/tossups/).first()).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: /Generate & use/ }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.getByRole('button', { name: /Start Match/ }).click();

  // Proctor reads, then signals finished reading
  await expect(page.locator('#finished-reading-btn')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  await page.locator('#finished-reading-btn').click();

  // Player buzzes in
  await player.locator('#buzz-button').click();

  // Proctor sees the buzz and marks the answer correct
  await expect(page.locator('#right-btn')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1400);
  await page.locator('#right-btn').click();
  await page.waitForTimeout(2500);

  await playerCtx.close();
  await player2Ctx.close();
});
