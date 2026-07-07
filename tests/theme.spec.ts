import { test, expect } from '@playwright/test';

// The theme selector in the navbar: switch between the built-in themes.
test('Theme selector switches the app theme', async ({ page }) => {
  await page.goto('/game-session');
  await page.waitForTimeout(900);
  for (const name of ['Light', 'Monokai', 'Nord', 'Dark']) {
    await page.getByRole('button', { name: 'Theme selector' }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await page.waitForTimeout(1100);
  }
});
