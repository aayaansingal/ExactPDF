/**
 * An in-memory stand-in for the Chrome extension APIs.
 *
 * Every browser call the extension makes goes through the `ChromeApi` adapter,
 * so this fake is enough to drive the whole capture flow -- including failure
 * paths that are impractical to trigger in a real browser, such as a storage
 * quota rejection or a content script that never replies.
 */

import type {
  ChromeApi,
  RuntimeAdapter,
  ScriptingAdapter,
  StorageAdapter,
  TabInfo,
  TabsAdapter,
} from '../../../src/shared/chrome/api.js';
import type { ContentCommand, ContentResponse } from '../../../src/shared/messages.js';
import { ok, type Result } from '../../../src/shared/errors.js';

export class FakeStorage implements StorageAdapter {
  private readonly data = new Map<string, unknown>();
  /** Set to reject writes, simulating `QUOTA_BYTES quota exceeded`. */
  quotaExceeded = false;
  writes = 0;

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (this.quotaExceeded) {
      throw new Error('QUOTA_BYTES quota exceeded');
    }
    this.writes += 1;
    // Storage round-trips through structured clone, so callers must not be able
    // to observe a shared object reference.
    this.data.set(key, JSON.parse(JSON.stringify(value)) as unknown);
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }

  size(): number {
    return this.data.size;
  }
}

export type CommandHandler = (command: ContentCommand) => Result<unknown> | Promise<Result<unknown>>;

export interface FakeChromeOptions {
  readonly tab?: Partial<TabInfo>;
  /** Files whose injection should fail, simulating a restricted page. */
  readonly injectionFailures?: string[];
}

export class FakeChromeApi implements ChromeApi {
  readonly sessionStorage = new FakeStorage();
  readonly localStorage = new FakeStorage();

  readonly injected: string[] = [];
  readonly commands: ContentCommand[] = [];
  readonly captures: { windowId: number; format: string }[] = [];
  readonly createdTabs: string[] = [];

  /** Per-command-type handlers; unhandled commands resolve with `ok({})`. */
  private readonly handlers = new Map<string, CommandHandler>();

  private activeTab: TabInfo;
  private readonly injectionFailures: Set<string>;

  /** Data URL returned by `captureVisibleTab`. */
  captureDataUrl = 'data:image/jpeg;base64,AAAA';

  constructor(options: FakeChromeOptions = {}) {
    this.activeTab = {
      id: 1,
      url: 'https://example.com/article',
      title: 'An Example Article',
      windowId: 10,
      ...options.tab,
    };
    this.injectionFailures = new Set(options.injectionFailures ?? []);
  }

  setActiveTab(tab: Partial<TabInfo> | null): void {
    if (tab === null) {
      this.activeTabMissing = true;
      return;
    }
    this.activeTabMissing = false;
    this.activeTab = { ...this.activeTab, ...tab };
  }

  private activeTabMissing = false;

  on(type: ContentCommand['type'], handler: CommandHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  readonly tabs: TabsAdapter = {
    getActiveTab: async () => (this.activeTabMissing ? null : this.activeTab),

    captureVisibleTab: async (windowId, options) => {
      this.captures.push({ windowId, format: options.format });
      return this.captureDataUrl;
    },

    sendCommand: async <C extends ContentCommand>(_tabId: number, command: C) => {
      this.commands.push(command);
      const handler = this.handlers.get(command.type);
      const result = handler === undefined ? ok({}) : await handler(command);
      return result as ContentResponse<C>;
    },

    create: async (url) => {
      this.createdTabs.push(url);
      return { id: 99, url, title: '', windowId: 10 };
    },
  };

  readonly scripting: ScriptingAdapter = {
    injectFile: async (_tabId, file) => {
      if (this.injectionFailures.has(file)) {
        throw new Error('Cannot access contents of the page');
      }
      this.injected.push(file);
    },
  };

  readonly runtime: RuntimeAdapter = {
    getUrl: (path) => `chrome-extension://exactpdf-test/${path}`,
    lastError: () => undefined,
  };

  /** Commands of one type, in the order they were sent. */
  commandsOfType<T extends ContentCommand['type']>(type: T): Extract<ContentCommand, { type: T }>[] {
    return this.commands.filter(
      (command): command is Extract<ContentCommand, { type: T }> => command.type === type,
    );
  }
}

/** A canvas backend that records operations instead of rasterizing. */
export class FakeCanvasBackend {
  readonly created: { width: number; height: number }[] = [];
  readonly draws: { destX: number; destY: number }[] = [];
  /** Pixel data handed back for auto-crop analysis. */
  pixels: Uint8ClampedArray | null = null;

  createCanvas(width: number, height: number) {
    this.created.push({ width, height });
    const self = this;
    let currentWidth = width;
    let currentHeight = height;

    return {
      get width() {
        return currentWidth;
      },
      get height() {
        return currentHeight;
      },
      drawImage(
        _image: unknown,
        _source: { x: number; y: number; width: number; height: number },
        destination: { x: number; y: number; width: number; height: number },
      ) {
        self.draws.push({ destX: destination.x, destY: destination.y });
      },
      getPixels() {
        return self.pixels ?? new Uint8ClampedArray(currentWidth * currentHeight * 4).fill(255);
      },
      crop(box: { x: number; y: number; width: number; height: number }) {
        currentWidth = box.width;
        currentHeight = box.height;
      },
      async toDataUrl(format: 'image/png' | 'image/jpeg') {
        return `data:${format};base64,STITCHED`;
      },
    };
  }

  async decode(_dataUrl: string) {
    return { width: 1280, height: 720 };
  }
}
