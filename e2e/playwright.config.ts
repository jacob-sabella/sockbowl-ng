import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['tests/**/*.spec.ts', 'usability.spec.ts', 'polish/**/*.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: './artifacts/output',
  reporter: [['list']],
  use: {
    // WP-E1's packet-builder.spec.ts (and the tests-auth/helpers/login.ts it
    // reuses) navigate with bare relative paths (page.goto('/packets'),
    // page.goto('/game-session')), unlike this file's older specs, which
    // build absolute URLs themselves from harness/config.ts's APP_URL. That
    // needs a baseURL here, defaulted the same way APP_URL is (SOCKBOWL_APP,
    // else the live deployment) so `m3:auth-on`/`m3:auth-off` can point it at
    // a local docker-compose stack per e2e/README.md's M3 section.
    baseURL: process.env.SOCKBOWL_APP || 'https://sockbowl.com',
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
      testMatch: ['tests/**/*.spec.ts', 'usability.spec.ts', 'polish/**/*.spec.ts'],
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
