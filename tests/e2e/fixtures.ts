/**
 * Launches a real Chromium profile with the built extension installed.
 *
 * Chrome refuses to load extensions in headless mode and outside a persistent
 * context, so these tests need a browser binary on the machine. Playwright's
 * own Chromium is preferred; a locally installed Chromium-based browser is
 * accepted as a fallback so the suite is runnable without a large download.
 * When neither is available the tests skip rather than fail: a missing browser
 * is an environment gap, not a defect in the extension.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './fixtureServer.js';

const EXTENSION_PATH = resolve('dist');

/** Chromium-based browsers that can load an unpacked MV3 extension. */
const FALLBACK_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findBrowser(): string | undefined {
  try {
    const bundled = chromium.executablePath();
    if (bundled !== '' && existsSync(bundled)) {
      return bundled;
    }
  } catch {
    // Playwright's browsers were never downloaded; fall through.
  }
  return FALLBACK_BROWSERS.find((path) => existsSync(path));
}

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  fixtures: FixtureServer;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const browser = findBrowser();
    base.skip(browser === undefined, 'No Chromium-based browser available to load the extension.');
    base.skip(
      !existsSync(join(EXTENSION_PATH, 'manifest.json')),
      'dist/ is missing. Run `npm run build` first.',
    );

    const profile = await mkdtemp(join(tmpdir(), 'exactpdf-e2e-'));
    const context = await chromium.launchPersistentContext(profile, {
      // `base.skip` above guarantees this is defined by the time we get here.
      executablePath: browser ?? '',
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
        // A stable window size keeps tile counts deterministic across machines.
        '--window-size=1280,800',
      ],
      viewport: { width: 1280, height: 720 },
    });

    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    const existing = context.serviceWorkers()[0];
    const worker = existing ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  // eslint-disable-next-line no-empty-pattern
  fixtures: async ({}, use) => {
    const server = await startFixtureServer();
    await use(server);
    await server.close();
  },
});

export const expect = base.expect;
