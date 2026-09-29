import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the M2 authenticated e2e suite (WP-N5). Runs against
 * a full local stack (sockbowl-docker's docker-compose.yml + the dev/e2e
 * overlay, `AUTH_ENABLED=true`) rather than the "clips" gallery target in
 * playwright.config.ts, and against its own testDir so the two suites never
 * collide.
 *
 * Point SOCKBOWL_APP at the running stack's app origin (the nginx front
 * door), e.g.:
 *
 *   SOCKBOWL_APP=http://localhost npm run e2e:auth
 *
 * For the M7 §7 V1 rehearsal (SOCKBOWL_APP=https://sockbowl.jacobsabella.com
 * resolved to 127.0.0.1), PW_HOST_RESOLVER_RULES pins Chromium's resolver
 * (curl's --resolve, for a browser) and PW_IGNORE_HTTPS_ERRORS=1 is the
 * fallback when the local CA isn't trusted into Chromium's NSS DB.
 *
 * Workers are pinned to 1: the specs share demo Keycloak accounts and, in
 * auth-ban.spec.ts and auth-refresh-logout.spec.ts, mutate shared server
 * state (bans, the access-token lifespan the stack was started with), so
 * parallel runs would race each other.
 */
const BASE_URL = process.env.SOCKBOWL_APP || 'http://localhost';
const hostResolverRules = process.env.PW_HOST_RESOLVER_RULES;

export default defineConfig({
  testDir: './tests-auth',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'artifacts/m2-auth',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1100, height: 720 },
    ignoreHTTPSErrors: process.env.PW_IGNORE_HTTPS_ERRORS === '1',
    launchOptions: hostResolverRules
      ? { args: [`--host-resolver-rules=${hostResolverRules}`] }
      : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
