import { test, expect } from '@playwright/test';
import { loginAs, getApiBaseUrl, getKeycloakId } from './helpers/login';

const MODERATOR = process.env.E2E_MODERATOR || 'moderator';
// An isolated demo account for the ban target. Deliberately not player2,
// testuser or player1: auth-login-play.spec.ts and auth-rbac-ui.spec.ts rely
// on those staying unbanned, and this suite's specs otherwise run
// independently of each other's ordering.
const TARGET = process.env.E2E_BAN_TARGET || 'player3';

// Note on "returned to the lobby": the ban is enforced synchronously,
// server-side, the moment the moderator submits it — AdminBanController
// pushes BANNED straight to the target's already-open socket on
// `/user/queue/errors`, with no action needed on the target page to trigger
// it. The client treats a fatal code there like a fatal ERROR frame (plan
// m2-auth.md section 2.5): it stops reconnecting and the game canvas
// navigates back to /game-session on its own. (NG-R2-01: this used to click
// an in-game control first, expecting to trigger the check — by the time
// that click ran, the push had already fired and navigated the page away,
// so the click hit its own 90s timeout instead of doing anything.) The spec
// then reloads the lobby to prove hosting is now refused too.
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

    // The ban push is fatal and arrives on its own: the socket stops and the
    // page navigates back to the lobby with no action needed here.
    await targetPage.waitForURL('**/game-session**', { timeout: 10_000 });
    await expect(targetPage.getByText(/banned/i).first()).toBeVisible({ timeout: 5_000 });

    // Back at the lobby, hosting is now refused over REST (403) with a snackbar.
    await targetPage.goto('/game-session');
    await targetPage.getByRole('button', { name: /New game/ }).click();
    await targetPage.getByRole('button', { name: /Auto-judged match/ }).click();
    await expect(targetPage.getByText(/not allowed|banned/i)).toBeVisible({ timeout: 10_000 });
  } finally {
    if (banned) {
      const banRow = page.locator('.admin-bans__item', { hasText: targetSub });
      if (await banRow.isVisible().catch(() => false)) {
        // M5 S5-02: the icon button's accessible name now names the target
        // ("Remove ban on <sub>", not the bare "Remove ban"), and the click
        // only opens a confirmation dialog (ConfirmDialogService) rather
        // than removing the ban immediately.
        await banRow.getByRole('button', { name: /^Remove ban on/ }).click();
        const confirmDialog = page.locator('mat-dialog-container');
        await expect(confirmDialog).toBeVisible();
        await confirmDialog.getByRole('button', { name: 'Remove ban' }).click();
        await expect(banRow).toBeHidden({ timeout: 10_000 });
      }
    }
  }

  await targetCtx.close();
});
