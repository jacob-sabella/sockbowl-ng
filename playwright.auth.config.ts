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
 * Workers are pinned to 1: the specs share demo Keycloak accounts and, in
 * auth-ban.spec.ts and auth-refresh-logout.spec.ts, mutate shared server
 * state (bans, the access-token lifespan the stack was started with), so
 * parallel runs would race each other.
 */
const BASE_URL = process.env.SOCKBOWL_APP || 'http://localhost';

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
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
