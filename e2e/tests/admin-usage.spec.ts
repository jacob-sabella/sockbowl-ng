import { test, expect, type Page } from '@playwright/test';
import { loginAs } from '../../tests-auth/helpers/login.js';

// M4 plan WP-E1: live proof of the admin usage/quota view (M4-AD-02) against
// a real stack. Two signed-in browser contexts play the two roles the plan's
// acceptance criteria need:
//
//   - player1 (admin, per M2's demo users / D9): the admin at /admin/usage
//     and /admin/bans.
//   - player2 (player): the ordinary account whose hosted-sessions quota and
//     IP the admin acts on.
//
// `docker-compose.limits-e2e.yml` gives an authenticated player a
// hosted-sessions quota of 3 (SOCKBOWL_QUOTA_PLAYER_HOSTED_SESSIONS) and a
// session-create rate limit of 2 per 20s (SOCKBOWL_RL_SESSION_CREATE_*) —
// small enough to reach with a couple of clicks, but small enough that this
// spec has to mind the rate limit itself while it's busy proving the *quota*
// behaves (see the comment above the recovery attempt below).
//
// `HostedSessionQuota` (game backend) deliberately has no "end session" call
// — a hosted session only stops counting when it goes idle or its document
// disappears (plan §2.1, `HostedSessionQuota` javadoc) — so a session this
// spec creates outlives the test. Since the harness runs this spec more than
// once against the same live stack, every scenario below starts by using the
// admin's own "Reset all daily" action to clear player2's hosted-sessions
// count first, making each run independent of how many times it's run before.

// Assertion timeouts below are generous (15-20s, not Playwright's 5s
// default) because this stack runs on a machine shared with other
// milestones' own suites (see plan/RULES): an otherwise-fast REST round
// trip can occasionally queue behind CPU contention. This is slack for
// that, not a weaker assertion -- verified directly against this same live
// stack that the underlying flow (login -> provision -> admin search ->
// row visible) normally completes in well under a second.

test.describe('M4 admin usage view (live)', () => {
  test('quota override blocks a player, active sessions are visible, override clears and recovers, IP ban round trips', async ({ browser }) => {
    test.setTimeout(180_000);

    const adminCtx = await browser.newContext();
    const playerCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    const playerPage = await playerCtx.newPage();

    await loginAs(playerPage, 'player2');
    await loginAs(adminPage, 'player1');

    // Nothing provisions player2's Postgres `User` row on mere Keycloak
    // login -- `AdminUsageService.listUsers` (plan §2.8) pages the `users`
    // table directly, and the only writer is `UserService.findOrCreateUser`,
    // called from an authenticated session join or one of the
    // `/api/v1/user/*` endpoints. On a fresh stack the very first admin
    // search below would otherwise run before player2 has ever made such a
    // call. Visiting their own profile page provisions the row without
    // touching the session-create rate limit or hosted-sessions quota this
    // spec is busy exercising.
    await provisionUser(playerPage);

    // ---- clean baseline ----
    await openPlayer2Detail(adminPage);
    await clickAction(adminPage, 'Reset all daily');
    await expect(adminPage.getByText('Usage reset')).toBeVisible({ timeout: 15_000 });

    let row = await openPlayer2Detail(adminPage);
    await expect(sessionsCell(row)).toHaveText('0', { timeout: 20_000 });

    // ---- baseline host: a real hosted session shows up in the admin view ----
    const baseline = await attemptHostSolo(playerPage);
    expect(baseline.result, `baseline host failed unexpectedly: ${JSON.stringify(baseline)}`).toBe('ok');

    row = await openPlayer2Detail(adminPage);
    await expect(sessionsCell(row)).toHaveText('1', { timeout: 20_000 });

    // ---- admin sets the hosted-sessions override to 0 ----
    await editHostedSessionsQuota(adminPage, { limit: 0 });
    await expect(adminPage.getByText('Quota updated')).toBeVisible({ timeout: 15_000 });

    const blocked = await attemptHostSolo(playerPage);
    expect(blocked.result, `expected the override to block this create: ${JSON.stringify(blocked)}`).toBe('quota');
    expect(blocked.message).toMatch(/reached your hosted session limit/i);
    expect(blocked.message).toMatch(/\(0\)/);

    // ---- admin clears the override; the player's next create recovers ----
    await editHostedSessionsQuota(adminPage, { resetToDefault: true });
    await expect(adminPage.getByText('Quota updated')).toBeVisible({ timeout: 15_000 });

    // The two attempts above (baseline + blocked) already spent both tokens
    // in player2's session-create bucket (capacity 2 / 20s — the quota check
    // runs *after* the rate limit, so even the quota-blocked attempt spent
    // one). Wait out the window so this recovery attempt is rejected only by
    // quota, never by an unrelated 429 rate_limited.
    await playerPage.waitForTimeout(21_000);
    const recovered = await attemptHostSolo(playerPage);
    expect(recovered.result, `expected the cleared override to let this create through: ${JSON.stringify(recovered)}`).toBe('ok');

    // ---- IP ban round trip ----
    // Deliberately a TEST-NET-3 (RFC 5737) address, not player2's real IP.
    // This stack runs with `network_mode: host` on a single machine, so
    // every Playwright context here — admin, player, and the harness's own
    // REST calls — is likely to appear to the backend as the same address.
    // `RequestGuardFilter`'s IP-ban check has no admin-route exemption
    // (plan §2.1), so banning the real shared address would 403 every
    // request this test makes afterwards, including the admin's own
    // "remove ban" call: a self-inflicted deadlock, not a useful test. This
    // proves the admin UI's create → list → remove round trip; live
    // block/recover behavior for a banned IP is already covered by G4's
    // `IpBanIT`, which simulates a distinct remote address at the servlet
    // filter level.
    const decoyCidr = '203.0.113.77/32';
    row = await openPlayer2Detail(adminPage);
    const ipRow = row.locator('xpath=following-sibling::tr[1]').locator('.admin-usage__ip-row').first();
    await expect(ipRow).toBeVisible({ timeout: 20_000 });
    await ipRow.getByRole('button', { name: 'Ban this IP' }).click();

    const banDialog = adminPage.locator('mat-dialog-container');
    await expect(banDialog).toBeVisible();
    const cidrInput = banDialog.locator('input[name="cidr"]');
    await cidrInput.fill('');
    await cidrInput.fill(decoyCidr);
    await banDialog.locator('input[name="reason"]').fill('M4 WP-E1 e2e round trip (decoy address, see spec comment)');
    await banDialog.getByRole('button', { name: 'Ban IP' }).click();
    await expect(adminPage.getByText('IP banned')).toBeVisible({ timeout: 15_000 });

    await adminPage.goto('/admin/bans');
    const banItem = adminPage.locator('.admin-bans__item', { hasText: '203.0.113.77' });
    await expect(banItem).toBeVisible({ timeout: 20_000 });
    await banItem.getByRole('button', { name: 'Remove IP ban' }).click();
    await expect(adminPage.getByText('IP ban removed')).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.locator('.admin-bans__item', { hasText: '203.0.113.77' })).toHaveCount(0);

    await adminCtx.close();
    await playerCtx.close();
  });
});

// ---- helpers ----

/** Visits the signed-in user's own profile page, which lazily provisions their Postgres `User` row. */
async function provisionUser(page: Page) {
  await page.goto('/profile');
  await expect(page.locator('.profile-card')).toBeVisible({ timeout: 20_000 });
}

/**
 * Navigates fresh to /admin/usage, searches for player2 and expands their
 * row. A fresh navigation every time means `expandedSub` always starts null,
 * so the row's toggle button is reliably in the "Expand" state.
 */
async function openPlayer2Detail(page: Page) {
  await page.goto('/admin/usage');
  // `ngOnInit` fires an unfiltered `load()` the moment this component
  // mounts; typing into search and pressing Enter immediately fires a
  // second, filtered `load()`. Neither request is cancelled or switchMap'd,
  // so if the first (unfiltered, potentially many-row) response happens to
  // resolve *after* the second (filtered) one, it silently overwrites
  // `rows` with the unfiltered page and player2's row may not be on it.
  // Waiting for the initial load's spinner to clear before searching keeps
  // the two requests from racing at all. `.admin-usage__status` is reused
  // by four independent spinners on this page (global, table, detail,
  // events), all mounted at once on a fresh navigation, so this scopes to
  // the one inside the same card as the search box rather than matching all
  // of them (Playwright's `getByLabel`-on-"Reason" lesson from
  // `admin-bans.component.html` applies here too).
  const search = page.locator('input[name="search"]');
  const usersCard = page.locator('mat-card', { has: search });
  await expect(usersCard.locator('.admin-usage__status')).toBeHidden({ timeout: 20_000 });
  await search.fill('player2');
  await search.press('Enter');
  const row = page.locator('tr.admin-usage__row', { hasText: 'player2' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Expand' }).click();
  await expect(page.locator('.admin-usage__detail')).toBeVisible({ timeout: 20_000 });
  return row;
}

/** The "Sessions" column cell (displayedColumns order: user, tier, lastSeen, status, sessions, packets, expand). */
function sessionsCell(row: ReturnType<Page['locator']>) {
  return row.locator('td').nth(4);
}

/** Clicks a labelled button inside the expanded detail panel's side actions. */
async function clickAction(page: Page, label: string) {
  await page.locator('.admin-usage__actions').getByRole('button', { name: label }).click();
}

/**
 * Opens the "hosted session" counter's edit-quota dialog and either sets a
 * numeric limit or resets it back to the role default.
 */
async function editHostedSessionsQuota(page: Page, opts: { limit?: number; resetToDefault?: boolean }) {
  const counter = page.locator('.admin-usage__counter', { hasText: 'hosted session' });
  await expect(counter).toBeVisible({ timeout: 20_000 });
  await counter.getByRole('button', { name: 'Edit quota' }).click();

  const dialog = page.locator('mat-dialog-container');
  await expect(dialog).toBeVisible();
  if (opts.resetToDefault) {
    await dialog.getByRole('button', { name: 'Reset to role default' }).click();
  } else {
    const unlimitedInput = dialog.locator('input[type="checkbox"]');
    if (await unlimitedInput.isChecked()) {
      await dialog.locator('mat-checkbox').click();
    }
    await dialog.locator('input[name="limitValue"]').fill(String(opts.limit ?? 0));
    await dialog.getByRole('button', { name: 'Save' }).click();
  }
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

interface HostAttempt {
  result: 'ok' | 'quota' | 'rate' | 'unknown';
  message?: string;
}

/** One "New game" → "Solo practice" quick-launch attempt, classified by what happens. */
async function attemptHostSolo(page: Page): Promise<HostAttempt> {
  await page.goto('/game-session');
  await page.locator('.lobby-action').filter({ hasText: 'New game' }).click();
  const solo = page.locator('.lobby-action').filter({ hasText: 'Solo practice' });
  await expect(solo).toBeVisible();
  await solo.click();

  const quotaText = page.getByText(/reached your hosted session limit/i);
  const rateText = page.getByText(/Slow down, try again in/i);

  const okP = page
    .waitForURL(/\/game;/, { timeout: 15_000 })
    .then((): HostAttempt => ({ result: 'ok' }))
    .catch(() => null);
  const quotaP = quotaText
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(async (): Promise<HostAttempt> => ({ result: 'quota', message: await quotaText.first().innerText() }))
    .catch(() => null);
  const rateP = rateText
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then((): HostAttempt => ({ result: 'rate' }))
    .catch(() => null);

  const first = await Promise.race([okP, quotaP, rateP]);
  return first ?? { result: 'unknown' };
}
