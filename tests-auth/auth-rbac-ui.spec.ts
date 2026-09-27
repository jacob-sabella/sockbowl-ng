import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

// RBAC-gated navigation and routes, against the real demo tiers from
// sockbowl-docker's keycloak/rbac-model.json:
//   player2   -> player     (packet:read, game:host)
//   moderator -> moderator  (+ user:ban)
//   player1   -> admin      (author + moderator + admin:access + packet:manage-any)
//   testuser  -> author     (+ packet:create/update/delete, question:generate)
//
// Note on the packet-search "Generate" tab (bank random packet): it is
// deliberately NOT permission-gated (D15 amends the D3-era plan text this
// spec's description was written against). Guests and players keep it so
// `import-random` keeps working for them as an EPHEMERAL, game-only packet;
// only the "Generate with AI" tab is gated, on `question:generate`. This spec
// checks that tab instead of a non-existent gate on the bank tab.

// The exact text permissionGuard's snackbar shows a signed-in user who lacks
// the permission (permission.guard.ts's PERMISSION_DENIED_MESSAGE). Kept as a
// literal here rather than imported: that module pulls in AuthService and its
// Angular DI chain, which isn't meant to load outside the Angular platform.
const PERMISSION_DENIED_MESSAGE = "You don't have permission to view that page.";

test.describe('RBAC-gated navigation and routes', () => {
  test('player (player2): no Packets/Moderation/Admin links; protected routes redirect with a snackbar; no AI-generate tab', async ({ page }) => {
    await loginAs(page, 'player2');

    await expect(page.locator('button[aria-label="Packet Builder"]')).toBeHidden();
    await expect(page.locator('button[aria-label="Moderation"]')).toBeHidden();
    await expect(page.locator('button[aria-label="Admin"]')).toBeHidden();

    // /packets/:id/edit (packet:update): the guard shows the snackbar and
    // redirects. Each route below is gated by its own permissionGuard()
    // instance (a distinct closure per route in app-routing.module.ts), so
    // checking the snackbar on every iteration doesn't stack multiple
    // dismissible snackbars from the *same* guard — permissionGuard dedupes
    // that case on its own (NG-R2-01) — and gives every denied route an
    // actual denial signal instead of just a URL check that a router default
    // could satisfy by accident (NG-R2-05).
    for (const path of ['/packets/00000000-0000-0000-0000-000000000000/edit', '/packets', '/admin', '/admin/bans']) {
      await page.goto(path);
      await expect(page.locator('.mat-mdc-snack-bar-label')).toHaveText(PERMISSION_DENIED_MESSAGE, { timeout: 5_000 });
      await page.waitForURL('**/game-session**', { timeout: 10_000 });
    }

    await page.getByRole('button', { name: /New game/ }).click();
    await page.getByRole('button', { name: /Auto-judged match/ }).click();
    await page.waitForURL('**/game;**', { timeout: 25_000 });
    await page.getByRole('button', { name: /Find a Packet/ }).click();
    const dialog = page.locator('.packet-search-dialog');
    await expect(dialog.getByRole('tab', { name: 'Search Existing' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Generate', exact: true })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Generate with AI' })).toBeHidden();
  });

  test('moderator: Moderation visible and reachable; /admin still redirects', async ({ page }) => {
    await loginAs(page, 'moderator');

    await expect(page.locator('button[aria-label="Moderation"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Admin"]')).toBeHidden();
    await expect(page.locator('button[aria-label="Packet Builder"]')).toBeHidden();

    await page.goto('/admin/bans');
    await expect(page).toHaveURL(/\/admin\/bans/);
    await expect(page.locator('.admin-bans')).toBeVisible();

    await page.goto('/admin');
    await expect(page.locator('.mat-mdc-snack-bar-label')).toHaveText(PERMISSION_DENIED_MESSAGE, { timeout: 5_000 });
    await page.waitForURL('**/game-session**', { timeout: 10_000 });
  });

  test('admin (player1): every gated link visible and every gated route reachable', async ({ page }) => {
    await loginAs(page, 'player1');

    await expect(page.locator('button[aria-label="Packet Builder"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Moderation"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Admin"]')).toBeVisible();

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator('.admin-home')).toBeVisible();

    await page.goto('/admin/bans');
    await expect(page).toHaveURL(/\/admin\/bans/);

    await page.goto('/packets');
    await expect(page).toHaveURL(/\/packets$/);
    await expect(page.locator('.packet-list')).toBeVisible();
  });

  test('author (testuser): Packets and New Packet visible; Moderation and Admin hidden', async ({ page }) => {
    await loginAs(page, 'testuser');

    await expect(page.locator('button[aria-label="Packet Builder"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Moderation"]')).toBeHidden();
    await expect(page.locator('button[aria-label="Admin"]')).toBeHidden();

    await page.goto('/packets');
    await expect(page).toHaveURL(/\/packets$/);
    await expect(page.getByRole('button', { name: /New Packet/ })).toBeVisible();
  });

  test('anonymous: every permission-gated route redirects straight to the Keycloak login page', async ({ page }) => {
    // permissionGuard's other branch (not the signed-in-but-lacking-the-role
    // one covered above): an anonymous visitor gets no snackbar, just
    // auth.login(state.url) — a full navigation to the hosted login page,
    // with this route as the post-login return target.
    for (const path of [
      '/packets',
      '/packets/00000000-0000-0000-0000-000000000000/edit',
      '/admin',
      '/admin/bans',
    ]) {
      await page.goto(path);
      await page.waitForURL('**/realms/sockbowl/protocol/openid-connect/auth**', { timeout: 10_000 });
    }
  });
});
