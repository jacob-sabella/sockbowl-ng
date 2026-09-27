import { test, expect } from '@playwright/test';

// M1 integration e2e: log in as a demo Keycloak user (AUTH_ENABLED=true,
// CREATE_DEMO_ACCOUNTS=true) and play at least one tossup solo. Proves the
// full authenticated flow — navbar Sign In -> Keycloak hosted login page ->
// redirect back authenticated -> solo practice game -> buzz -> answer -> verdict.
test('Demo user logs in via Keycloak and plays a solo tossup', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });
  await page.goto('/game-session');

  // Guest by default; sign in with a demo account
  await expect(page.getByText('Playing as Guest')).toBeVisible();
  await page.getByRole('button', { name: /Sign In/ }).click();

  // Keycloak's hosted login page (authorization code flow redirect)
  await page.waitForURL('**/realms/sockbowl/protocol/openid-connect/auth**', { timeout: 20_000 });
  await page.locator('#username').fill('player2');
  await page.locator('#password').fill('demo123');
  await page.locator('#kc-login').click();

  // Back on the app, authenticated as the demo player
  await page.waitForURL('**/game-session**', { timeout: 20_000 });
  await expect(page.getByText('Playing as Guest')).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('.navbar__user-name')).toBeVisible({ timeout: 10_000 });

  // Solo practice end to end, same flow as the guest solo spec
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Solo practice/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  // Use the imported packet bank (Search Existing) rather than the qbreader
  // "Generate" tab, which draws from a separate, unseeded bank in this stack.
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

  await expect(page.locator('.answer-section')).toBeVisible({ timeout: 15_000 });
});
