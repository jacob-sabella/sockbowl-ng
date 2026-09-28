import { defineConfig } from '@playwright/test';
import { APP_URL } from './harness/config.js';

export default defineConfig({
  testDir: '.',
  testMatch: ['tests/**/*.spec.ts', 'usability.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: './artifacts/output',
  reporter: [['list']],
  // M4's rate-limit and admin-usage specs both mutate shared, server-side
  // state (Redis buckets, hosted-session quota, the Postgres `users` table)
  // scoped by keycloak id / IP, not by test file. Running them concurrently
  // lets one spec's requests count against the other's rate-limit/quota
  // budget, so this mirrors the same `fullyParallel: false` + `workers: 1`
  // pattern `playwright.auth.config.ts` already uses for the same reason.
  fullyParallel: false,
  workers: 1,
  use: {
    // M4 WP-E1's specs (and `tests-auth/helpers/login.ts`'s `loginAs`, which
    // they import) navigate with relative paths like `/game-session` and
    // `/admin/usage`; without a baseURL Playwright rejects those as invalid
    // URLs. Every other spec here already navigates with an absolute
    // `${APP_URL}/...` template literal, so this is additive only.
    baseURL: APP_URL,
    headless: true,
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
    screenshot: 'off',
  },
});
