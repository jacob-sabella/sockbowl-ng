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
