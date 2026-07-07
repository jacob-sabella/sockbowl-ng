import { test, expect } from '@playwright/test';

// The lobby: the first thing a player sees. No backend needed.
test.beforeEach(async ({ page }) => {
  await page.goto('/game-session');
});

test('the lobby offers New game and Join with a code', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Sockbowl' })).toBeVisible();
  await expect(page.getByRole('button', { name: /New game/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Join with a code/ })).toBeVisible();
  await page.waitForTimeout(1400);
});

test('New game reveals the three match modes', async ({ page }) => {
  await page.getByRole('button', { name: /New game/ }).click();
  await expect(page.getByRole('button', { name: /Solo practice/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Auto-judged match/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Proctored match/ })).toBeVisible();
  await page.waitForTimeout(1400);
});

test('Join with a code opens the join form', async ({ page }) => {
  await page.getByRole('button', { name: /Join with a code/ }).click();
  await expect(page.locator('input').first()).toBeVisible();
  await page.locator('input').first().fill('ABC123');
  await page.waitForTimeout(1200);
});
