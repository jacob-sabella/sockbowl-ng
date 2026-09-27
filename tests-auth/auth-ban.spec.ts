import { test, expect } from '@playwright/test';
import { loginAs, getApiBaseUrl, getKeycloakId } from './helpers/login';

const MODERATOR = process.env.E2E_MODERATOR || 'moderator';
// An isolated demo account for the ban target. Deliberately not player2,
// testuser or player1: auth-login-play.spec.ts and auth-rbac-ui.spec.ts rely
// on those staying unbanned, and this suite's specs otherwise run
// independently of each other's ordering.
const TARGET = process.env.E2E_BAN_TARGET || 'player3';

// Note on "returned to the lobby": GameSessionInjectionResolver re-checks
// bans on every message for an already-connected player, but (per its own
// doc comment) that rejection is deliberately non-fatal — it reports on
// `/user/queue/errors` and the socket stays open, unlike a CONNECT-time
// rejection (which is fatal and does navigate away). So this spec asserts
// the banner the banned player sees on their next in-game action, then
// separately drives them back to the lobby to prove hosting is now refused
// too, rather than asserting an automatic navigation that this design does
// not perform for an already-open connection.
test('A moderator bans a player mid-lobby; the ban is enforced and then lifted', async ({ page, browser }) => {
  test.setTimeout(90_000);

  const targetCtx = await browser.newContext();
  const targetPage = await targetCtx.newPage();
  await targetPage.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });

  await loginAs(targetPage, TARGET);
  await targetPage.getByRole('button', { name: /New game/ }).click();
  await targetPage.getByRole('button', { name: /Auto-judged match/ }).click();
  await targetPage.waitForURL('**/game;**', { timeout: 25_000 });

  const apiBaseUrl = await getApiBaseUrl(targetPage);
  const targetSub = await getKeycloakId(targetPage, apiBaseUrl);

  await loginAs(page, MODERATOR);
  await page.goto('/admin/bans');

  let banned = false;
  try {
    await page.getByLabel('Keycloak user ID (sub)').fill(targetSub);
    await page.getByLabel('Reason').fill('e2e ban test (auth-ban.spec.ts)');
    await page.getByRole('button', { name: 'Ban user' }).click();

    const banRow = page.locator('.admin-bans__item', { hasText: targetSub });
    await expect(banRow).toBeVisible({ timeout: 10_000 });
    banned = true;

    // The banned player's next STOMP action surfaces the ban.
    await targetPage.locator('.team__actions button').first().click();
    await expect(targetPage.locator('[data-testid="stomp-error-banner"]'))
      .toContainText(/banned/i, { timeout: 5_000 });

    // Back at the lobby, hosting is now refused over REST (403) with a snackbar.
    await targetPage.goto('/game-session');
    await targetPage.getByRole('button', { name: /New game/ }).click();
    await targetPage.getByRole('button', { name: /Auto-judged match/ }).click();
    await expect(targetPage.getByText(/not allowed|banned/i)).toBeVisible({ timeout: 10_000 });
  } finally {
    if (banned) {
      const banRow = page.locator('.admin-bans__item', { hasText: targetSub });
      if (await banRow.isVisible().catch(() => false)) {
        await banRow.getByRole('button', { name: 'Remove ban' }).click();
        await expect(banRow).toBeHidden({ timeout: 10_000 });
      }
    }
  }

  await targetCtx.close();
});
