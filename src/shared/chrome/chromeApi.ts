/** The real Chrome implementation of {@link ChromeApi}. */

import type { ContentCommand, ContentResponse } from '../messages.js';
import type {
  ChromeApi,
  RuntimeAdapter,
  ScriptingAdapter,
  StorageAdapter,
  TabInfo,
  TabsAdapter,
} from './api.js';

function toTabInfo(tab: chrome.tabs.Tab): TabInfo | null {
  return tab.id === undefined
    ? null
    : { id: tab.id, url: tab.url ?? '', title: tab.title ?? '', windowId: tab.windowId };
}

const tabs: TabsAdapter = {
  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab === undefined ? null : toTabInfo(tab);
  },

  async captureVisibleTab(windowId, options) {
    return chrome.tabs.captureVisibleTab(windowId, {
      format: options.format,
      ...(options.quality === undefined ? {} : { quality: options.quality }),
    });
  },

  async sendCommand<C extends ContentCommand>(tabId: number, command: C): Promise<ContentResponse<C>> {
    const response: unknown = await chrome.tabs.sendMessage(tabId, command);
    return response as ContentResponse<C>;
  },

  async create(url) {
    const tab = await chrome.tabs.create({ url });
    const info = toTabInfo(tab);
    if (info === null) {
      throw new Error('Created tab has no id');
    }
    return info;
  },
};

const scripting: ScriptingAdapter = {
  async injectFile(tabId, file) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  },
};

function storageAdapter(area: chrome.storage.StorageArea): StorageAdapter {
  return {
    async get<T>(key: string) {
      const record = await area.get(key);
      return record[key] as T | undefined;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
    async keys() {
      return Object.keys(await area.get(null));
    },
  };
}

const runtime: RuntimeAdapter = {
  getUrl: (path) => chrome.runtime.getURL(path),
  lastError: () => chrome.runtime.lastError?.message,
};

export const chromeApi: ChromeApi = {
  tabs,
  scripting,
  sessionStorage: storageAdapter(chrome.storage.session),
  localStorage: storageAdapter(chrome.storage.local),
  runtime,
};
