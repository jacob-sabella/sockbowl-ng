import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the "clips" UI-test gallery. Runs against the deployed
 * site (same-origin, so the real WebSocket + REST backends all work); CLIPS=1
 * records a small webm per test that scripts/build-clips.mjs packages into
 * src/assets/test-clips/.
 */
// M7 H10: default to a local docker-compose stack rather than a real
// cross-origin production host. CLIPS_BASE_URL still overrides for a
// deployed target, e.g. https://sockbowl.jacobsabella.com in path mode --
// this suite only needs the app's own origin (it runs same-origin against
// whatever backend that origin proxies to), so no separate path-mode
// derivation is needed here (contrast tests/bonus.spec.ts, which calls the
// questions GraphQL API directly).
const BASE_URL = process.env.CLIPS_BASE_URL || 'http://localhost';

// M7 §3.1 item 4 / §7 step 7: point Chromium's own resolver at a throwaway
// compose stack's public hostname (curl's --resolve, for a browser) and
// optionally relax TLS trust when a real CA isn't set up locally.
const hostResolverRules = process.env.PW_HOST_RESOLVER_RULES;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // CLIPS=1 records a small video per test for the in-app gallery. Off for normal runs.
    video: process.env.CLIPS ? { mode: 'on', size: { width: 900, height: 560 } } : 'off',
    viewport: { width: 900, height: 560 },
    ignoreHTTPSErrors: process.env.PW_IGNORE_HTTPS_ERRORS === '1',
    launchOptions: hostResolverRules
      ? { args: [`--host-resolver-rules=${hostResolverRules}`] }
      : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
