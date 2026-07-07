import { test, expect } from '@playwright/test';

// Solo practice end to end: generate a packet from the bank, start the match, watch
// the tossup read word by word, buzz, type an answer, and see it judged.
test('Solo practice reads a tossup, buzz and answer', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });
  await page.goto('/game-session');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Solo practice/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  // set a packet from the bank
  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Generate', exact: true }).click();
  await expect(dialog.getByText(/tossups/).first()).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: /Generate & use/ }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // start the match -> the solo reader takes over
  await page.getByRole('button', { name: /Start Match/ }).click();
  const reader = page.locator('.game-proctor .question-section');
  await expect(reader).toBeVisible({ timeout: 20_000 });

  // let a few words reveal, then buzz
  await page.waitForTimeout(2500);
  await page.locator('.buzz-btn').click();

  // type an answer and submit
  const input = page.locator('.answer-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill('the answer');
  await page.waitForTimeout(600);
  await page.locator('.answer-form button[type="submit"]').click();

  // verdict + revealed answer
  await expect(page.locator('.answer-section')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1800);
});
