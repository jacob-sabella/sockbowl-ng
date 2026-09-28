/**
 * M5 H0: intercepts `/assets/config.js` and serves a `window.__env` that
 * points every backend at an unroutable mock origin, so the app under test
 * never touches a real network (M5 plan §4). Everything those origins would
 * answer is instead fulfilled by `mock/rest.ts`, `mock/graphql.ts` and
 * `mock/oidc.ts` via `page.route`.
 */
import type { BrowserContext, Page } from '@playwright/test';

/** Unroutable-by-design mock origins (M5 plan §4). Never resolve on a real network. */
export const MOCK_GAME_ORIGIN = 'http://mock-game.test';
export const MOCK_QUESTIONS_ORIGIN = 'http://mock-questions.test';
export const MOCK_KC_ORIGIN = 'http://mock-kc.test';
export const MOCK_WS_URL = 'ws://mock-game.test/sockbowl-game';
export const MOCK_ISSUER = `${MOCK_KC_ORIGIN}/realms/sockbowl`;

export interface MockConfigOptions {
  /** Auth axis (M5 plan §2). Off: every permission is granted, no OIDC involved. */
  authEnabled: boolean;
}

/**
 * Registers the `/assets/config.js` route. Call before `page.goto`. Safe to
 * call on a `BrowserContext` (applies to every page it opens) or a `Page`.
 */
export async function mockConfig(target: Page | BrowserContext, opts: MockConfigOptions): Promise<void> {
  const body = `// M5 H0 mocked runtime config — e2e/polish/mock/config.ts
window.__env = {
  apiBaseUrl: '${MOCK_GAME_ORIGIN}',
  sockbowlGameApiUrl: '${MOCK_GAME_ORIGIN}/api/v1/session',
  sockbowlQuestionsApiUrl: '${MOCK_QUESTIONS_ORIGIN}/',
  wsUrl: '${MOCK_WS_URL}',
  authEnabled: ${opts.authEnabled ? 'true' : 'false'},
  keycloak: {
    issuer: '${MOCK_ISSUER}',
    clientId: 'sockbowl-game',
    redirectUri: window.location.origin + '/game-session',
    scope: 'openid profile email',
    responseType: 'code',
    showDebugInformation: false,
    requireHttps: false,
    postLogoutRedirectUri: window.location.origin + '/game-session'
  }
};`;
  await target.route('**/assets/config.js', route =>
    route.fulfill({ contentType: 'application/javascript', body }));
}
