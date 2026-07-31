/**
 * Thin adapters over the Chrome extension APIs.
 *
 * Every browser call the extension makes goes through one of these interfaces
 * so that tests can substitute a fake without a real browser, and so that the
 * set of platform capabilities the extension depends on stays enumerable.
 */

import type { ContentCommand, ContentResponse } from '../messages.js';

export interface TabInfo {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly windowId: number;
}

export interface TabsAdapter {
  getActiveTab(): Promise<TabInfo | null>;
  /** Resolves with a `data:` URL of the visible viewport at device resolution. */
  captureVisibleTab(windowId: number, options: { format: 'png' | 'jpeg'; quality?: number }): Promise<string>;
  sendCommand<C extends ContentCommand>(tabId: number, command: C): Promise<ContentResponse<C>>;
  create(url: string): Promise<TabInfo>;
}

export interface ScriptingAdapter {
  /** Injects a bundled content script file. Never injects a string of code. */
  injectFile(tabId: number, file: string): Promise<void>;
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface RuntimeAdapter {
  getUrl(path: string): string;
  lastError(): string | undefined;
}

export interface ChromeApi {
  readonly tabs: TabsAdapter;
  readonly scripting: ScriptingAdapter;
  /** Cleared when the browser closes; holds in-flight capture payloads. */
  readonly sessionStorage: StorageAdapter;
  /** Survives restarts; holds user settings only. */
  readonly localStorage: StorageAdapter;
  readonly runtime: RuntimeAdapter;
}
