import { beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/background/sessionStore.js';
import { SESSION_TTL_MS, STORAGE_KEYS } from '../../src/shared/constants.js';
import { FakeStorage } from './fakes/chromeApi.js';
import type { CaptureSource, VisualCapturePayload } from '../../src/shared/types.js';

const SOURCE: CaptureSource = {
  url: 'https://example.com/a',
  title: 'A page',
  capturedAt: '2026-07-23T12:00:00.000Z',
  contentLabel: 'Article',
};

const PAYLOAD: VisualCapturePayload = {
  kind: 'visual',
  dataUrl: 'data:image/jpeg;base64,AAAA',
  width: 800,
  height: 600,
  scale: 2,
  format: 'image/jpeg',
  tileCount: 1,
  mayBeIncomplete: false,
};

describe('SessionStore', () => {
  let storage: FakeStorage;
  let clock: number;
  let store: SessionStore;

  beforeEach(() => {
    storage = new FakeStorage();
    clock = 1_000_000;
    store = new SessionStore(storage, () => clock);
  });

  it('creates a session in the pending state', async () => {
    const created = await store.create({ id: 's1', mode: 'element', tabId: 5, source: SOURCE });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.status).toBe('pending');
      expect(created.value.tabId).toBe(5);
    }
  });

  it('marks a session ready once its payload arrives', async () => {
    await store.create({ id: 's1', mode: 'element', tabId: 5, source: SOURCE });
    await store.attachPayload('s1', PAYLOAD);

    const read = await store.read('s1');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.session.status).toBe('ready');
      expect(read.value.payload).toEqual(PAYLOAD);
    }
  });

  it('reports an expired session for an unknown id', async () => {
    const read = await store.read('missing');
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error.code).toBe('SESSION_EXPIRED');
    }
  });

  it('expires a session past its time to live and deletes it', async () => {
    await store.create({ id: 's1', mode: 'element', tabId: 5, source: SOURCE });
    await store.attachPayload('s1', PAYLOAD);

    clock += SESSION_TTL_MS + 1;
    const read = await store.read('s1');

    expect(read.ok).toBe(false);
    expect(await storage.get(`${STORAGE_KEYS.sessionPrefix}s1`)).toBeUndefined();
  });

  it('removes the capture from storage when released', async () => {
    await store.create({ id: 's1', mode: 'element', tabId: 5, source: SOURCE });
    await store.attachPayload('s1', PAYLOAD);
    await store.release('s1');

    expect(storage.size()).toBe(0);
  });

  it('discards the session when the payload exceeds the storage quota', async () => {
    await store.create({ id: 's1', mode: 'fullPage', tabId: 5, source: SOURCE });
    storage.quotaExceeded = true;

    const attached = await store.attachPayload('s1', PAYLOAD);

    expect(attached.ok).toBe(false);
    if (!attached.ok) {
      expect(attached.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
      expect(attached.error.recovery).toBe('retryLowerQuality');
    }
  });

  it('leaves nothing behind after a quota failure', async () => {
    await store.create({ id: 's1', mode: 'fullPage', tabId: 5, source: SOURCE });
    storage.quotaExceeded = true;
    await store.attachPayload('s1', PAYLOAD);

    expect(storage.size()).toBe(0);
  });

  it('survives a service-worker restart, since state lives in storage', async () => {
    await store.create({ id: 's1', mode: 'element', tabId: 5, source: SOURCE });
    await store.attachPayload('s1', PAYLOAD);

    // A restart means a brand new store object over the same storage area.
    const restarted = new SessionStore(storage, () => clock);
    const read = await restarted.read('s1');

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.payload).toEqual(PAYLOAD);
    }
  });

  it('updates the source without disturbing the payload', async () => {
    await store.create({ id: 's1', mode: 'element', tabId: 5, source: SOURCE });
    await store.attachPayload('s1', PAYLOAD);
    await store.updateSource('s1', { ...SOURCE, contentLabel: 'Table' });

    const read = await store.read('s1');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.session.source.contentLabel).toBe('Table');
      expect(read.value.payload).toEqual(PAYLOAD);
    }
  });

  it('carries a warning alongside the payload', async () => {
    await store.create({ id: 's1', mode: 'fullPage', tabId: 5, source: SOURCE });
    await store.attachPayload('s1', PAYLOAD, {
      code: 'PARTIAL_LAZY_CONTENT',
      message: 'partial',
      recovery: 'recaptureAfterScrolling',
    });

    const read = await store.read('s1');
    expect(read.ok && read.value.warning?.code).toBe('PARTIAL_LAZY_CONTENT');
  });

  it('prunes expired sessions and keeps live ones', async () => {
    await store.create({ id: 'old', mode: 'element', tabId: 1, source: SOURCE });
    clock += SESSION_TTL_MS + 1;
    await store.create({ id: 'new', mode: 'element', tabId: 1, source: SOURCE });

    expect(await store.pruneExpired()).toBe(1);
    expect((await store.read('new')).ok).toBe(true);
  });

  it('releases the capture whose preview tab closed, and only that one', async () => {
    await store.create({ id: 'previewed', mode: 'element', tabId: 1, source: SOURCE });
    await store.attachPayload('previewed', PAYLOAD);
    await store.attachPreviewTab('previewed', 42);
    await store.create({ id: 'other', mode: 'element', tabId: 1, source: SOURCE });
    await store.attachPreviewTab('other', 43);

    expect(await store.releaseForPreviewTab(42)).toBe(1);
    expect((await store.read('previewed')).ok).toBe(false);
    expect((await store.read('other')).ok).toBe(true);
  });

  it('keeps the payload when the preview tab is recorded', async () => {
    await store.create({ id: 's1', mode: 'element', tabId: 1, source: SOURCE });
    await store.attachPayload('s1', PAYLOAD);
    await store.attachPreviewTab('s1', 42);

    const read = await store.read('s1');
    expect(read.ok && read.value.payload).toEqual(PAYLOAD);
    expect(read.ok && read.value.previewTabId).toBe(42);
  });

  it('releases nothing when an unrelated tab closes', async () => {
    await store.create({ id: 's1', mode: 'element', tabId: 1, source: SOURCE });
    await store.attachPreviewTab('s1', 42);

    expect(await store.releaseForPreviewTab(7)).toBe(0);
    expect((await store.read('s1')).ok).toBe(true);
  });

  it('ignores unrelated storage keys when pruning', async () => {
    await storage.set(STORAGE_KEYS.settings, { schemaVersion: 1 });
    await store.create({ id: 's1', mode: 'element', tabId: 1, source: SOURCE });
    clock += SESSION_TTL_MS + 1;

    await store.pruneExpired();
    expect(await storage.get(STORAGE_KEYS.settings)).toBeDefined();
  });
});
