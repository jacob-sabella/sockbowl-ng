import { test, expect } from '@playwright/test';

// D1: auth is additive. With AUTH_ENABLED=true, an unauthenticated guest can
// still host and play. This uses Search Existing (an existing PUBLISHED
// packet) rather than the bank "Generate" tab, to exercise D2's anonymous
// read path specifically (PUBLISHED packets stay world-readable, answer-free
// where it matters); the Generate/EPHEMERAL guest path (D15) is covered,
// with auth on, by tests-auth/auth-generate.spec.ts.
test('An unauthenticated guest can host and play a solo game against a published packet', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });

  await page.goto('/game-session');
  await expect(page.getByText('Playing as Guest')).toBeVisible();

  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Solo practice/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await expect(dialog).toBeVisible();
  const search = dialog.locator('.search-field input');
  await search.click();
  await search.fill('2015 Prison Bowl');
  const result = dialog.locator('.result-item').first();
  await expect(result).toBeVisible({ timeout: 20_000 });
  await result.click();
  await dialog.getByRole('button', { name: 'Use Packet' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await page.getByRole('button', { name: /Start Match/ }).click();
  const reader = page.locator('.game-proctor .question-section');
  await expect(reader).toBeVisible({ timeout: 20_000 });

  await page.waitForTimeout(2500);
  await page.locator('.buzz-btn').click();

  const input = page.locator('.answer-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill('the answer');
  await page.waitForTimeout(600);
  await page.locator('.answer-form button[type="submit"]').click();

  await expect(page.locator('.proctor-status .status-dot--done')).toBeVisible({ timeout: 15_000 });
});
