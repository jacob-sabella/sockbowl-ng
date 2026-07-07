import { test, expect } from '@playwright/test';

// The bank Generate tab's filters: category chips (each showing how many bank
// questions it holds), the live match-count preview, and clearing filters.
test('Generate tab: category filters and live counts', async ({ page }) => {
  await page.goto('/game-session');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Auto-judged match/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await dialog.getByRole('tab', { name: 'Generate', exact: true }).click();
  await expect(dialog.getByText(/tossups/).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);

  // narrow to two categories; the match-count preview updates as they toggle
  await dialog.getByRole('button', { name: /History/ }).first().click();
  await page.waitForTimeout(1200);
  await dialog.getByRole('button', { name: /Science/ }).first().click();
  await page.waitForTimeout(1400);

  // clear all filters
  await dialog.getByRole('button', { name: /Clear filters/ }).click();
  await page.waitForTimeout(1400);
});
