/**
 * Drives the render worker and turns its output into a previewable blob URL.
 *
 * The preview shows the actual generated PDF in Chrome's own viewer rather than
 * an HTML approximation. That is the only way to guarantee the plan's
 * requirement that "the preview corresponds to the downloaded file's
 * orientation, margins, and page size" -- they are literally the same bytes.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createError, type ExactPdfError } from '../shared/errors.js';
import type { RenderReply, RenderRequest } from '../pdf/renderWorker.js';
import type { CaptureSource, CapturePayload, ExportOptions } from '../shared/types.js';

/** Debounce so dragging a margin slider does not queue a render per pixel. */
const RENDER_DEBOUNCE_MS = 260;

export interface RenderState {
  readonly blobUrl: string | null;
  /** Backed by a plain ArrayBuffer so the bytes can go straight into a Blob. */
  readonly bytes: Uint8Array<ArrayBuffer> | null;
  readonly pageCount: number;
  readonly rendering: boolean;
  readonly error: ExactPdfError | null;
}

export function useRenderer(
  payload: CapturePayload | null,
  source: CaptureSource | null,
  options: ExportOptions,
): RenderState {
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const blobUrlRef = useRef<string | null>(null);

  const [state, setState] = useState<RenderState>({
    blobUrl: null,
    bytes: null,
    pageCount: 0,
    rendering: false,
    error: null,
  });

  const revoke = useCallback(() => {
    if (blobUrlRef.current !== null) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    const worker = new Worker(chrome.runtime.getURL('renderWorker.js'), { type: 'module' });
    workerRef.current = worker;

    worker.addEventListener('message', (event: MessageEvent<RenderReply>) => {
      // A reply for a superseded request would show stale output.
      if (event.data.id !== requestId.current) {
        return;
      }
      if (!event.data.result.ok) {
        setState((previous) => ({
          ...previous,
          rendering: false,
          error: event.data.result.ok ? null : event.data.result.error,
        }));
        return;
      }

      const bytes = new Uint8Array(event.data.result.value.bytes);
      revoke();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      blobUrlRef.current = url;

      setState({
        blobUrl: url,
        bytes,
        pageCount: event.data.result.value.pageCount,
        rendering: false,
        error: null,
      });
    });

    worker.addEventListener('error', () => {
      setState((previous) => ({
        ...previous,
        rendering: false,
        error: createError('RENDER_FAILED', 'worker error'),
      }));
    });

    return () => {
      worker.terminate();
      revoke();
    };
  }, [revoke]);

  useEffect(() => {
    if (payload === null || source === null || workerRef.current === null) {
      return;
    }
    setState((previous) => ({ ...previous, rendering: true }));

    const handle = setTimeout(() => {
      requestId.current += 1;
      const request: RenderRequest = { id: requestId.current, payload, options, source };
      workerRef.current?.postMessage(request);
    }, RENDER_DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
    };
  }, [payload, source, options]);

  return state;
}
