import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['tests/**/*.spec.ts', 'usability.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: './artifacts/output',
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
    screenshot: 'off',
  },
});
