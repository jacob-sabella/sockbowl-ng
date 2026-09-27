import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

// The M2 "Done when": a real Keycloak login, an authenticated join by a
// second account, and a full auto-judged match played to the summary.
const HOST = process.env.E2E_AUTHOR || 'testuser';
const PLAYER = process.env.E2E_PLAYER || 'player2';

test('A demo author hosts, a demo player joins by code, and they play an auto-judged match to the summary', async ({ page, browser }) => {
  test.setTimeout(240_000);

  await page.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });

  // Host: sign in as the author demo user. The navbar shows the signed-in
  // name — assert it's actually HOST's name, not just that some text rendered.
  await loginAs(page, HOST);
  await expect(page.locator('.navbar__user-name')).toHaveText(new RegExp(HOST, 'i'));

  // The host is authenticated too, so "Auto-judged match" drives the same
  // create -> join-game-session-authenticated flow as the player's join
  // below (game-session.component.ts's submitCreateGame -> submitJoinGame).
  // Assert that call actually went through the authenticated endpoint and
  // bound the host's own seat to their Keycloak identity, not just that the
  // page eventually landed on /game.
  const hostJoinResponse = page.waitForResponse(resp =>
    resp.url().includes('join-game-session-authenticated') && resp.request().method() === 'POST'
  );
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Auto-judged match/ }).click();
  const hostJoinResp = await hostJoinResponse;
  expect(hostJoinResp.status()).toBe(200);
  const hostJoinBody = await hostJoinResp.json();
  expect(hostJoinBody.joinStatus).toBe('SUCCESS');
  // userId is populated only for an authenticated join (SessionService's
  // addAuthenticatedUserToGameSession) — a guest join never sets it. That's
  // the actual proof the host's own seat was bound to their Keycloak identity.
  expect(hostJoinBody.userId).toBeTruthy();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  const code = (await page.locator('.code-value').innerText()).trim();
  await page.locator('.team__actions button').first().click();

  // Player: a second, independent browser context signs in as the player
  // demo user and joins by code, over the authenticated join endpoint.
  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  await playerPage.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });
  await loginAs(playerPage, PLAYER);
  await expect(playerPage.locator('.navbar__user-name')).toHaveText(new RegExp(PLAYER, 'i'));

  await playerPage.getByRole('button', { name: /Join with a code/ }).click();
  await playerPage.getByLabel('Join Code').fill(code);

  const joinResponse = playerPage.waitForResponse(resp =>
    resp.url().includes('join-game-session-authenticated') && resp.request().method() === 'POST'
  );
  await playerPage.getByRole('button', { name: 'Join', exact: true }).click();
  const joinResp = await joinResponse;
  expect(joinResp.status()).toBe(200);
  const joinBody = await joinResp.json();
  expect(joinBody.joinStatus).toBe('SUCCESS');
  expect(joinBody.userId).toBeTruthy();

  await playerPage.waitForURL('**/game;**', { timeout: 25_000 });
  await playerPage.locator('.team__actions button').last().click();

  // Host: use the imported packet bank via Search Existing, picking the
  // smallest published packet in this stack's seed data (13 tossups; no
  // subset/quantity picker exists for Search Existing, so the whole packet
  // is played). Not the qbreader "Generate" tab, which would let a host pick
  // an exact tossup count (3, per the plan) but draws from a separate bank
  // of :BankTossup/:BankBonus nodes this compose stack doesn't seed (a
  // known, reported M3 follow-up — confirmed directly: `MATCH (p:Packet)
  // ... RETURN p.name, count of :Tossup` shows only Search-Existing-style
  // packets, and `CALL db.labels()` lists no :BankTossup/:BankBonus label at
  // all). The M1 login+play e2e hit the same gap and made the same call.
  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await expect(dialog).toBeVisible();
  const search = dialog.locator('.search-field input');
  await search.click();
  await search.fill('2010 Collaborative MS Tournament - Round 05');
  const result = dialog.locator('.result-item').first();
  await expect(result).toBeVisible({ timeout: 20_000 });
  await result.click();
  await dialog.getByRole('button', { name: 'Use Packet' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Start the match and play all 13 tossups in the packet through to the
  // match summary (there's no way to end an auto-judged multiplayer match
  // early; MatchState only becomes COMPLETED once the packet is exhausted).
  await page.getByRole('button', { name: /Start Match/ }).click();
  await expect(page.locator('.game-proctor .question-section')).toBeVisible({ timeout: 20_000 });

  const TOSSUP_COUNT = 13;
  for (let i = 0; i < TOSSUP_COUNT; i++) {
    await page.waitForTimeout(1200);
    await page.locator('.buzz-btn').click();

    const input = page.locator('.answer-input');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('the answer');
    await page.waitForTimeout(500);
    await page.locator('.answer-form button[type="submit"]').click();

    // The literal answer is wrong, so with two teams and one buzz each,
    // the round isn't COMPLETED yet — buzzing reopens for the player's
    // team. Have them buzz and answer (also wrong) to exhaust both teams
    // and complete the round, matching real auto-judged-match semantics.
    const playerBuzz = playerPage.locator('.buzz-btn');
    await expect(playerBuzz).toBeEnabled({ timeout: 10_000 });
    await playerBuzz.click();
    const playerInput = playerPage.locator('.answer-input');
    await expect(playerInput).toBeVisible({ timeout: 10_000 });
    await playerInput.fill('the answer');
    await playerPage.waitForTimeout(500);
    await playerPage.locator('.answer-form button[type="submit"]').click();

    await expect(page.locator('.advance-bar')).toBeVisible({ timeout: 15_000 });
    // The button's accessible name is its aria-label ("Go to the next
    // tossup now…"), not its visible "Next now" text.
    const nextButton = page.getByRole('button', { name: /next tossup now/i });
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click();
    }
  }

  await expect(page.locator('.match-summary')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.team-score').first()).toBeVisible();

  await playerCtx.close();
});
