/**
 * Coordinates a capture from the user's gesture to a preview tab.
 *
 * All the sequencing lives here rather than in the service worker entry point,
 * so the whole flow can be driven by a fake Chrome API in tests -- including
 * the paths that are awkward to reach in a real browser, such as a quota
 * rejection or a content script that never answers.
 */

import { captureVisual, type CanvasBackend } from '../capture/exact/visualCapture.js';
import type { SessionStore } from './sessionStore.js';
import { createSessionId } from './sessionStore.js';
import { isCapturableUrl } from '../shared/pageSupport.js';
import { createError, err, fromThrown, ok, type ExactPdfError, type Result } from '../shared/errors.js';
import type { ChromeApi } from '../shared/chrome/api.js';
import type { CaptureBounds, CaptureMode, CaptureSource, QualityPreset } from '../shared/types.js';

/** The content script each capture mode needs. */
const CONTENT_SCRIPTS: Record<CaptureMode, string> = {
  element: 'content/elementPicker.js',
  region: 'content/regionPicker.js',
  fullPage: 'content/pageController.js',
  document: 'content/documentExtractor.js',
};

/** Full-page and document modes also need the page controller for scrolling. */
const PAGE_CONTROLLER = 'content/pageController.js';

/** How long a selection overlay may sit unanswered before it is abandoned. */
const SELECTION_TIMEOUT_MS = 5 * 60 * 1000;

const DOCUMENT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

interface PendingSelection {
  readonly quality: QualityPreset;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

export interface OrchestratorDeps {
  readonly chrome: ChromeApi;
  readonly canvas: CanvasBackend;
  readonly sessions: SessionStore;
  readonly wait: (ms: number) => Promise<void>;
  readonly now: () => Date;
}

export class CaptureOrchestrator {
  /**
   * Selections in progress, keyed by session id. Held in memory only: if the
   * service worker is suspended while an overlay is open, the overlay's reply
   * restarts the worker and finds no entry, which is treated as an expired
   * session rather than a crash.
   */
  private readonly pending = new Map<string, PendingSelection>();

  constructor(private readonly deps: OrchestratorDeps) {}

  /** Describes whether the active tab can be captured, for the popup. */
  async getTabAvailability(): Promise<
    Result<{ supported: boolean; reason?: ExactPdfError; tabTitle: string; tabHost: string }>
  > {
    const tab = await this.deps.chrome.tabs.getActiveTab();
    if (tab === null) {
      return ok({ supported: false, reason: createError('UNSUPPORTED_PAGE'), tabTitle: '', tabHost: '' });
    }
    const supported = isCapturableUrl(tab.url);
    let host = '';
    try {
      host = new URL(tab.url).hostname;
    } catch {
      host = '';
    }

    return ok(
      supported
        ? { supported, tabTitle: tab.title, tabHost: host }
        : { supported, reason: createError('UNSUPPORTED_PAGE'), tabTitle: tab.title, tabHost: host },
    );
  }

  /**
   * Begins a capture.
   *
   * Element and region modes return as soon as the overlay is live, because the
   * user has not chosen anything yet; the flow resumes in
   * {@link completeSelection}. Full-page and document modes run to completion
   * here, since there is nothing further to ask the user.
   */
  async startCapture(mode: CaptureMode, quality: QualityPreset): Promise<Result<{ sessionId: string }>> {
    const tab = await this.deps.chrome.tabs.getActiveTab();
    if (tab === null || !isCapturableUrl(tab.url)) {
      return err(createError('UNSUPPORTED_PAGE'));
    }

    const sessionId = createSessionId();
    const source: CaptureSource = {
      url: tab.url,
      title: tab.title,
      capturedAt: this.deps.now().toISOString(),
      contentLabel: defaultContentLabel(mode),
    };

    const created = await this.deps.sessions.create({ id: sessionId, mode, tabId: tab.id, source });
    if (!created.ok) {
      return created;
    }

    const injected = await this.injectFor(mode, tab.id);
    if (!injected.ok) {
      await this.deps.sessions.release(sessionId);
      return injected;
    }

    if (mode === 'element' || mode === 'region') {
      const started = await this.deps.chrome.tabs.sendCommand(tab.id, {
        type: 'beginSelection',
        sessionId,
      });
      if (!started.ok) {
        await this.deps.sessions.release(sessionId);
        return started;
      }

      this.pending.set(sessionId, {
        quality,
        timeoutId: setTimeout(() => {
          void this.abandonSelection(sessionId, tab.id);
        }, SELECTION_TIMEOUT_MS),
      });
      return ok({ sessionId });
    }

    const finished =
      mode === 'document'
        ? await this.runDocumentCapture(sessionId, tab.id)
        : await this.runFullPageCapture(sessionId, tab.id, tab.windowId, quality);

    if (!finished.ok) {
      await this.deps.sessions.release(sessionId);
      return finished;
    }
    await this.openPreview(sessionId);
    return ok({ sessionId });
  }

  /** Resumes an element or region capture once the user has chosen. */
  async completeSelection(input: {
    sessionId: string;
    bounds: CaptureBounds;
    contentLabel: string;
    devicePixelRatio: number;
  }): Promise<Result<{ acknowledged: true }>> {
    const pending = this.pending.get(input.sessionId);
    this.clearPending(input.sessionId);

    const stored = await this.deps.sessions.read(input.sessionId);
    if (!stored.ok) {
      return stored;
    }
    const { session } = stored.value;
    const tab = await this.deps.chrome.tabs.getActiveTab();

    // The page controller handles the scrolling for selections taller than the
    // viewport; the picker script alone cannot scroll.
    const injected = await this.injectScript(session.tabId, PAGE_CONTROLLER);
    if (!injected.ok) {
      return injected;
    }

    const captured = await captureVisual(
      { tabs: this.deps.chrome.tabs, canvas: this.deps.canvas, wait: this.deps.wait },
      {
        sessionId: input.sessionId,
        tabId: session.tabId,
        windowId: tab?.windowId ?? 0,
        bounds: input.bounds,
        quality: pending?.quality ?? 'balanced',
        devicePixelRatio: input.devicePixelRatio,
        fullPage: false,
        autoCrop: true,
      },
    );
    if (!captured.ok) {
      await this.deps.sessions.release(input.sessionId);
      return captured;
    }

    const attached = await this.deps.sessions.attachPayload(
      input.sessionId,
      captured.value.payload,
      warningFor(captured.value.payload.mayBeIncomplete),
    );
    if (!attached.ok) {
      return attached;
    }

    await this.updateContentLabel(input.sessionId, input.contentLabel);
    await this.openPreview(input.sessionId);
    return ok({ acknowledged: true });
  }

  async cancelSelection(sessionId: string): Promise<Result<{ acknowledged: true }>> {
    this.clearPending(sessionId);
    await this.deps.sessions.release(sessionId);
    return ok({ acknowledged: true });
  }

  private async runFullPageCapture(
    sessionId: string,
    tabId: number,
    windowId: number,
    quality: QualityPreset,
  ): Promise<Result<{ acknowledged: true }>> {
    const prepared = await this.deps.chrome.tabs.sendCommand(tabId, { type: 'preparePage', sessionId });
    if (!prepared.ok) {
      return prepared;
    }

    const captured = await captureVisual(
      { tabs: this.deps.chrome.tabs, canvas: this.deps.canvas, wait: this.deps.wait },
      {
        sessionId,
        tabId,
        windowId,
        bounds: { x: 0, y: 0, width: prepared.value.pageWidth, height: prepared.value.pageHeight },
        quality,
        devicePixelRatio: prepared.value.devicePixelRatio,
        fullPage: true,
        // A full page is by definition the whole page; trimming its edges would
        // silently change what "Full Page" means.
        autoCrop: false,
      },
    );
    if (!captured.ok) {
      return captured;
    }

    const attached = await this.deps.sessions.attachPayload(
      sessionId,
      captured.value.payload,
      warningFor(captured.value.payload.mayBeIncomplete),
    );
    return attached.ok ? ok({ acknowledged: true }) : attached;
  }

  private async runDocumentCapture(
    sessionId: string,
    tabId: number,
  ): Promise<Result<{ acknowledged: true }>> {
    const extracted = await this.deps.chrome.tabs.sendCommand(tabId, {
      type: 'extractDocument',
      sessionId,
      maxImageBytes: DOCUMENT_MAX_IMAGE_BYTES,
    });
    if (!extracted.ok) {
      return extracted;
    }

    const attached = await this.deps.sessions.attachPayload(sessionId, extracted.value, null);
    return attached.ok ? ok({ acknowledged: true }) : attached;
  }

  private async injectFor(mode: CaptureMode, tabId: number): Promise<Result<true>> {
    const injected = await this.injectScript(tabId, CONTENT_SCRIPTS[mode]);
    if (!injected.ok) {
      return injected;
    }
    if (mode === 'fullPage' || mode === 'document') {
      // Document mode still needs the controller: its images are primed by the
      // same lazy-loading pass full-page capture uses.
      const controller = await this.injectScript(tabId, PAGE_CONTROLLER);
      if (!controller.ok) {
        return controller;
      }
    }
    return ok(true);
  }

  private async injectScript(tabId: number, file: string): Promise<Result<true>> {
    try {
      await this.deps.chrome.scripting.injectFile(tabId, file);
      return ok(true);
    } catch (thrown) {
      return err(fromThrown(thrown, 'UNSUPPORTED_PAGE'));
    }
  }

  /**
   * Replaces the mode's generic label ("Element") with what the user actually
   * picked ("Table", "Image"), so the suggested filename describes the content.
   */
  private async updateContentLabel(sessionId: string, contentLabel: string): Promise<void> {
    const stored = await this.deps.sessions.read(sessionId);
    if (!stored.ok) {
      return;
    }
    await this.deps.sessions.updateSource(sessionId, {
      ...stored.value.session.source,
      contentLabel,
    });
  }

  private async openPreview(sessionId: string): Promise<void> {
    const url = this.deps.chrome.runtime.getUrl(`src/preview/index.html?session=${sessionId}`);
    await this.deps.chrome.tabs.create(url);
  }

  private clearPending(sessionId: string): void {
    const pending = this.pending.get(sessionId);
    if (pending !== undefined) {
      clearTimeout(pending.timeoutId);
      this.pending.delete(sessionId);
    }
  }

  private async abandonSelection(sessionId: string, tabId: number): Promise<void> {
    this.clearPending(sessionId);
    await this.deps.sessions.release(sessionId);
    await this.deps.chrome.tabs
      .sendCommand(tabId, { type: 'abortSelection', sessionId })
      .catch(() => undefined);
  }
}

function defaultContentLabel(mode: CaptureMode): string {
  switch (mode) {
    case 'element':
      return 'Element';
    case 'region':
      return 'Region';
    case 'fullPage':
      return 'Page';
    case 'document':
      return 'Article';
  }
}

function warningFor(mayBeIncomplete: boolean): ExactPdfError | null {
  return mayBeIncomplete ? createError('PARTIAL_LAZY_CONTENT') : null;
}
