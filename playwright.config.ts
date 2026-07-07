import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the "clips" UI-test gallery. Runs against the deployed
 * site (same-origin, so the real WebSocket + REST backends all work); CLIPS=1
 * records a small webm per test that scripts/build-clips.mjs packages into
 * src/assets/test-clips/.
 */
const BASE_URL = process.env.CLIPS_BASE_URL || 'https://sockbowl.com';

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
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
