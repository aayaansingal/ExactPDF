/**
 * Full Page mode's page-side half.
 *
 * The service worker owns the screenshot loop because only it can call
 * `chrome.tabs.captureVisibleTab`; this script does everything that requires
 * being inside the page -- measuring, scrolling, coaxing lazy content into
 * loading, hiding repeated sticky elements, and putting everything back.
 */

import { documentBounds } from './lib/dom.js';
import { claimInjectionSlot } from './lib/messaging.js';
import { PageState } from './lib/pageState.js';
import { MAX_PAGE_HEIGHT_CSS_PX } from '../shared/constants.js';
import { err, fromThrown, ok, type Result } from '../shared/errors.js';
import type {
  ContentCommand,
  PreparePageResult,
  PrimeLazyContentResult,
  ScrollToTileResult,
} from '../shared/messages.js';

const SLOT = 'pageController';

/** How long to wait for the browser to settle after a programmatic scroll. */
const SCROLL_SETTLE_MS = 120;

/** Distance scrolled per step while priming lazy content, as a viewport fraction. */
const PRIME_STEP_RATIO = 0.8;

const state = new PageState();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves after the next paint, so measurements reflect the new scroll offset. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

function preparePage(): Result<PreparePageResult> {
  try {
    state.freeze();
    const page = documentBounds();
    return ok({
      // Capping here rather than refusing outright means an endless feed still
      // produces the document the user asked for, just with a defined end.
      pageWidth: page.width,
      pageHeight: Math.min(page.height, MAX_PAGE_HEIGHT_CSS_PX),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    });
  } catch (thrown) {
    return err(fromThrown(thrown, 'CAPTURE_FAILED'));
  }
}

async function scrollToTile(
  x: number,
  y: number,
  hideFixedElements: boolean,
): Promise<Result<ScrollToTileResult>> {
  try {
    // Fixed elements are collected before the first scroll, while the page is
    // still where the user left it: some headers only become `position: fixed`
    // after scrolling, and hiding those would remove content from tile one.
    if (hideFixedElements) {
      state.hideFixedElements();
    } else {
      state.showFixedElements();
    }

    window.scrollTo({ left: x, top: y, behavior: 'auto' });
    await nextFrame();
    await delay(SCROLL_SETTLE_MS);

    return ok({ scrollX: window.scrollX, scrollY: window.scrollY });
  } catch (thrown) {
    return err(fromThrown(thrown, 'CAPTURE_FAILED'));
  }
}

/**
 * Scrolls the page once from top to bottom to trigger lazy loading, then
 * returns to the top.
 *
 * The wait is bounded on purpose: an infinite feed will never report "done", so
 * the capture proceeds with whatever loaded and the result is flagged as
 * possibly incomplete rather than hanging.
 */
async function primeLazyContent(maxDurationMs: number): Promise<Result<PrimeLazyContentResult>> {
  const deadline = Date.now() + maxDurationMs;
  try {
    state.freeze();
    state.showFixedElements();

    const step = Math.max(200, window.innerHeight * PRIME_STEP_RATIO);
    let position = 0;
    let incomplete = false;

    for (;;) {
      window.scrollTo({ left: 0, top: position, behavior: 'auto' });
      await nextFrame();

      if (Date.now() > deadline) {
        incomplete = true;
        break;
      }

      const height = Math.min(documentBounds().height, MAX_PAGE_HEIGHT_CSS_PX);
      if (position + window.innerHeight >= height) {
        break;
      }
      position += step;
    }

    const settled = await waitForImages(deadline);
    window.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    await nextFrame();

    return ok({
      incomplete: incomplete || !settled,
      pageHeight: Math.min(documentBounds().height, MAX_PAGE_HEIGHT_CSS_PX),
    });
  } catch (thrown) {
    return err(fromThrown(thrown, 'CAPTURE_FAILED'));
  }
}

/** Waits for in-flight images to decode, giving up at the shared deadline. */
async function waitForImages(deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    const pending = Array.from(document.images).filter(
      (image) => !image.complete && image.getAttribute('src') !== null,
    );
    if (pending.length === 0) {
      return true;
    }
    await delay(150);
  }
  return false;
}

if (claimInjectionSlot(`${SLOT}Listener`)) {
  chrome.runtime.onMessage.addListener(
    (message: ContentCommand, _sender, sendResponse: (response: Result<unknown>) => void) => {
      switch (message.type) {
        case 'preparePage':
          sendResponse(preparePage());
          return false;

        case 'scrollToTile':
          void scrollToTile(message.x, message.y, message.hideFixedElements).then(sendResponse);
          return true;

        case 'primeLazyContent':
          void primeLazyContent(message.maxDurationMs).then(sendResponse);
          return true;

        case 'restorePage':
          state.restore();
          sendResponse(ok({ restored: true }));
          return false;

        default:
          // Other content scripts share this frame and register their own
          // listeners. Answering a command this script does not own would win
          // the race against the script that does and fail the capture, so
          // unknown commands are left entirely alone.
          return false;
      }
    },
  );

  // A navigation or reload mid-capture would otherwise leave the page frozen.
  window.addEventListener('pagehide', () => {
    state.restore();
  });
}
