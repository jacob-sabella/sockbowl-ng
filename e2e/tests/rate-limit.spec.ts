import { test, expect, type Page } from '@playwright/test';
import { createGame, joinByCode, findSeededPacket, type JoinResult } from '../harness/rest.js';
import { SockbowlBot, spawnBot } from '../harness/bot.js';
import { APP_URL } from '../harness/config.js';
import { getDemoAccessToken } from '../harness/auth.js';

// M4 plan WP-E1 (`plans/m4-limits.md` §3 "Wave F", "E1: Playwright e2e for
// limits and admin usage"): live proof, against a real stack running
// `docker-compose.limits-e2e.yml` on top of the dev overlay, that:
//
//   - the REST `session-create` rate limit trips and recovers (M4-RL-03,
//     M4-UI-01: the 429 shows the "Slow down" snackbar and disables the
//     create button; the server's bucket refills and a later create
//     succeeds).
//   - the STOMP `stomp-buzz` throttle trips on a flooding connection and
//     does not punish anyone else's connection (M4-RL-05, M4-RL-06).
//
// `docker-compose.limits-e2e.yml` sets `SOCKBOWL_RL_SESSION_CREATE_CAPACITY`
// and `SOCKBOWL_RL_STOMP_BUZZ_CAPACITY` very small so both trip in a handful
// of attempts/messages instead of production-sized traffic. The exact
// trigger point also depends on `sockbowl.ratelimit.policies.*.tier-multipliers`
// (a guest gets a fraction of the configured capacity for `session-create`,
// see plan §2.2/§2.10), so the guest case below loops until it observes the
// 429 rather than assuming a specific attempt number.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const deepLink = (j: JoinResult) =>
  `${APP_URL}/game;gameSessionId=${j.gameSessionId};playerSecret=${j.playerSecret};playerSessionId=${j.playerSessionId}`;

/**
 * Opens the lobby fresh and reveals the mode picker ("New game" clicked),
 * returning the "Solo practice" button. `RateLimitStateService`'s cooldown
 * state (plan §2.9) lives only in memory for this one Angular app instance,
 * so every caller that needs to observe it must reuse the same `Page`
 * without an intervening `page.goto`/reload, which would boot a fresh app
 * instance and silently "clear" a cooldown that the server still enforces.
 */
async function openModeSelect(page: Page) {
  await page.goto('/game-session');
  await page.locator('.lobby-action').filter({ hasText: 'New game' }).click();
  const solo = page.locator('.lobby-action').filter({ hasText: 'Solo practice' });
  await expect(solo).toBeVisible();
  return solo;
}

/**
 * Clicks the already-visible "Solo practice" button and classifies what
 * happens: a successful create navigates to `/game;...` via `Router.navigate`
 * (no reload -- see `game-session.component.ts` `submitJoinGame`); a 429
 * leaves the SPA on the same route and shows the "Slow down" snackbar
 * without navigating anywhere.
 */
async function attemptSoloCreate(page: Page, solo: ReturnType<Page['locator']>): Promise<'ok' | 'blocked' | 'unknown'> {
  await solo.click();

  // 20s legs, not 8s: this machine runs this stack alongside other
  // milestones' own suites (see plan/RULES on shared-host concurrency), so
  // an otherwise-instant REST round trip can occasionally queue behind CPU
  // contention. The 20s budget is slack for that, not a weaker assertion --
  // both legs still race, and `attempt N was neither a create nor a 429`
  // still fails the test if genuinely neither happens.
  const okP = page
    .waitForURL(/\/game;/, { timeout: 20000 })
    .then(() => 'ok' as const)
    .catch(() => null);
  const blockedP = page
    .getByText(/Slow down, try again in/i)
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => 'blocked' as const)
    .catch(() => null);
  const result = await Promise.race([okP, blockedP]);
  return result ?? 'unknown';
}

test.describe('M4 rate limiting (live)', () => {
  test('guest session-create: trips, shows the cooldown, and recovers after the window', async ({ page }) => {
    test.setTimeout(120_000);

    let blockedOnAttempt = -1;
    let solo = await openModeSelect(page);
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await attemptSoloCreate(page, solo);
      expect(result, `attempt ${attempt} was neither a create nor a 429`).not.toBe('unknown');
      if (result === 'blocked') {
        blockedOnAttempt = attempt;
        break;
      }
      // A successful create navigated away to /game;...; go back to the
      // lobby (a fresh mode-select instance) for the next attempt.
      solo = await openModeSelect(page);
    }
    expect(blockedOnAttempt, `session-create never tripped in ${MAX_ATTEMPTS} guest attempts`).toBeGreaterThan(0);

    // The trip disables every session-create button on THIS SAME page
    // instance (shared cooldown state, plan §2.9): the blocked attempt above
    // never navigated anywhere, so `solo` is still the live element the
    // cooldown signal just disabled -- no reload needed, and a reload would
    // wipe the very in-memory state this assertion is checking.
    await expect(solo).toBeDisabled();

    // Recovery: the server-side bucket refills on its own clock, independent
    // of this page. Wait well past the configured refill window and the
    // same button re-enables itself and the next create succeeds.
    await sleep(21_000);
    const recovered = await attemptSoloCreate(page, solo);
    expect(recovered).toBe('ok');
  });

  test('STOMP stomp-buzz: a flooding connection is throttled, another player still buzzes in', async ({ browser }) => {
    test.setTimeout(120_000);

    // The previous test (guest session-create) deliberately creates two
    // guest-hosted sessions (the initial one before it trips, then the
    // recovery one) to prove the rate limit -- exactly the compose stack's
    // `SOCKBOWL_QUOTA_GUEST_HOSTED_SESSIONS` cap. `HostedSessionQuota` is
    // concurrent, not a refilling rate limit (plan §2.3 -- a session only
    // stops counting once it goes idle or its document disappears, on a
    // clock far longer than this suite's runtime), so waiting cannot free
    // it back up. This test's own game create authenticates as a demo
    // account instead of going in as a guest, so it's keyed by *subject*
    // and never touches the already-exhausted guest quota (or, under
    // `network_mode: host`, the guest session-create rate bucket the prior
    // test also just spent).
    const proctorToken = await getDemoAccessToken('player3');
    const game = await createGame('QUIZ_BOWL_CLASSIC', 'ONLINE_PROCTOR', false, proctorToken);
    // `import-random` draws from a separate :BankTossup/:BankBonus bank this
    // compose stack doesn't seed (see `harness/rest.ts` and
    // `scripts/full-match.ts`), so this looks up a real, already-seeded
    // PUBLISHED packet instead -- any packet with at least one tossup is
    // enough to reach AWAITING_BUZZ for the flood.
    const packetName = process.env.SOCKBOWL_E2E_PACKET_NAME || '2010 Collaborative MS Tournament - Round 05';
    const packetId = (await findSeededPacket(packetName)).id;

    const hostJoin = await joinByCode(game.joinCode, 'Proctor');
    const proctor = new SockbowlBot('Proctor', hostJoin.gameSessionId, hostJoin.playerSecret, hostJoin.playerSessionId);
    await proctor.connect();
    await proctor.waitFor((g) => !!g.teamList?.length, 8000, 'teams present');
    const teams = proctor.teams;

    // The flooding bot sits on team 2; the real browser player buzzes from
    // team 1, on a separate connection the per-connection bucket never sees.
    const spamBot = await spawnBot(joinByCode, game.joinCode, 'SpamBot');
    spamBot.joinTeam(teams[1].teamId);

    const adaJoin = await joinByCode(game.joinCode, 'Ada');
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(deepLink(adaJoin), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Join Team 1/i }).click();
    await page.waitForTimeout(1000);

    proctor.becomeProctor();
    proctor.setPacket(packetId);
    await proctor.waitFor(
      (g) =>
        g.currentMatch?.packet?.id === packetId &&
        (g.teamList ?? []).reduce((n: number, t: any) => n + (t.teamPlayers?.length ?? 0), 0) >= 2,
      15000,
      'ready to start',
    );

    proctor.startMatch();
    await proctor.waitFor((g) => g.currentMatch?.matchState === 'IN_GAME', 12000, 'IN_GAME');
    if (proctor.roundState === 'PROCTOR_READING') {
      proctor.finishedReading();
    }
    await proctor.waitFor((g) => g.currentMatch?.currentRound?.roundState === 'AWAITING_BUZZ', 12000, 'AWAITING_BUZZ');

    // Flood: `stomp-buzz` capacity is tiny (docker-compose.limits-e2e.yml).
    // The connection's local bucket only lets the first few through; the
    // rest are soft-dropped with a RATE_LIMITED StompError.
    await spamBot.spamBuzz(20);

    await expect
      .poll(() => spamBot.errors.some((e) => e.code === 'RATE_LIMITED'), {
        timeout: 8000,
        message: 'expected a RATE_LIMITED StompError from the buzz flood on /user/queue/errors',
      })
      .toBe(true);
    // The socket must stay open (a soft drop, not a fatal ERROR frame).
    expect(spamBot.errors.every((e) => !e.fatal)).toBe(true);

    // The bot's own first (unthrottled) buzz still won the tossup for its
    // team. Judge it wrong so the question reopens for the other team.
    await proctor.waitFor((g) => g.currentMatch?.currentRound?.roundState === 'AWAITING_ANSWER', 8000, 'AWAITING_ANSWER after spam');
    proctor.judge(false);
    await proctor.waitFor((g) => g.currentMatch?.currentRound?.roundState === 'AWAITING_BUZZ', 8000, 'AWAITING_BUZZ reopened');

    // A second later, a different connection (Ada, a real browser) buzzes.
    // Her bucket was never touched by SpamBot's flood, so it's accepted and
    // visible to the proctor.
    await sleep(1000);
    await page.locator('#buzz-button, .buzz-button').first().click();
    await proctor.waitFor(
      (g) => g.currentMatch?.currentRound?.currentBuzz?.playerId === adaJoin.playerSessionId,
      8000,
      "Ada's buzz reaching the proctor",
    );

    await ctx.close();
    proctor.disconnect();
    spamBot.disconnect();
  });
});
