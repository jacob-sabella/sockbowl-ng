import { test, expect, type Page } from '@playwright/test';
import { loginAs } from '../../tests-auth/helpers/login.js';
import { getDemoAccessToken } from '../harness/auth.js';
import { HTTP_BASE } from '../harness/config.js';
import { postFrom } from '../harness/rest.js';

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
    const quotaUpdatedToast = adminPage.getByText('Quota updated');
    await expect(quotaUpdatedToast).toBeVisible({ timeout: 15_000 });
    // This same "Quota updated" text is shown again below (after the
    // override is cleared, line ~90). `AdminUsageComponent` gives the
    // snackbar only a 3s `duration`, but on a fast run the whole
    // attemptHostSolo(blocked) + editHostedSessionsQuota(resetToDefault)
    // round trip below can also finish in under 3s, so this toast can
    // still be in the DOM when the second one opens -- two elements with
    // identical text, and `getByText('Quota updated')` (no default
    // uniquifying selector) hits a strict-mode violation (live evidence:
    // M4 WP-E1 r12's m4:limits run, 2 of 4 attempts). Waiting for this
    // one to fully close first removes the possibility of overlap instead
    // of just narrowing its window.
    await expect(quotaUpdatedToast).toBeHidden({ timeout: 10_000 });

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

    // ---- IP ban round trip (proves enforcement, not just the admin UI) ----
    // This stack runs with `network_mode: host` on a single machine, so both
    // browser contexts above (admin, player) are likely to appear to the
    // backend as the same loopback address. Rather than ban that shared
    // address -- `RequestGuardFilter`'s IP-ban check has no admin-route
    // exemption (plan §2.1), so that would 403 every request this test makes
    // afterwards, including the admin's own "remove ban" call: a
    // self-inflicted deadlock, not a useful test -- this bans a second,
    // distinct loopback address (127.0.0.2) that only `postFrom` below ever
    // binds an outbound connection to (`http.Agent({ localAddress })`,
    // `harness/rest.ts`). 127.0.0.0/8 is loopback in full, so this needs no
    // extra host setup. The admin's own browser stays on 127.0.0.1
    // (`APP_URL`, untouched here), so it's a genuinely different client as
    // far as the backend's IP-keyed ban/limit state is concerned.
    const bannedIp = '127.0.0.2';
    const bannedCidr = `${bannedIp}/32`;
    const bannedClientBody = {
      gameSettings: { gameMode: 'QUIZ_BOWL_CLASSIC', proctorType: 'ONLINE_PROCTOR', bonusesEnabled: true },
    };
    const createFromBannedIp = () =>
      postFrom(`${HTTP_BASE}/api/v1/session/create-new-game-session`, bannedClientBody, bannedIp, player2Token);

    // Authenticate this raw client as player2 too (not a plain guest fetch),
    // so a create it makes is keyed by player2's own `sub` -- same as the
    // hosted-sessions/quota state this spec has already been exercising --
    // and, one call first, so 127.0.0.2 has a chance to land in player2's
    // `usage:{sub}:ips` (plan §2.1) before the detail view below is opened.
    // Best-effort: `UsageTracker.touch` is throttled server-side, so this can
    // race the detail fetch and simply not show up yet; the fallback below
    // (typing the CIDR straight into the dialog) bans the same address
    // regardless of whether it does.
    const player2Token = await getDemoAccessToken('player2');
    await createFromBannedIp().catch(() => { /* best-effort IP-tracking primer */ });

    row = await openPlayer2Detail(adminPage);

    // The primer call above is a real, successful session-create (its
    // "best-effort IP-tracking" comment describes its *purpose*, not that it
    // usually fails) and lands as player2's 3rd hosted session -- exactly at
    // this overlay's default quota (SOCKBOWL_QUOTA_PLAYER_HOSTED_SESSIONS=3).
    // Left alone, the recovery poll at the very end of this test (after the
    // ban is lifted) would keep hitting 429 quota_exceeded forever instead
    // of the transient rate-limit 429 it's written to tolerate --
    // `HostedSessionQuota` only decrements a session when it goes idle or its
    // document disappears, neither of which happens inside this test's
    // lifetime. Clear it the same way the baseline section above does, so
    // only session-create's own (self-refilling) rate limit stands between
    // that final poll and its 200. This has no effect on the "Last IPs" list
    // the lookup just below reads -- `resetUsage` only clears the
    // hosted-sessions ZSET, not IP-tracking state (`AdminUsageService`).
    await clickAction(adminPage, 'Reset all daily');
    await expect(adminPage.getByText('Usage reset')).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.getByText('Usage reset')).toBeHidden({ timeout: 10_000 });

    const bannedIpRow = row.locator('xpath=following-sibling::tr[1]')
      .locator('.admin-usage__ip-row', { hasText: bannedIp });
    const banDialog = adminPage.locator('mat-dialog-container');
    // M5V1-06: the row's icon button now names the IP in its accessible name
    // ("Ban IP <ip>"), not the generic "Ban this IP".
    if (await bannedIpRow.count()) {
      await bannedIpRow.getByRole('button', { name: /^Ban IP/ }).click();
      await expect(banDialog).toBeVisible();
    } else {
      // 127.0.0.2 didn't land in "Last IPs" in time -- ban it directly by
      // typing the CIDR into the dialog instead (any row's button opens the
      // same dialog; its pre-filled value is simply overwritten below).
      const anyIpRow = row.locator('xpath=following-sibling::tr[1]').locator('.admin-usage__ip-row').first();
      await expect(anyIpRow).toBeVisible({ timeout: 20_000 });
      await anyIpRow.getByRole('button', { name: /^Ban IP/ }).click();
      await expect(banDialog).toBeVisible();
    }
    const cidrInput = banDialog.locator('input[name="cidr"]');
    await cidrInput.fill('');
    await cidrInput.fill(bannedCidr);
    await banDialog.locator('input[name="reason"]').fill('M4 WP-FIX-NG e2e IP ban enforcement (127.0.0.2, see spec comment)');
    await banDialog.getByRole('button', { name: 'Ban IP' }).click();
    await expect(adminPage.getByText('IP banned')).toBeVisible({ timeout: 15_000 });

    // ---- enforcement: 127.0.0.2 is rejected, the admin (127.0.0.1) is not ----
    // Each game instance reloads `ipban:all` into memory every 15s (plan
    // §2.1) rather than checking Postgres/Redis per request, so the ban
    // isn't necessarily live the instant the "Ban IP" call above resolves.
    // Poll for up to twice that refresh window. The ban check runs before
    // the rate limiter in `RequestGuardFilter`'s order (plan §2.2), so this
    // keeps returning 403 regardless of player2's session-create bucket
    // state -- polling it here never risks tripping a 429 instead.
    await expect(async () => {
      const res = await createFromBannedIp();
      expect(res.status).toBe(403);
      expect(res.body?.error).toBe('ip_banned');
    }).toPass({ timeout: 30_000, intervals: [1_000] });

    // The admin's own session (a different, unbanned address) is unaffected
    // by the ban above -- proven by every admin action from here on
    // (navigation, the unban click, its toast) continuing to succeed exactly
    // as it did before the ban was placed.

    // ---- remove the ban; the same client recovers ----
    await adminPage.goto('/admin/bans');
    const banItem = adminPage.locator('.admin-bans__item', { hasText: bannedIp });
    await expect(banItem).toBeVisible({ timeout: 20_000 });
    // M5V1-06: the icon button's accessible name now names the CIDR
    // ("Remove IP ban on <cidr>"), and the click only opens a confirmation
    // dialog (ConfirmDialogService, S5-02) rather than removing it directly.
    await banItem.getByRole('button', { name: /^Remove IP ban on/ }).click();
    const removeIpBanDialog = adminPage.locator('mat-dialog-container');
    await expect(removeIpBanDialog).toBeVisible();
    await removeIpBanDialog.getByRole('button', { name: 'Remove ban' }).click();
    await expect(adminPage.getByText('IP ban removed')).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.locator('.admin-bans__item', { hasText: bannedIp })).toHaveCount(0);

    // Once unbanned, the request falls through to the ordinary session-create
    // rate limit again, so this poll's timeout is generous enough to also
    // cover that bucket refilling (capacity 2 / 20s in this overlay) on top
    // of the 15s ban-cache refresh above, not just the ban check itself.
    await expect(async () => {
      const res = await createFromBannedIp();
      expect(res.status).toBe(200);
    }).toPass({ timeout: 45_000, intervals: [2_000] });

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
  // Not `{ hasText: 'player2' }`: the row's user cell renders
  // `row.displayName || row.username || row.keycloakId`, and player2's
  // *display name* is "Player Two" -- the literal substring "player2"
  // (their username/email) is never actually in the DOM once a display
  // name exists, so that filter could never match (live evidence: with the
  // OnPush fix in place, the table rendered exactly one row -- the search
  // already narrows server-side -- and this filter still failed to see
  // it). The server-side search already guarantees at most one match.
  const row = page.locator('tr.admin-usage__row').first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('Player Two', { timeout: 5_000 });
  await row.getByRole('button', { name: 'Expand' }).click();
  await expect(page.locator('.admin-usage__detail')).toBeVisible({ timeout: 20_000 });
  return row;
}

/** The "Sessions" column cell (displayedColumns order: user, tier, lastSeen, status, sessions, packets, expand). */
function sessionsCell(row: ReturnType<Page['locator']>) {
  return row.locator('td').nth(4);
}

/**
 * Clicks a labelled button inside the expanded detail panel's side actions.
 * M5V1-06: destructive actions here (e.g. "Reset all daily") now go through
 * the shared ConfirmDialogService (S5-02) instead of acting immediately, so
 * this also confirms that dialog when one opens.
 */
async function clickAction(page: Page, label: string) {
  await page.locator('.admin-usage__actions').getByRole('button', { name: label }).click();
  const confirmDialog = page.locator('mat-dialog-container');
  const opened = await confirmDialog.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false);
  if (opened) {
    await confirmDialog.getByRole('button', { name: /^(Reset|Remove ban)$/ }).click();
    await expect(confirmDialog).toBeHidden({ timeout: 10_000 });
  }
}

/**
 * Opens the "hosted session" counter's edit-quota dialog and either sets a
 * numeric limit or resets it back to the role default.
 */
async function editHostedSessionsQuota(page: Page, opts: { limit?: number; resetToDefault?: boolean }) {
  const counter = page.locator('.admin-usage__counter', { hasText: 'hosted session' });
  await expect(counter).toBeVisible({ timeout: 20_000 });
  // M5V1-06: the button's accessible name now names the metric ("Edit hosted
  // session quota"), from an aria-label that overrides the plain "Edit quota"
  // visible text.
  await counter.getByRole('button', { name: /^Edit .*quota$/ }).click();

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
