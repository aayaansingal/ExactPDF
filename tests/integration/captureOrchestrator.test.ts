import { beforeEach, describe, expect, it } from 'vitest';
import { CaptureOrchestrator } from '../../src/background/captureOrchestrator.js';
import { SessionStore } from '../../src/background/sessionStore.js';
import { createError, err, ok } from '../../src/shared/errors.js';
import { FakeCanvasBackend, FakeChromeApi } from './fakes/chromeApi.js';
import type { CanvasBackend } from '../../src/capture/exact/visualCapture.js';

const NOW = new Date('2026-07-23T12:00:00.000Z');

/** A page controller that answers every command the way a real page would. */
function wireHealthyPage(chrome: FakeChromeApi): FakeChromeApi {
  return chrome
    .on('preparePage', () =>
      ok({
        pageWidth: 1280,
        pageHeight: 3000,
        viewportWidth: 1280,
        viewportHeight: 720,
        devicePixelRatio: 2,
      }),
    )
    .on('scrollToTile', (command) =>
      ok({
        scrollX: command.type === 'scrollToTile' ? command.x : 0,
        scrollY: command.type === 'scrollToTile' ? command.y : 0,
      }),
    )
    .on('primeLazyContent', () => ok({ incomplete: false, pageHeight: 3000 }))
    .on('restorePage', () => ok({ restored: true }))
    .on('beginSelection', () => ok({ started: true }))
    .on('abortSelection', () => ok({ aborted: true }));
}

function build(chrome: FakeChromeApi): {
  orchestrator: CaptureOrchestrator;
  sessions: SessionStore;
  canvas: FakeCanvasBackend;
} {
  const sessions = new SessionStore(chrome.sessionStorage);
  const canvas = new FakeCanvasBackend();
  const orchestrator = new CaptureOrchestrator({
    chrome,
    canvas: canvas as unknown as CanvasBackend,
    sessions,
    wait: async () => undefined,
    now: () => NOW,
  });
  return { orchestrator, sessions, canvas };
}

describe('tab availability', () => {
  it('reports an ordinary page as capturable', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    const { orchestrator } = build(chrome);

    const result = await orchestrator.getTabAvailability();
    expect(result.ok && result.value.supported).toBe(true);
    expect(result.ok && result.value.tabHost).toBe('example.com');
  });

  it('explains why a browser-internal page cannot be captured', async () => {
    const chrome = new FakeChromeApi({ tab: { url: 'chrome://settings' } });
    const { orchestrator } = build(chrome);

    const result = await orchestrator.getTabAvailability();
    expect(result.ok && result.value.supported).toBe(false);
    expect(result.ok && result.value.reason?.code).toBe('UNSUPPORTED_PAGE');
  });

  it('handles there being no active tab', async () => {
    const chrome = new FakeChromeApi();
    chrome.setActiveTab(null);
    const { orchestrator } = build(chrome);

    const result = await orchestrator.getTabAvailability();
    expect(result.ok && result.value.supported).toBe(false);
  });
});

describe('element capture', () => {
  let chrome: FakeChromeApi;

  beforeEach(() => {
    chrome = wireHealthyPage(new FakeChromeApi());
  });

  it('injects only the element picker and starts the overlay', async () => {
    const { orchestrator } = build(chrome);
    const started = await orchestrator.startCapture('element', 'balanced');

    expect(started.ok).toBe(true);
    expect(chrome.injected).toEqual(['content/elementPicker.js']);
    expect(chrome.commandsOfType('beginSelection')).toHaveLength(1);
  });

  it('does not open a preview until the user has selected something', async () => {
    const { orchestrator } = build(chrome);
    await orchestrator.startCapture('element', 'balanced');
    expect(chrome.createdTabs).toEqual([]);
  });

  it('captures, stores and previews once a selection arrives', async () => {
    const { orchestrator, sessions } = build(chrome);
    const started = await orchestrator.startCapture('element', 'balanced');
    const sessionId = started.ok ? started.value.sessionId : '';

    const completed = await orchestrator.completeSelection({
      sessionId,
      bounds: { x: 10, y: 20, width: 400, height: 300 },
      contentLabel: 'Table',
      devicePixelRatio: 2,
    });

    expect(completed.ok).toBe(true);
    expect(chrome.createdTabs[0]).toContain(`session=${sessionId}`);

    const stored = await sessions.read(sessionId);
    expect(stored.ok && stored.value.payload?.kind).toBe('visual');
    // The fake opens every tab with id 99; closing it must release the capture.
    expect(stored.ok && stored.value.previewTabId).toBe(99);
  });

  it('records what the user picked so the filename describes it', async () => {
    const { orchestrator, sessions } = build(chrome);
    const started = await orchestrator.startCapture('element', 'balanced');
    const sessionId = started.ok ? started.value.sessionId : '';

    await orchestrator.completeSelection({
      sessionId,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      contentLabel: 'Image',
      devicePixelRatio: 1,
    });

    const stored = await sessions.read(sessionId);
    expect(stored.ok && stored.value.session.source.contentLabel).toBe('Image');
  });

  it('restores the page after a successful capture', async () => {
    const { orchestrator } = build(chrome);
    const started = await orchestrator.startCapture('element', 'balanced');
    await orchestrator.completeSelection({
      sessionId: started.ok ? started.value.sessionId : '',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      contentLabel: 'Image',
      devicePixelRatio: 1,
    });

    expect(chrome.commandsOfType('restorePage').length).toBeGreaterThanOrEqual(1);
  });

  it('restores the page even when the capture fails', async () => {
    chrome.on('scrollToTile', () => err(createError('CAPTURE_FAILED')));
    const { orchestrator } = build(chrome);
    const started = await orchestrator.startCapture('element', 'balanced');

    const completed = await orchestrator.completeSelection({
      sessionId: started.ok ? started.value.sessionId : '',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      contentLabel: 'Image',
      devicePixelRatio: 1,
    });

    expect(completed.ok).toBe(false);
    expect(chrome.commandsOfType('restorePage').length).toBeGreaterThanOrEqual(1);
  });

  it('discards the session when the user cancels', async () => {
    const { orchestrator, sessions } = build(chrome);
    const started = await orchestrator.startCapture('element', 'balanced');
    const sessionId = started.ok ? started.value.sessionId : '';

    await orchestrator.cancelSelection(sessionId);

    expect((await sessions.read(sessionId)).ok).toBe(false);
    expect(chrome.createdTabs).toEqual([]);
  });

  it('reports an expired session when a selection arrives too late', async () => {
    const { orchestrator } = build(chrome);
    const completed = await orchestrator.completeSelection({
      sessionId: 'never-existed',
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      contentLabel: 'Image',
      devicePixelRatio: 1,
    });

    expect(completed.ok).toBe(false);
    if (!completed.ok) {
      expect(completed.error.code).toBe('SESSION_EXPIRED');
    }
  });
});

describe('unsupported pages', () => {
  it('refuses to start on a page Chrome blocks', async () => {
    const chrome = new FakeChromeApi({ tab: { url: 'chrome://extensions' } });
    const { orchestrator } = build(chrome);

    const started = await orchestrator.startCapture('element', 'balanced');
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.code).toBe('UNSUPPORTED_PAGE');
    }
    expect(chrome.injected).toEqual([]);
  });

  it('cleans up the session when injection is refused', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi({ injectionFailures: ['content/elementPicker.js'] }));
    const { orchestrator } = build(chrome);

    const started = await orchestrator.startCapture('element', 'balanced');
    expect(started.ok).toBe(false);
    expect(chrome.sessionStorage.size()).toBe(0);
  });
});

describe('full page capture', () => {
  it('primes lazy content before photographing', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    const { orchestrator } = build(chrome);

    await orchestrator.startCapture('fullPage', 'balanced');
    expect(chrome.commandsOfType('primeLazyContent')).toHaveLength(1);
  });

  it('injects the page controller', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    const { orchestrator } = build(chrome);

    await orchestrator.startCapture('fullPage', 'balanced');
    expect(chrome.injected).toContain('content/pageController.js');
  });

  it('shows sticky elements on the first tile and hides them afterwards', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    const { orchestrator } = build(chrome);

    await orchestrator.startCapture('fullPage', 'balanced');
    const scrolls = chrome.commandsOfType('scrollToTile');

    expect(scrolls.length).toBeGreaterThan(1);
    expect(scrolls[0]!.hideFixedElements).toBe(false);
    for (const scroll of scrolls.slice(1)) {
      expect(scroll.hideFixedElements).toBe(true);
    }
  });

  it('takes one screenshot per tile', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    const { orchestrator } = build(chrome);

    await orchestrator.startCapture('fullPage', 'balanced');
    expect(chrome.captures.length).toBe(chrome.commandsOfType('scrollToTile').length);
  });

  it('flags a capture whose lazy content never settled', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi()).on('primeLazyContent', () =>
      ok({ incomplete: true, pageHeight: 3000 }),
    );
    const { orchestrator, sessions } = build(chrome);

    const started = await orchestrator.startCapture('fullPage', 'balanced');
    const stored = await sessions.read(started.ok ? started.value.sessionId : '');

    expect(stored.ok && stored.value.warning?.code).toBe('PARTIAL_LAZY_CONTENT');
    expect(stored.ok && stored.value.warning?.recovery).toBe('recaptureAfterScrolling');
  });

  it('opens the preview without further user input', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    const { orchestrator } = build(chrome);

    const started = await orchestrator.startCapture('fullPage', 'balanced');
    expect(chrome.createdTabs).toHaveLength(1);
    expect(chrome.createdTabs[0]).toContain(started.ok ? started.value.sessionId : 'none');
  });

  it('offers a lower-quality retry when the payload exceeds the quota', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    chrome.sessionStorage.quotaExceeded = false;
    const { orchestrator } = build(chrome);

    // Let the session be created, then reject the payload write.
    const original = chrome.sessionStorage.set.bind(chrome.sessionStorage);
    let writes = 0;
    chrome.sessionStorage.set = async (key: string, value: unknown) => {
      writes += 1;
      if (writes > 1) {
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      return original(key, value);
    };

    const started = await orchestrator.startCapture('fullPage', 'maximum');
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.recovery).toBe('retryLowerQuality');
    }
  });
});

describe('document capture', () => {
  it('asks the page to extract its primary content', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi()).on('extractDocument', () =>
      ok({
        kind: 'document',
        blocks: [{ type: 'paragraph', spans: [{ text: 'body' }] }],
        heading: 'Title',
        byline: null,
        confidence: 0.9,
        unsupportedGlyphCount: 0,
      }),
    );
    const { orchestrator, sessions } = build(chrome);

    const started = await orchestrator.startCapture('document', 'balanced');
    const stored = await sessions.read(started.ok ? started.value.sessionId : '');

    expect(chrome.injected).toContain('content/documentExtractor.js');
    expect(stored.ok && stored.value.payload?.kind).toBe('document');
  });

  it('takes no screenshots for a document capture', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi()).on('extractDocument', () =>
      ok({
        kind: 'document',
        blocks: [],
        heading: 'T',
        byline: null,
        confidence: 0.8,
        unsupportedGlyphCount: 0,
      }),
    );
    const { orchestrator } = build(chrome);

    await orchestrator.startCapture('document', 'balanced');
    expect(chrome.captures).toEqual([]);
  });

  it('surfaces the fallback-to-Exact recovery when no article is found', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi()).on('extractDocument', () =>
      err(createError('DOCUMENT_STRUCTURE_NOT_FOUND')),
    );
    const { orchestrator } = build(chrome);

    const started = await orchestrator.startCapture('document', 'balanced');
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.recovery).toBe('useExactMode');
    }
    expect(chrome.sessionStorage.size()).toBe(0);
  });
});

describe('privacy', () => {
  it('writes captures only to session storage, never to persistent storage', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    const { orchestrator } = build(chrome);

    const started = await orchestrator.startCapture('element', 'balanced');
    await orchestrator.completeSelection({
      sessionId: started.ok ? started.value.sessionId : '',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      contentLabel: 'Image',
      devicePixelRatio: 1,
    });

    expect(chrome.localStorage.writes).toBe(0);
  });

  it('leaves no capture behind once the session is released', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    const { orchestrator, sessions } = build(chrome);

    const started = await orchestrator.startCapture('fullPage', 'balanced');
    await sessions.release(started.ok ? started.value.sessionId : '');

    expect(chrome.sessionStorage.size()).toBe(0);
  });
});

describe('content script coexistence', () => {
  /**
   * Full-page and document captures inject two content scripts into the same
   * frame, and every `chrome.runtime.onMessage` listener in that frame sees
   * every command. A listener that answers a command it does not own wins the
   * race against the one that does, which silently broke Document mode.
   */
  it('lets the extractor answer extractDocument even though the controller is present', async () => {
    const chrome = wireHealthyPage(new FakeChromeApi());
    const { orchestrator, sessions } = build(chrome);

    // The page controller is injected for document mode too, and its handler
    // must decline anything outside its own command set.
    chrome.on('extractDocument', () =>
      ok({
        kind: 'document',
        blocks: [{ type: 'paragraph', spans: [{ text: 'body' }] }],
        heading: 'Title',
        byline: null,
        confidence: 0.9,
        unsupportedGlyphCount: 0,
      }),
    );

    const started = await orchestrator.startCapture('document', 'balanced');
    expect(started.ok).toBe(true);

    expect(chrome.injected).toContain('content/documentExtractor.js');
    expect(chrome.injected).toContain('content/pageController.js');

    const stored = await sessions.read(started.ok ? started.value.sessionId : '');
    expect(stored.ok && stored.value.payload?.kind).toBe('document');
  });
});
