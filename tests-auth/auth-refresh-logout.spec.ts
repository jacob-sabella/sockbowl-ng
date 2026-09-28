import { test, expect } from '@playwright/test';
import { loginAs, logout, getAccessToken } from './helpers/login';

// Run this spec against a stack started with KC_ACCESS_TOKEN_LIFESPAN=60 (see
// README.md's e2e section — set on the docker compose environment that boots
// Keycloak, not only as a Playwright-side env var here). Sitting past that
// lifespan mid-game forces both a REST refresh (401 -> refresh -> retry, or
// the library's own token_expires timer) and a socket-side refresh
// (AuthService.tokenChanges$ -> the next STOMP SEND carries the new
// Authorization header once).
const E2E_USER = process.env.E2E_USER || 'player2';
const TOKEN_LIFESPAN_SECONDS = Number(process.env.KC_ACCESS_TOKEN_LIFESPAN || 60);

/** Decodes a JWT's payload (no signature check needed; this is a same-origin e2e probe). */
function decodeJwtPayload(token: string): { iat?: number; exp?: number; [k: string]: unknown } {
  const [, payload] = token.split('.');
  const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

test('An access-token refresh mid-game keeps the socket and REST calls alive, then logout/re-login work', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });

  // Collect every STOMP frame the socket sends, so we can later prove a SEND
  // carried the refreshed bearer (not just that the UI kept working).
  const sentFrames: string[] = [];
  page.on('websocket', ws => {
    ws.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') sentFrames.push(payload);
    });
  });

  await loginAs(page, E2E_USER);

  const tokenBeforeWait = await getAccessToken(page);
  expect(tokenBeforeWait).toBeTruthy();
  const payloadBeforeWait = decodeJwtPayload(tokenBeforeWait!);
  expect(payloadBeforeWait.exp).toBeDefined();
  expect(payloadBeforeWait.iat).toBeDefined();
  // Sanity check on the stack's own config, not just Playwright's env: if the
  // compose stack were still at the default 300s lifespan (NG-2's actual
  // failure mode — KC_ACCESS_TOKEN_LIFESPAN set on npm only), this token's
  // own exp-iat would already reveal it, well before the mid-game assertions
  // below ever get a chance to observe a refresh.
  expect(payloadBeforeWait.exp! - payloadBeforeWait.iat!).toBeLessThanOrEqual(TOKEN_LIFESPAN_SECONDS + 5);

  // A single-player game against the packet bank (no packet:create needed).
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Solo practice/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  // Search Existing, not the qbreader "Generate" tab: Generate now works
  // against a bank seeded by helpers/bank.ts's seedBankFixture() (exercised
  // by auth-generate.spec.ts), but this spec doesn't seed one, and Search
  // Existing is enough to exercise the mid-game token refresh under test here.
  await page.getByRole('button', { name: /Find a Packet/ }).click();
  const dialog = page.locator('.packet-search-dialog');
  await expect(dialog).toBeVisible();
  const search = dialog.locator('.search-field input');
  await search.click();
  await search.fill('2015 Prison Bowl');
  const result = dialog.locator('.result-item').first();
  await expect(result).toBeVisible({ timeout: 20_000 });
  await result.click();
  await dialog.getByRole('button', { name: 'Use Packet' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await page.getByRole('button', { name: /Start Match/ }).click();
  await expect(page.locator('.game-proctor .question-section')).toBeVisible({ timeout: 20_000 });

  // Sit past the access-token lifespan (plus margin) so a refresh happens.
  // Solo practice's own reading + 8s buzz-grace window (well under a minute
  // for this tossup at the default reading speed) elapses well within this
  // wait, so tossup 1 auto-forgoes (no buzz) while we're idle — that's fine,
  // it isn't what this spec is proving.
  const framesSentBeforeWait = sentFrames.length;
  await page.waitForTimeout((TOKEN_LIFESPAN_SECONDS + 15) * 1_000);

  // The core proof this spec was missing (NG-2): the token actually changed,
  // and the new one really was reissued with a fresh iat, not just re-read
  // from storage. A stale token here would mean the wait above proved nothing.
  const tokenAfterWait = await getAccessToken(page);
  expect(tokenAfterWait).toBeTruthy();
  expect(tokenAfterWait).not.toBe(tokenBeforeWait);
  const payloadAfterWait = decodeJwtPayload(tokenAfterWait!);
  expect(payloadAfterWait.iat!).toBeGreaterThan(payloadBeforeWait.iat!);
  expect(payloadAfterWait.exp! - payloadAfterWait.iat!).toBeLessThanOrEqual(TOKEN_LIFESPAN_SECONDS + 5);

  // The actual post-expiry proof: advancing sends a real STOMP SEND
  // (sendAdvanceRound) with whatever Authorization the client now holds. A
  // stale token would surface a fatal ERROR banner (TOKEN_EXPIRED /
  // AUTH_REQUIRED) instead of loading the next tossup.
  // The button's accessible name comes from its aria-label ("Go to the next
  // tossup…"), not its visible "Next Tossup" text — match case-insensitively
  // against the label instead of the display text.
  const nextTossupButton = page.getByRole('button', { name: /next tossup/i });
  await expect(nextTossupButton).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.stomp-error-banner.fatal')).toBeHidden();
  await nextTossupButton.click();
  await expect(page.locator('.game-proctor .question-section')).toBeVisible({ timeout: 10_000 });

  // And the wire proof: a SEND made after the wait actually carried the new
  // bearer (GameWebSocketService.tokenChanges$ -> "once" contract), not just
  // that the UI happened to keep rendering. (NG-R2-03: the previous version
  // of this check matched *any* frame with an "Authorization:" substring —
  // it never restricted to SEND, never compared the token's actual value,
  // and never ruled out a reconnect CONNECT, which also carries
  // Authorization and would pass just as easily on a stale token.)
  const framesAfterWait = sentFrames.slice(framesSentBeforeWait);
  const sendFramesAfterWait = framesAfterWait.filter(f => f.startsWith('SEND\n'));
  expect(sendFramesAfterWait.length).toBeGreaterThan(0);
  expect(sendFramesAfterWait.some(f => f.includes(`Authorization:Bearer ${tokenAfterWait}`))).toBe(true);
  expect(framesAfterWait.some(f => f.startsWith('CONNECT\n'))).toBe(false);

  // Play it normally too: buzz, answer, and see the verdict, with no fatal
  // ERROR banner, proving the refreshed socket auth keeps working going forward.
  await page.waitForTimeout(1_500);
  await page.locator('.buzz-btn').click();
  const input = page.locator('.answer-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill('the answer');
  await page.waitForTimeout(600);
  await page.locator('.answer-form button[type="submit"]').click();
  await expect(page.locator('.proctor-status .status-dot--done')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.stomp-error-banner.fatal')).toBeHidden();

  // /profile: the REST call gets 200 after a refresh, not a stale-token 401.
  const meResponse = page.waitForResponse(resp =>
    resp.url().includes('/api/v1/auth/me') && resp.request().method() === 'GET'
  );
  await page.goto('/profile');
  expect((await meResponse).status()).toBe(200);
  await expect(page.locator('.profile-card')).toBeVisible({ timeout: 10_000 });

  // Logout lands on /game-session in the app, not the Keycloak logout page.
  await logout(page);
  await expect(page).toHaveURL(/\/game-session/);

  // A protected route, now signed out, triggers the login redirect.
  await page.goto('/profile');
  await page.waitForURL('**/realms/sockbowl/protocol/openid-connect/auth**', { timeout: 20_000 });
});
