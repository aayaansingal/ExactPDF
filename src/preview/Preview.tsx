/**
 * The preview application: see the result, adjust it, save it.
 *
 * The pane on the right is the real generated PDF in Chrome's viewer, not a
 * mock-up, so every control on the left demonstrably changes the file that will
 * be downloaded.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { ExportControls } from './ExportControls.js';
import { useRenderer } from './useRenderer.js';
import { buildFilename, normalizeUserFilename } from '../shared/filename.js';
import { migrateSettings, type Settings } from '../shared/settings.js';
import { STORAGE_KEYS } from '../shared/constants.js';
import { DOCUMENT_CONFIDENCE_THRESHOLD } from '../shared/types.js';
import type { ExactPdfError } from '../shared/errors.js';
import type { GetSessionResponse, ExtensionRequest, ExtensionResponse } from '../shared/messages.js';
import type { ExportOptions, QualityPreset } from '../shared/types.js';

async function send<R extends ExtensionRequest>(request: R): Promise<ExtensionResponse<R>> {
  const response: unknown = await chrome.runtime.sendMessage(request);
  return response as ExtensionResponse<R>;
}

function optionsFrom(settings: Settings, filename: string, isDocument: boolean): ExportOptions {
  return {
    // A document capture has no raster to be faithful to, so Exact mode would
    // be a promise the payload cannot keep.
    renderMode: isDocument ? 'document' : settings.defaultRenderMode,
    pageSize: settings.defaultPageSize,
    orientation: settings.defaultOrientation,
    marginPreset: settings.defaultMarginPreset,
    customMargins: settings.customMargins,
    background: settings.defaultBackground,
    quality: settings.defaultQuality,
    filename,
    metadata: settings.metadata,
  };
}

export function Preview(): preact.JSX.Element {
  const sessionId = useMemo(() => new URLSearchParams(window.location.search).get('session') ?? '', []);

  const [session, setSession] = useState<GetSessionResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [loadError, setLoadError] = useState<ExactPdfError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [stored, result] = await Promise.all([
        chrome.storage.local.get(STORAGE_KEYS.settings),
        send({ type: 'getSession', sessionId }),
      ]);

      const loadedSettings = migrateSettings(stored[STORAGE_KEYS.settings]);
      setSettings(loadedSettings);

      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setSession(result.value);

      const filename = buildFilename({
        title: result.value.source.title,
        url: result.value.source.url,
        contentLabel: result.value.source.contentLabel,
        capturedAt: new Date(result.value.source.capturedAt),
        timestampSuffix: loadedSettings.timestampSuffix,
      });
      setOptions(optionsFrom(loadedSettings, filename, result.value.payload.kind === 'document'));
    })();
  }, [sessionId]);

  // The capture is released when the tab goes away, whether the user saved it
  // or simply closed the window.
  useEffect(() => {
    const release = (): void => {
      void chrome.runtime.sendMessage({ type: 'releaseSession', sessionId });
    };
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
    };
  }, [sessionId]);

  const render = useRenderer(
    session?.payload ?? null,
    session?.source ?? null,
    options ?? optionsFrom(migrateSettings(null), 'capture.pdf', false),
  );

  const download = useCallback(() => {
    if (render.bytes === null || options === null) {
      return;
    }
    const filename = normalizeUserFilename(options.filename);

    // An anchor download from an extension page needs no `downloads`
    // permission, which keeps the install warning to a minimum.
    const url = URL.createObjectURL(new Blob([render.bytes], { type: 'application/pdf' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);

    setSaved(filename);
    void chrome.runtime.sendMessage({ type: 'releaseSession', sessionId });
  }, [render.bytes, options, sessionId]);

  const retryAtQuality = useCallback(
    async (quality: QualityPreset) => {
      const result = await send({ type: 'retryCapture', sessionId, quality });
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      window.close();
    },
    [sessionId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        download();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [download]);

  if (loadError !== null) {
    return (
      <main class="preview preview--message">
        <div class="preview__messageCard">
          <h1>This capture is no longer available</h1>
          <p class="notice notice--error">{loadError.message}</p>
          <button
            type="button"
            class="button button--primary"
            onClick={() => {
              window.close();
            }}
          >
            Close
          </button>
        </div>
      </main>
    );
  }

  if (session === null || options === null || settings === null) {
    return (
      <main class="preview preview--message">
        <p class="preview__loading">Preparing your capture…</p>
      </main>
    );
  }

  const isDocument = session.payload.kind === 'document';
  const lowConfidence =
    session.payload.kind === 'document' && session.payload.confidence < DOCUMENT_CONFIDENCE_THRESHOLD;
  const droppedGlyphs = session.payload.kind === 'document' ? session.payload.unsupportedGlyphCount : 0;

  return (
    <main class="preview">
      <aside class="preview__panel">
        <header class="preview__header">
          <h1 class="preview__title">Ready to save</h1>
          <p class="preview__subtitle">
            {render.pageCount > 0
              ? `${render.pageCount} page${render.pageCount === 1 ? '' : 's'}`
              : 'Preparing…'}
            {render.bytes !== null && ` · ${formatSize(render.bytes.byteLength)}`}
          </p>
        </header>

        {session.warning !== undefined && (
          <div class="notice notice--warning" role="status">
            <p class="preview__noticeText">{session.warning.message}</p>
            <button
              type="button"
              class="button"
              onClick={() => {
                void retryAtQuality(options.quality);
              }}
            >
              Capture again
            </button>
          </div>
        )}

        {lowConfidence && (
          <div class="notice notice--warning" role="status">
            <p class="preview__noticeText">
              This page does not look much like an article, so Document mode may have missed content. An Exact
              capture keeps exactly what was on screen.
            </p>
          </div>
        )}

        {droppedGlyphs > 0 && (
          <div class="notice notice--warning" role="status">
            <p class="preview__noticeText">
              {droppedGlyphs} character{droppedGlyphs === 1 ? '' : 's'} cannot be shown in Document
              mode&apos;s built-in fonts and appear as “?”. Exact mode preserves them as they looked on the
              page.
            </p>
          </div>
        )}

        {render.error !== null && (
          <div class="notice notice--error" role="alert">
            <p class="preview__noticeText">{render.error.message}</p>
            {render.error.recovery === 'retryLowerQuality' && (
              <button
                type="button"
                class="button"
                onClick={() => {
                  void retryAtQuality('compact');
                }}
              >
                Try a smaller capture
              </button>
            )}
          </div>
        )}

        <ExportControls options={options} isDocument={isDocument} onChange={setOptions} />

        <div class="preview__actions">
          <button
            type="button"
            class="button button--primary preview__save"
            disabled={render.bytes === null || render.rendering}
            onClick={download}
          >
            {render.rendering ? 'Preparing…' : 'Save PDF'}
          </button>
          <button
            type="button"
            class="button"
            onClick={() => {
              window.close();
            }}
          >
            Cancel
          </button>
        </div>

        {saved !== null && (
          <p class="notice notice--info" role="status">
            Saved as {saved}.
          </p>
        )}

        <p class="preview__privacy">Converted on this device. Nothing from this page was uploaded.</p>
      </aside>

      <section class="preview__stage" aria-label="PDF preview">
        {render.blobUrl === null ? (
          <div class="preview__placeholder">
            <span class="preview__spinner" aria-hidden="true" />
            <p>Generating preview…</p>
          </div>
        ) : (
          <iframe class="preview__frame" src={`${render.blobUrl}#toolbar=0&navpanes=0`} title="PDF preview" />
        )}
        {render.rendering && render.blobUrl !== null && (
          <p class="preview__updating" role="status">
            Updating…
          </p>
        )}
      </section>
    </main>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} kB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
