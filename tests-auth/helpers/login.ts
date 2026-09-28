import type { Page } from '@playwright/test';

// Only `import type` is used from @playwright/test above (WP-N5 contract):
// M3 (E1) and M4 (E1) import this file from a *separate* `e2e/` npm package
// as `../../tests-auth/helpers/login`, and a runtime import here would pull
// in a second copy of Playwright when that package's own `@playwright/test`
// loads. Every spec in tests-auth/ imports `test`/`expect` itself as usual.

/** Password for every demo Keycloak account (sockbowl-docker's rbac-model.json demoUsers). */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo123';

/**
 * Logs in as a demo Keycloak user through the real hosted login page: the
 * navbar's "Sign In" button starts the authorization-code+PKCE redirect, and
 * the sockbowl realm's login theme uses the stock field ids (`#username`,
 * `#password`, `#kc-login` — verified against `keycloak/themes/sockbowl` per
 * the plan's risk #11). Resolves once the app has navigated back and the
 * navbar shows the signed-in user's name.
 *
 * Always starts from `/game-session` so the "Sign In" button is present
 * regardless of what the page was showing before.
 */
export async function loginAs(page: Page, username: string, password: string = DEMO_PASSWORD): Promise<void> {
  await page.goto('/game-session');
  await page.getByRole('button', { name: /Sign In/ }).click();

  await page.waitForURL('**/realms/sockbowl/protocol/openid-connect/auth**', { timeout: 20_000 });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();

  await page.waitForURL('**/game-session**', { timeout: 20_000 });
  await page.locator('.navbar__account-trigger').waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Logs the current page out (revokes tokens, ends the Keycloak session) via
 * the navbar's "Logout" button. Resolves once the browser has landed back on
 * `postLogoutRedirectUri` (`/game-session` in the app, not a Keycloak page).
 */
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Logout/ }).click();
  await page.waitForURL('**/game-session**', { timeout: 20_000 });
}

/**
 * The signed-in user's current access token, as angular-oauth2-oidc stores it
 * (sessionStorage, the library default — see plan decision P6). Null if
 * nobody is signed in on this page.
 */
export async function getAccessToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    try {
      return window.sessionStorage.getItem('access_token');
    } catch {
      return null;
    }
  });
}

/**
 * The signed-in user's Keycloak id (the `sub` claim), read from the game
 * backend's `/api/v1/auth/me` with the page's own access token. Used by
 * auth-ban.spec.ts, which needs a real `sub` to ban rather than a hand-typed
 * placeholder.
 */
export async function getKeycloakId(page: Page, apiBaseUrl: string): Promise<string> {
  const token = await getAccessToken(page);
  if (!token) {
    throw new Error('getKeycloakId: no access token on this page (is the user signed in?)');
  }
  const response = await page.request.get(`${apiBaseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    throw new Error(`getKeycloakId: /api/v1/auth/me returned ${response.status()}`);
  }
  const body = await response.json();
  return body.keycloakId as string;
}

/** The app's `window.__env.apiBaseUrl` (the game backend origin), read from a loaded page. */
export async function getApiBaseUrl(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__env?.apiBaseUrl || 'http://localhost:7000');
}
