import { test, expect } from '@playwright/test';
import { loginAs, getAccessToken } from './helpers/login';
import type { Browser } from '@playwright/test';

// The M2 "Done when": a real Keycloak login, an authenticated join by a
// second account, and a full auto-judged match played to the summary.
const HOST = process.env.E2E_AUTHOR || 'testuser';
const PLAYER = process.env.E2E_PLAYER || 'player2';
// The navbar shows the Keycloak *display* name (firstName + lastName from
// sockbowl-docker's keycloak/rbac-model.json demo users), not the username:
// testuser -> "Test User", player2 -> "Player Two". Configurable in case a
// stack seeds different demo profiles.
const HOST_DISPLAY_NAME = process.env.E2E_AUTHOR_NAME || 'Test User';
const PLAYER_DISPLAY_NAME = process.env.E2E_PLAYER_NAME || 'Player Two';
// Reads the packet's first answer (NG-R3-04): packet:manage-any may read a
// PUBLISHED packet in full; the author and the player may not (D2).
const ADMIN = process.env.E2E_ADMIN || 'player1';
const PACKET_NAME = process.env.SOCKBOWL_E2E_PACKET_NAME || '2010 Collaborative MS Tournament - Round 05';

/** The judge-accepted primary answer: the underlined/bold part, else the text before any [ or (. */
function primaryAnswer(line: string): string {
  const m = (line || '').match(/<u[^>]*>([\s\S]*?)<\/u>/i) || (line || '').match(/<b[^>]*>([\s\S]*?)<\/b>/i);
  let s = m ? m[1] : (line || '');
  s = s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return (s.split(/[[(]/)[0] || '').replace(/^answer:\s*/i, '').trim();
}

/**
 * The first-read tossup's answer (the game reads tossups in `order`), looked
 * up over GraphQL with the admin demo account's token in its own context.
 */
async function firstTossupAnswer(browser: Browser, graphqlUrl: string): Promise<string> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await loginAs(page, ADMIN);
    const token = await getAccessToken(page);
    expect(token, 'admin access token').toBeTruthy();
    const gql = async (query: string, variables: Record<string, unknown>) => {
      const res = await page.request.post(graphqlUrl, {
        headers: { Authorization: `Bearer ${token}` },
        data: { query, variables },
      });
      expect(res.ok()).toBeTruthy();
      return (await res.json()).data;
    };
    const found = await gql('query($name: String!){ searchPacketsByName(name: $name){ id name } }', { name: PACKET_NAME });
    const hit = found.searchPacketsByName.find((p: { name: string }) => p.name === PACKET_NAME) ?? found.searchPacketsByName[0];
    expect(hit, `seeded packet "${PACKET_NAME}"`).toBeTruthy();
    const detail = await gql('query($id: ID!){ getPacketById(id: $id){ tossups { order tossup { answer } } } }', { id: hit.id });
    const tossups = detail.getPacketById.tossups.slice().sort((a: { order: number }, b: { order: number }) => a.order - b.order);
    return primaryAnswer(tossups[0].tossup.answer);
  } finally {
    await ctx.close();
  }
}

test('A demo author hosts, a demo player joins by code, and they play an auto-judged match to the summary', async ({ page, browser }) => {
  test.setTimeout(240_000);

  await page.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });

  // Host: sign in as the author demo user. The navbar shows the signed-in
  // display name — assert it's actually HOST's name, not just that some text
  // rendered. Scoped to the label span, not the whole `.navbar__user-name`
  // block: that block also renders a Material icon whose text-ligature name
  // ("account_circle") is concatenated onto the front of the display name in
  // textContent, e.g. "account_circleTest User" (NG-R2-... / M2R2-NG-03),
  // and asserting against HOST (the username "testuser") never matched the
  // rendered display name ("Test User") to begin with.
  await loginAs(page, HOST);
  await expect(page.locator('.navbar__user-name .navbar__btn-label')).toHaveText(new RegExp(HOST_DISPLAY_NAME, 'i'));

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
  await expect(playerPage.locator('.navbar__user-name .navbar__btn-label')).toHaveText(new RegExp(PLAYER_DISPLAY_NAME, 'i'));

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
  await search.fill(PACKET_NAME);
  const result = dialog.locator('.result-item').first();
  await expect(result).toBeVisible({ timeout: 20_000 });
  await result.click();
  await dialog.getByRole('button', { name: 'Use Packet' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const graphqlUrl = await page.evaluate(() => ((window as any).__env?.sockbowlQuestionsApiUrl || 'http://localhost:7009/') + 'graphql');
  const firstAnswer = await firstTossupAnswer(browser, graphqlUrl);
  expect(firstAnswer, 'first tossup answer').toBeTruthy();

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
    // The first tossup is answered correctly (NG-R3-04), so the summary must
    // show a real score, not just a rendered score element.
    await input.fill(i === 0 ? firstAnswer : 'the answer');
    await page.waitForTimeout(500);
    await page.locator('.answer-form button[type="submit"]').click();

    if (i === 0) {
      // A correct answer ends the round at once: nobody else may buzz.
      await expect(page.locator('.advance-bar')).toBeVisible({ timeout: 15_000 });
      const next = page.getByRole('button', { name: /next tossup now/i });
      if (await next.isVisible().catch(() => false)) {
        await next.click();
      }
      continue;
    }

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
  // The host's team scored the correct first tossup.
  const hostTeamScore = page.locator('.match-summary .team-list.your-team .team-score');
  await expect(hostTeamScore).toBeVisible();
  expect(Number((await hostTeamScore.innerText()).trim())).toBeGreaterThan(0);

  await playerCtx.close();
});
