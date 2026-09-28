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
    // M4 WP-E1's specs and M3 WP-E1's packet-builder.spec.ts (and
    // `tests-auth/helpers/login.ts`'s `loginAs`, which they import) navigate
    // with relative paths like `/game-session`, `/admin/usage` and `/packets`;
    // without a baseURL Playwright rejects those as invalid URLs. The older
    // specs build absolute `${APP_URL}/...` URLs themselves, so this is
    // additive only. APP_URL is SOCKBOWL_APP, else the live deployment, so
    // `m3:auth-on`/`m3:auth-off` can point it at a local docker-compose stack
    // per e2e/README.md's M3 section.
    baseURL: APP_URL,
    headless: true,
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
    screenshot: 'off',
  },
  // M3 plan WP-E1: `tests/packet-builder.spec.ts` runs once per auth posture,
  // each against its own stack bring-up (AUTH_ENABLED is stack-wide, so the
  // two postures can't share one running stack — see e2e/README.md's M3
  // section). Every other existing spec keeps running under `default`, once,
  // same as before this project split existed.
  projects: [
    {
      name: 'default',
      testMatch: ['tests/**/*.spec.ts', 'usability.spec.ts'],
      testIgnore: ['tests/packet-builder.spec.ts'],
    },
    {
      name: 'm3-auth-off',
      testMatch: 'tests/packet-builder.spec.ts',
    },
    {
      name: 'm3-auth-on',
      testMatch: 'tests/packet-builder.spec.ts',
    },
  ],
});
