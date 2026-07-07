import { test, expect } from '@playwright/test';

// The Find-or-Generate packet dialog, generating from the local question bank
// with the live "how many match" counts and per-category chip counts.
test('Generate a packet from the bank with live filters', async ({ page }) => {
  await page.goto('/game-session');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Auto-judged match/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('tab', { name: 'Generate', exact: true }).click();
  // the live breadth preview shows how many bank questions match the filters
  await expect(dialog.getByText(/tossups/).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1400);

  // narrow to a category (chips show per-category counts); the preview updates
  await dialog.getByRole('button', { name: /Science/ }).first().click();
  await page.waitForTimeout(1600);

  // generate the packet from the bank and confirm it is set on the game
  await dialog.getByRole('button', { name: /Generate & use/ }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.waitForTimeout(1600);
});
