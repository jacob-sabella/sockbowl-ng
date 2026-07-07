import { test, expect } from '@playwright/test';

// A live auto-judged match with two players: the host creates the room, a second
// player joins by code, both take a team, the host sets a packet and starts, then
// the tossup reads, someone buzzes, and the typed answer is auto-judged.
test('Auto-judged match: two players buzz and answer', async ({ page, browser }) => {
  // Host creates the auto-judged room (this page is the recorded one)
  await page.goto('/game-session');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Auto-judged match/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  const code = (await page.locator('.code-value').innerText()).trim();
  await page.locator('.team__actions button').first().click(); // host joins a team

  // Second player joins by code in a separate (non-recorded) context
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto('/game-session');
  await guest.getByRole('button', { name: /Join with a code/ }).click();
  await guest.getByLabel('Join Code').fill(code);
  await guest.getByLabel('Name').fill('Robin');
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await guest.waitForURL('**/game;**', { timeout: 25_000 });
  await guest.locator('.team__actions button').last().click(); // guest takes the other team

  // Host sets a packet from the bank
  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await dialog.getByRole('tab', { name: 'Generate', exact: true }).click();
  await expect(dialog.getByText(/tossups/).first()).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: /Generate & use/ }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Host starts the match; the auto-judged play surface reads the tossup
  await page.getByRole('button', { name: /Start Match/ }).click();
  await expect(page.locator('.ap__reading')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);

  // Host buzzes and answers
  await page.locator('.ap__buzz').click();
  const input = page.locator('.ap__input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill('the answer');
  await page.waitForTimeout(500);
  await page.locator('.ap__submit').click();
  await page.waitForTimeout(2800);

  await guestCtx.close();
});
