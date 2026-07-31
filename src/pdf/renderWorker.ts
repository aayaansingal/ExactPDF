/**
 * Runs PDF generation off the preview page's UI thread.
 *
 * Rendering a long capture involves re-encoding several megapixels per page and
 * building the whole file in memory. Doing that on the main thread would freeze
 * the preview's controls exactly when the user is adjusting them, which the
 * performance budget rules out.
 */

import { renderExactPdf, type RasterSlicer } from './exactRenderer.js';
import { renderDocumentPdf } from './documentRenderer.js';
import { fromThrown, type Result } from '../shared/errors.js';
import type { CaptureSource, CapturePayload, ExportOptions } from '../shared/types.js';

export interface RenderRequest {
  /** Correlates the reply with the request that produced it. */
  readonly id: number;
  readonly payload: CapturePayload;
  readonly options: ExportOptions;
  readonly source: CaptureSource;
}

export interface RenderReply {
  readonly id: number;
  readonly result: Result<{ bytes: ArrayBuffer; pageCount: number }>;
}

/**
 * Slices the stitched capture with an `OffscreenCanvas`.
 *
 * The full capture is decoded once per render and reused across pages, since
 * decoding a large screenshot repeatedly dominates the cost of an export.
 */
async function createSlicer(dataUrl: string, background: string | undefined): Promise<RasterSlicer> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  return {
    width: bitmap.width,
    height: bitmap.height,

    async encodeSlice(rect, options) {
      const width = Math.max(1, Math.min(rect.width, bitmap.width - rect.x));
      const height = Math.max(1, Math.min(rect.height, bitmap.height - rect.y));

      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context === null) {
        throw new Error('2D context unavailable');
      }

      // JPEG has no alpha channel, so a transparent capture would otherwise
      // encode as black. Filling first makes the fallback explicit.
      const fill = options.flattenTo ?? background;
      if (fill !== undefined && options.format === 'image/jpeg') {
        context.fillStyle = fill;
        context.fillRect(0, 0, width, height);
      }

      context.drawImage(bitmap, rect.x, rect.y, width, height, 0, 0, width, height);

      const encoded = await canvas.convertToBlob({
        type: options.format,
        quality: options.quality,
      });
      return {
        bytes: new Uint8Array(await encoded.arrayBuffer()),
        format: options.format,
      };
    },
  };
}

async function render(request: RenderRequest): Promise<RenderReply> {
  try {
    const result =
      request.payload.kind === 'document'
        ? await renderDocumentPdf({
            payload: request.payload,
            options: request.options,
            source: request.source,
          })
        : await renderExactPdf({
            payload: request.payload,
            options: request.options,
            source: request.source,
            slicer: await createSlicer(
              request.payload.dataUrl,
              request.options.background === 'transparent' ? undefined : '#ffffff',
            ),
          });

    if (!result.ok) {
      return { id: request.id, result };
    }
    // Copy into a standalone buffer so it can be transferred rather than cloned.
    const buffer = result.value.bytes.slice().buffer;
    return {
      id: request.id,
      result: { ok: true, value: { bytes: buffer, pageCount: result.value.pageCount } },
    };
  } catch (thrown) {
    return { id: request.id, result: { ok: false, error: fromThrown(thrown, 'RENDER_FAILED') } };
  }
}

self.addEventListener('message', (event: MessageEvent<RenderRequest>) => {
  void render(event.data).then((reply) => {
    if (reply.result.ok) {
      self.postMessage(reply, [reply.result.value.bytes]);
    } else {
      self.postMessage(reply);
    }
  });
});
