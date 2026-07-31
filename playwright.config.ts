import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests load the built extension into a real Chromium profile.
 *
 * Extensions only work in a persistent context with a visible browser, so these
 * cannot run headless and are kept out of `npm test`. Run them with
 * `npm run test:e2e` after `npm run build`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    // The fixture pages are served from disk by the test itself.
    trace: 'retain-on-failure',
  },
});
