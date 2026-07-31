/**
 * End-to-end coverage of the plan's core acceptance tests.
 *
 * Captures are started by clicking the real popup, not by poking the service
 * worker: a service worker never receives its own `runtime.sendMessage`, and
 * driving the UI exercises the path a user actually takes. The popup is opened
 * as a background tab so the fixture page remains the active tab, which is what
 * `activeTab` resolves to.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures.js';
import type { BrowserContext, Page } from '@playwright/test';

type CaptureMode = 'element' | 'region' | 'fullPage' | 'document';

const MODE_LABELS: Record<CaptureMode, RegExp> = {
  element: /Select Element/,
  region: /Select Region/,
  fullPage: /Full Page/,
  document: /Clean Document/,
};

/** Opens the popup in a background tab, leaving `target` as the active tab. */
async function openPopup(context: BrowserContext, extensionId: string, target: Page): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  // Opening a tab makes it active, so the popup would otherwise report *itself*
  // as the page to capture. Bringing the fixture forward and reloading re-runs
  // the availability query against the tab a real toolbar popup would see.
  await target.bringToFront();
  await popup.reload();
  await expect(popup.getByRole('button', { name: MODE_LABELS.element })).toBeEnabled();

  // Input events still reach a background tab, so the fixture stays active.
  await target.bringToFront();
  return popup;
}

async function startCapture(popup: Page, mode: CaptureMode): Promise<void> {
  await popup.getByRole('button', { name: MODE_LABELS[mode] }).click();

  // Full Page asks for confirmation first when the long-page warning is on,
  // which is the default. Confirming here is part of the user's flow.
  const confirm = popup.getByRole('button', { name: 'Capture anyway' });
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
}

/** Reads extension storage from an extension page, which has `chrome` access. */
async function sessionStorageKeys(context: BrowserContext, extensionId: string): Promise<string[]> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  const keys = await page.evaluate(async () => {
    const all = await chrome.storage.session.get(null);
    return Object.keys(all);
  });
  await page.close();
  return keys;
}

test.describe('installation', () => {
  test('the popup offers the four capture modes as peers', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    for (const label of Object.values(MODE_LABELS)) {
      await expect(popup.getByRole('button', { name: label })).toBeVisible();
    }
  });

  test('the loaded build requests only the documented permissions', () => {
    const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8')) as {
      permissions: string[];
      host_permissions?: string[];
    };

    expect(new Set(manifest.permissions)).toEqual(
      new Set(['activeTab', 'scripting', 'storage', 'contextMenus']),
    );
    // The plan treats the debugger permission as a release blocker.
    expect(manifest.permissions).not.toContain('debugger');

    // This is the end-to-end build, which stands in for the `activeTab` grant
    // a toolbar click would give. tests/unit/manifest.test.ts asserts that the
    // shipped manifest declares no host permissions at all.
    expect(manifest.host_permissions ?? []).toEqual(['<all_urls>']);
  });
});

test.describe('element selection', () => {
  test('the overlay appears and Escape removes it completely', async ({ context, extensionId, fixtures }) => {
    const page = await context.newPage();
    await page.goto(fixtures.url('static-article.html'));

    const popup = await openPopup(context, extensionId, page);
    await startCapture(popup, 'element');

    // The overlay lives in a closed shadow root, so it is observed through its
    // host element rather than by querying inside it.
    await expect
      .poll(() => page.evaluate(() => document.getElementById('exactpdf-element-picker') !== null))
      .toBe(true);

    await page.bringToFront();
    await page.mouse.move(400, 300);
    await page.keyboard.press('Escape');

    await expect
      .poll(() => page.evaluate(() => document.getElementById('exactpdf-element-picker') !== null))
      .toBe(false);
  });

  test('cancelling leaves the page exactly as it was found', async ({ context, extensionId, fixtures }) => {
    const page = await context.newPage();
    await page.goto(fixtures.url('static-article.html'));
    const before = await snapshotPage(page);

    const popup = await openPopup(context, extensionId, page);
    await startCapture(popup, 'element');
    await expect
      .poll(() => page.evaluate(() => document.getElementById('exactpdf-element-picker') !== null))
      .toBe(true);

    await page.bringToFront();
    await page.mouse.move(400, 300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    expect(await snapshotPage(page)).toEqual(before);
  });

  test('selecting an element opens a preview', async ({ context, extensionId, fixtures }) => {
    const page = await context.newPage();
    await page.goto(fixtures.url('static-article.html'));

    const popup = await openPopup(context, extensionId, page);
    const previewPromise = context.waitForEvent('page');
    await startCapture(popup, 'element');

    await expect
      .poll(() => page.evaluate(() => document.getElementById('exactpdf-element-picker') !== null))
      .toBe(true);

    await page.bringToFront();
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.up();

    const preview = await previewPromise;
    await expect(preview.getByRole('heading', { name: 'Ready to save' })).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe('full page capture', () => {
  test('restores scroll position and sticky elements afterwards', async ({
    context,
    extensionId,
    fixtures,
  }) => {
    const page = await context.newPage();
    await page.goto(fixtures.url('complex-fixed.html'));
    await page.evaluate(() => {
      window.scrollTo(0, 900);
    });

    const popup = await openPopup(context, extensionId, page);
    const previewPromise = context.waitForEvent('page');
    await startCapture(popup, 'fullPage');

    const preview = await previewPromise;
    await expect(preview.getByRole('heading', { name: 'Ready to save' })).toBeVisible({
      timeout: 40_000,
    });

    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(900);
    expect(
      await page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>('.bar');
        return bar === null ? 'missing' : getComputedStyle(bar).visibility;
      }),
    ).toBe('visible');
    expect(await page.evaluate(() => document.getElementById('exactpdf-capture-style') !== null)).toBe(false);
  });

  test('downloads a PDF with a filesystem-safe name', async ({ context, extensionId, fixtures }) => {
    const page = await context.newPage();
    await page.goto(fixtures.url('static-article.html'));

    const popup = await openPopup(context, extensionId, page);
    const previewPromise = context.waitForEvent('page');
    await startCapture(popup, 'fullPage');

    const preview = await previewPromise;
    const save = preview.getByRole('button', { name: 'Save PDF' });
    await expect(save).toBeEnabled({ timeout: 40_000 });
    await expect(preview.locator('.preview__subtitle')).toContainText(/page/);

    const downloadPromise = preview.waitForEvent('download');
    await save.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    expect(download.suggestedFilename()).not.toMatch(/[<>:"/\\|?*]/);

    // Confirm the bytes really are a PDF, not an error page.
    const path = await download.path();
    expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('changing the page size changes the exported file', async ({ context, extensionId, fixtures }) => {
    const page = await context.newPage();
    await page.goto(fixtures.url('static-article.html'));

    const popup = await openPopup(context, extensionId, page);
    const previewPromise = context.waitForEvent('page');
    await startCapture(popup, 'fullPage');

    const preview = await previewPromise;
    await expect(preview.getByRole('button', { name: 'Save PDF' })).toBeEnabled({
      timeout: 40_000,
    });
    const originalPages = await preview.locator('.preview__subtitle').innerText();

    await preview.getByRole('radio', { name: 'A4' }).click();
    await expect(preview.getByRole('button', { name: 'Save PDF' })).toBeEnabled({
      timeout: 40_000,
    });

    await expect
      .poll(() => preview.locator('.preview__subtitle').innerText(), { timeout: 40_000 })
      .not.toBe(originalPages);
  });
});

test.describe('document mode', () => {
  test('offers no Exact switch, because there is no raster to show', async ({
    context,
    extensionId,
    fixtures,
  }) => {
    const page = await context.newPage();
    await page.goto(fixtures.url('static-article.html'));

    const popup = await openPopup(context, extensionId, page);
    const previewPromise = context.waitForEvent('page');
    await startCapture(popup, 'document');

    const preview = await previewPromise;
    await expect(preview.getByRole('heading', { name: 'Ready to save' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(preview.getByRole('radio', { name: 'Exact' })).toHaveCount(0);
    await expect(preview.getByRole('button', { name: 'Save PDF' })).toBeEnabled({
      timeout: 30_000,
    });
  });
});

test.describe('unsupported pages', () => {
  test('capture is disabled with an explanation', async ({ context, extensionId }) => {
    const blocked = await context.newPage();
    await blocked.goto('chrome://version');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await blocked.bringToFront();
    await popup.waitForTimeout(700);

    await expect(popup.getByRole('button', { name: MODE_LABELS.element })).toBeDisabled();
    await expect(popup.getByRole('status')).toContainText(/does not allow/i);
  });
});

test.describe('privacy', () => {
  test('nothing is sent off the machine during a capture', async ({ context, extensionId, fixtures }) => {
    const external: string[] = [];
    context.on('request', (request) => {
      const url = request.url();
      const local =
        url.startsWith(fixtures.origin) ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('data:') ||
        url.startsWith('blob:') ||
        url.startsWith('chrome://') ||
        url.startsWith('devtools://');
      if (!local) {
        external.push(url);
      }
    });

    const page = await context.newPage();
    await page.goto(fixtures.url('lms-page.html'));

    const popup = await openPopup(context, extensionId, page);
    const previewPromise = context.waitForEvent('page');
    await startCapture(popup, 'fullPage');

    const preview = await previewPromise;
    await expect(preview.getByRole('button', { name: 'Save PDF' })).toBeEnabled({
      timeout: 40_000,
    });

    expect(external).toEqual([]);
  });

  test('the capture is deleted from storage once the preview closes', async ({
    context,
    extensionId,
    fixtures,
  }) => {
    const page = await context.newPage();
    await page.goto(fixtures.url('static-article.html'));

    const popup = await openPopup(context, extensionId, page);
    const previewPromise = context.waitForEvent('page');
    await startCapture(popup, 'fullPage');

    const preview = await previewPromise;
    await expect(preview.getByRole('button', { name: 'Save PDF' })).toBeEnabled({
      timeout: 40_000,
    });

    const during = await sessionStorageKeys(context, extensionId);
    expect(during.some((key) => key.startsWith('exactpdf:session:'))).toBe(true);

    await preview.close();

    await expect
      .poll(
        async () => {
          const keys = await sessionStorageKeys(context, extensionId);
          return keys.filter((key) => key.startsWith('exactpdf:session:')).length;
        },
        { timeout: 15_000 },
      )
      .toBe(0);
  });
});

/** Everything about a page that a capture must leave untouched. */
async function snapshotPage(page: Page): Promise<unknown> {
  return page.evaluate(() => ({
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY),
    htmlStyle: document.documentElement.getAttribute('style') ?? '',
    injectedStyle: document.getElementById('exactpdf-capture-style') !== null,
    overlays: document.querySelectorAll('[id^="exactpdf-"]').length,
    bodyChildren: document.body.childElementCount,
  }));
}
