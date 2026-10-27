/**
 * Holds in-flight captures.
 *
 * Captures live in `chrome.storage.session`, which is cleared when the browser
 * closes and is not written to disk. That choice does two things the plan
 * requires: the payload survives a Manifest V3 service-worker suspension mid
 * capture, and nothing captured is ever persisted beyond the browsing session.
 * Sessions are additionally deleted on download, cancellation, expiry and when
 * their preview tab closes.
 */

import { SESSION_TTL_MS, STORAGE_KEYS } from '../shared/constants.js';
import { createError, err, fromThrown, ok, type Result } from '../shared/errors.js';
import type { CapturePayload, CaptureSession, CaptureSource, CaptureMode } from '../shared/types.js';
import type { ExactPdfError } from '../shared/errors.js';
import type { StorageAdapter } from '../shared/chrome/api.js';

export interface StoredSession {
  readonly session: CaptureSession;
  readonly payload: CapturePayload | null;
  readonly warning: ExactPdfError | null;
  /** The tab showing this capture's preview, once it has been opened. */
  readonly previewTabId?: number;
}

function sessionKey(id: string): string {
  return `${STORAGE_KEYS.sessionPrefix}${id}`;
}

export class SessionStore {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly now: () => number = Date.now,
  ) {}

  async create(input: {
    id: string;
    mode: CaptureMode;
    tabId: number;
    source: CaptureSource;
  }): Promise<Result<CaptureSession>> {
    const session: CaptureSession = {
      id: input.id,
      mode: input.mode,
      tabId: input.tabId,
      source: input.source,
      createdAt: this.now(),
      status: 'pending',
    };
    try {
      await this.storage.set(sessionKey(input.id), { session, payload: null, warning: null });
      return ok(session);
    } catch (thrown) {
      return err(fromThrown(thrown));
    }
  }

  async attachPayload(
    id: string,
    payload: CapturePayload,
    warning: ExactPdfError | null = null,
  ): Promise<Result<CaptureSession>> {
    const existing = await this.read(id);
    if (!existing.ok) {
      return existing;
    }
    const session: CaptureSession = { ...existing.value.session, status: 'ready' };
    try {
      await this.storage.set(sessionKey(id), { session, payload, warning });
      return ok(session);
    } catch (thrown) {
      // A quota rejection here is the documented "capture too large" path: the
      // payload is discarded so the tab is not left holding a half-written
      // session, and the caller offers a lower-quality retry.
      await this.release(id);
      return err(fromThrown(thrown, 'STORAGE_QUOTA_EXCEEDED'));
    }
  }

  /** Updates the capture's source record without touching its payload. */
  async updateSource(id: string, source: CaptureSource): Promise<Result<CaptureSession>> {
    const existing = await this.read(id);
    if (!existing.ok) {
      return existing;
    }
    const session: CaptureSession = { ...existing.value.session, source };
    try {
      await this.storage.set(sessionKey(id), { ...existing.value, session });
      return ok(session);
    } catch (thrown) {
      return err(fromThrown(thrown));
    }
  }

  async read(id: string): Promise<Result<StoredSession>> {
    const stored = await this.storage.get<StoredSession>(sessionKey(id));
    if (stored === undefined) {
      return err(createError('SESSION_EXPIRED'));
    }
    if (this.now() - stored.session.createdAt > SESSION_TTL_MS) {
      await this.release(id);
      return err(createError('SESSION_EXPIRED'));
    }
    return ok(stored);
  }

  /**
   * Records which tab is previewing the capture, so closing that tab can
   * release it. Kept in storage rather than memory because the service worker
   * may be suspended between opening the preview and the tab closing.
   */
  async attachPreviewTab(id: string, previewTabId: number): Promise<void> {
    const existing = await this.read(id);
    if (!existing.ok) {
      return;
    }
    await this.storage.set(sessionKey(id), { ...existing.value, previewTabId });
  }

  async release(id: string): Promise<void> {
    await this.storage.remove(sessionKey(id));
  }

  /**
   * Releases every capture previewed in a tab that has closed.
   *
   * The preview page also asks for release on `pagehide`, but a message sent
   * from a page that is being torn down is best-effort and can be dropped.
   * `tabs.onRemoved` is delivered reliably, so this is the guarantee.
   */
  async releaseForPreviewTab(previewTabId: number): Promise<number> {
    const keys = await this.storage.keys();
    let released = 0;
    for (const key of keys) {
      if (!key.startsWith(STORAGE_KEYS.sessionPrefix)) {
        continue;
      }
      const stored = await this.storage.get<StoredSession>(key);
      if (stored?.previewTabId === previewTabId) {
        await this.storage.remove(key);
        released += 1;
      }
    }
    return released;
  }

  /** Drops every session past its TTL. Runs on service-worker startup. */
  async pruneExpired(): Promise<number> {
    const keys = await this.storage.keys();
    let removed = 0;
    for (const key of keys) {
      if (!key.startsWith(STORAGE_KEYS.sessionPrefix)) {
        continue;
      }
      const stored = await this.storage.get<StoredSession>(key);
      if (stored === undefined || this.now() - stored.session.createdAt > SESSION_TTL_MS) {
        await this.storage.remove(key);
        removed += 1;
      }
    }
    return removed;
  }
}

/** Session ids only need to be unguessable within one browser session. */
export function createSessionId(): string {
  return crypto.randomUUID();
}
