import { test, expect } from '@playwright/test';

// The Find-a-Packet dialog's Search Existing tab: search saved packets by name.
test('Search existing packets by name', async ({ page }) => {
  await page.goto('/game-session');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Auto-judged match/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await expect(dialog).toBeVisible();
  const search = dialog.locator('.search-field input');
  await search.click();
  await search.fill('2023');
  await page.waitForTimeout(2200);
});
