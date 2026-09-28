import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';

/**
 * WP-N4's CSP is asserted at the HTTP level by scripts/test-headers.sh; this
 * is the browser-side half (plan risk #3): load the lobby, log in through
 * Keycloak, and open a real match, and confirm nothing the CSP should allow
 * gets blocked (Material's dynamic styles, fonts, the service worker) and
 * nothing gets silently refused without being reported as a violation.
 */
test('No CSP violations across the lobby, login, and an in-game surface', async ({ page }) => {
  const violations: string[] = [];
  const cspConsoleErrors: string[] = [];

  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    window.addEventListener('securitypolicyviolation', (e: SecurityPolicyViolationEvent) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        `${e.violatedDirective} blocked ${e.blockedURI}`
      );
    });
  });
  page.on('console', msg => {
    if (msg.type() === 'error' && /content security policy|refused to (load|execute|connect)/i.test(msg.text())) {
      cspConsoleErrors.push(msg.text());
    }
  });
  await page.addInitScript(() => { try { localStorage.setItem('tts_enabled', 'false'); } catch {} });

  await loginAs(page, process.env.E2E_USER || 'player2');

  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Solo practice/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });

  // Search Existing, not the qbreader "Generate" tab: that tab draws from a
  // separate bank of :BankTossup/:BankBonus nodes this compose stack doesn't
  // seed (a known, reported M3 follow-up; see README.md's e2e section).
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
  await page.waitForTimeout(2_000);

  violations.push(...(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)));

  expect(violations, `CSP violations: ${violations.join('; ')}`).toEqual([]);
  expect(cspConsoleErrors, `console CSP errors: ${cspConsoleErrors.join('; ')}`).toEqual([]);
});

/**
 * The CSP must actually be sent (the test above would also pass on an image
 * with no CSP at all), and it must still let the Google Fonts stylesheets and
 * font files through once the Angular service worker controls the page: the
 * worker re-fetches those cross-origin GETs with fetch(), which the CSP's
 * connect-src governs, and a violation inside the worker never reaches the
 * page's securitypolicyviolation listener.
 */
test('The CSP header is sent, and fonts still load once the service worker controls the page', async ({ page }) => {
  test.setTimeout(120_000);

  const response = await page.goto('/game-session');
  expect(response, 'no response for /game-session').not.toBeNull();
  const headers = response!.headers();
  const csp = headers['content-security-policy'];
  expect(csp, 'Content-Security-Policy header').toBeTruthy();
  const directive = (name: string) =>
    csp.split(';').map(d => d.trim()).find(d => d === name || d.startsWith(`${name} `)) ?? '';
  expect(directive('script-src')).toBe("script-src 'self'");
  expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');

  // registerWhenStable:30000 - the worker registers within ~30s at the latest.
  await page.waitForFunction(() => 'serviceWorker' in navigator, undefined, { timeout: 5_000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  const fontFailures: string[] = [];
  const isFontRequest = (url: string, resourceType: string) =>
    resourceType === 'font' || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url);
  page.on('response', r => {
    if (isFontRequest(r.url(), r.request().resourceType()) && r.status() >= 400) {
      fontFailures.push(`${r.status()} ${r.url()}`);
    }
  });
  page.on('requestfailed', r => {
    if (isFontRequest(r.url(), r.resourceType())) {
      fontFailures.push(`${r.failure()?.errorText ?? 'failed'} ${r.url()}`);
    }
  });

  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 15_000 });

  const materialIcons = await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('24px "Material Icons"').catch(() => []);
    const faces: FontFace[] = [];
    document.fonts.forEach(face => faces.push(face));
    return faces
      .filter(face => face.family.replace(/["']/g, '') === 'Material Icons')
      .map(face => face.status);
  });
  expect(materialIcons, 'Material Icons font faces after the worker took control').toContain('loaded');
  expect(fontFailures, `font requests failed: ${fontFailures.join('; ')}`).toEqual([]);
});
