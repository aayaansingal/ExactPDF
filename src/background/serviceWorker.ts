/**
 * Manifest V3 service worker: the extension's event entry point.
 *
 * Every handler is registered synchronously at the top level. Chrome suspends
 * and restarts this worker freely, and a listener added inside a promise
 * callback would be missing on the restart that the event itself triggered.
 */

import { CaptureOrchestrator } from './captureOrchestrator.js';
import { SessionStore } from './sessionStore.js';
import { offscreenCanvasBackend } from '../capture/exact/offscreenCanvas.js';
import { chromeApi } from '../shared/chrome/chromeApi.js';
import { createError, err, fromThrown, ok, type Result } from '../shared/errors.js';
import { migrateSettings, type Settings } from '../shared/settings.js';
import { STORAGE_KEYS } from '../shared/constants.js';
import type { ExtensionRequest } from '../shared/messages.js';

const sessions = new SessionStore(chromeApi.sessionStorage);

const orchestrator = new CaptureOrchestrator({
  chrome: chromeApi,
  canvas: offscreenCanvasBackend,
  sessions,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
});

async function readSettings(): Promise<Settings> {
  return migrateSettings(await chromeApi.localStorage.get(STORAGE_KEYS.settings));
}

async function handle(request: ExtensionRequest): Promise<Result<unknown>> {
  switch (request.type) {
    case 'getTabAvailability':
      return orchestrator.getTabAvailability();

    case 'startCapture': {
      const settings = await readSettings();
      await chromeApi.localStorage.set(STORAGE_KEYS.settings, {
        ...settings,
        lastCaptureMode: request.mode,
      });
      return orchestrator.startCapture(request.mode, request.quality);
    }

    case 'selectionComplete':
      return orchestrator.completeSelection({
        sessionId: request.sessionId,
        bounds: request.bounds,
        contentLabel: request.contentLabel,
        devicePixelRatio: request.devicePixelRatio,
      });

    case 'selectionCancelled':
      return orchestrator.cancelSelection(request.sessionId);

    case 'getSession': {
      const stored = await sessions.read(request.sessionId);
      if (!stored.ok) {
        return stored;
      }
      if (stored.value.payload === null) {
        return err(createError('SESSION_EXPIRED', 'payload not attached'));
      }
      return ok({
        source: stored.value.session.source,
        mode: stored.value.session.mode,
        payload: stored.value.payload,
        ...(stored.value.warning === null ? {} : { warning: stored.value.warning }),
      });
    }

    case 'releaseSession':
      await sessions.release(request.sessionId);
      return ok({ acknowledged: true });

    case 'retryCapture': {
      const stored = await sessions.read(request.sessionId);
      if (!stored.ok) {
        return stored;
      }
      await sessions.release(request.sessionId);
      return orchestrator.startCapture(stored.value.session.mode, request.quality);
    }
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((thrown: unknown) => {
      sendResponse(err(fromThrown(thrown)));
    });
  // Keeps the message channel open for the asynchronous reply.
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void sessions.pruneExpired();

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'exactpdf-capture-element',
      title: 'Save selected element as PDF',
      contexts: ['page', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'exactpdf-capture-image',
      title: 'Save image as PDF',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: 'exactpdf-capture-page',
      title: 'Save complete page as PDF',
      contexts: ['page'],
    });
  });
});

// A restart leaves any capture that was mid-flight unreachable; clearing them
// keeps session storage from accumulating orphaned screenshots.
chrome.runtime.onStartup.addListener(() => {
  void sessions.pruneExpired();
});

// Closing a preview tab releases its capture, even if the page's own release
// message was lost while the tab was being torn down.
chrome.tabs.onRemoved.addListener((tabId) => {
  void sessions.releaseForPreviewTab(tabId);
});

chrome.contextMenus.onClicked.addListener((info) => {
  void (async () => {
    const settings = await readSettings();
    switch (info.menuItemId) {
      case 'exactpdf-capture-element':
      case 'exactpdf-capture-image':
        await orchestrator.startCapture('element', settings.defaultQuality);
        return;
      case 'exactpdf-capture-page':
        await orchestrator.startCapture('fullPage', settings.defaultQuality);
        return;
      default:
    }
  })();
});

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    const settings = await readSettings();
    if (command === 'capture-element') {
      await orchestrator.startCapture('element', settings.defaultQuality);
    } else if (command === 'capture-region') {
      await orchestrator.startCapture('region', settings.defaultQuality);
    }
  })();
});
