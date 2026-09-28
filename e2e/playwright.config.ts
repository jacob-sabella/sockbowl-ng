import { defineConfig } from '@playwright/test';
import { APP_URL } from './harness/config.js';

export default defineConfig({
  testDir: '.',
  testMatch: ['tests/**/*.spec.ts', 'usability.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: './artifacts/output',
  reporter: [['list']],
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
