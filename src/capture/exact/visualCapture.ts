/**
 * The Exact capture engine.
 *
 * Runs the scroll-and-photograph loop and stitches the tiles into one image.
 * This lives in the service worker because `chrome.tabs.captureVisibleTab` is
 * only callable there, and because doing the compositing off the page's thread
 * keeps a large capture from freezing the tab being captured.
 */

import { planTiles, type TilePlan } from './tilePlan.js';
import { computeAutoCropBox } from './autoCrop.js';
import { CAPTURE_THROTTLE_MS, LAZY_LOAD_MAX_DURATION_MS, QUALITY_SETTINGS } from '../../shared/constants.js';
import { createError, err, fromThrown, ok, type Result } from '../../shared/errors.js';
import type { TabsAdapter } from '../../shared/chrome/api.js';
import type { CaptureBounds, QualityPreset, VisualCapturePayload } from '../../shared/types.js';

/** Canvas operations, abstracted so the loop can be tested without a browser. */
export interface CanvasBackend {
  createCanvas(width: number, height: number): StitchCanvas;
  /** Decodes a `data:` URL produced by `captureVisibleTab`. */
  decode(dataUrl: string): Promise<DecodedImage>;
}

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

export interface StitchCanvas {
  drawImage(
    image: DecodedImage,
    source: { x: number; y: number; width: number; height: number },
    destination: { x: number; y: number; width: number; height: number },
  ): void;
  /** RGBA pixels for blank-space analysis. */
  getPixels(): Uint8ClampedArray;
  /** Replaces the canvas contents with the given sub-rectangle. */
  crop(box: { x: number; y: number; width: number; height: number }): void;
  toDataUrl(format: 'image/png' | 'image/jpeg', quality: number): Promise<string>;
  readonly width: number;
  readonly height: number;
}

export interface VisualCaptureDeps {
  readonly tabs: TabsAdapter;
  readonly canvas: CanvasBackend;
  readonly wait: (ms: number) => Promise<void>;
}

export interface VisualCaptureInput {
  readonly sessionId: string;
  readonly tabId: number;
  readonly windowId: number;
  readonly bounds: CaptureBounds;
  readonly quality: QualityPreset;
  readonly devicePixelRatio: number;
  /** Full-page captures prime lazy content and suppress repeated headers. */
  readonly fullPage: boolean;
  /** Removes uniform page background around the content. */
  readonly autoCrop: boolean;
}

export interface VisualCaptureOutcome {
  readonly payload: VisualCapturePayload;
  /** Set when the capture completed but something was compromised. */
  readonly warning: Result<never> | null;
}

/**
 * Captures the requested bounds, tiling if it does not fit on one screen.
 *
 * The page controller is always restored, on every exit path, because a page
 * left frozen with its sticky headers hidden is the most visible way this
 * feature can fail.
 */
export async function captureVisual(
  deps: VisualCaptureDeps,
  input: VisualCaptureInput,
): Promise<Result<VisualCaptureOutcome>> {
  const prepared = await deps.tabs.sendCommand(input.tabId, {
    type: 'preparePage',
    sessionId: input.sessionId,
  });
  if (!prepared.ok) {
    return prepared;
  }

  let mayBeIncomplete = false;

  try {
    if (input.fullPage) {
      const primed = await deps.tabs.sendCommand(input.tabId, {
        type: 'primeLazyContent',
        sessionId: input.sessionId,
        maxDurationMs: LAZY_LOAD_MAX_DURATION_MS,
      });
      if (primed.ok) {
        mayBeIncomplete = primed.value.incomplete;
      }
    }

    const quality = QUALITY_SETTINGS[input.quality];
    const plan = planTiles({
      bounds: input.bounds,
      viewportWidth: prepared.value.viewportWidth,
      viewportHeight: prepared.value.viewportHeight,
      pageWidth: prepared.value.pageWidth,
      pageHeight: prepared.value.pageHeight,
      devicePixelRatio: input.devicePixelRatio || prepared.value.devicePixelRatio,
      maxScale: quality.maxScale,
    });

    if (plan.tiles.length === 0) {
      return err(createError('CAPTURE_FAILED', 'no tiles planned'));
    }

    const stitched = await stitch(deps, input, plan, prepared.value.viewportWidth);
    if (!stitched.ok) {
      return stitched;
    }

    const canvas = stitched.value;
    if (input.autoCrop) {
      canvas.crop(computeAutoCropBox(canvas.getPixels(), canvas.width, canvas.height));
    }

    const format = quality.format;
    const dataUrl = await canvas.toDataUrl(format, quality.jpegQuality);

    return ok({
      payload: {
        kind: 'visual',
        dataUrl,
        width: canvas.width,
        height: canvas.height,
        scale: plan.scale,
        format,
        tileCount: plan.tiles.length,
        mayBeIncomplete,
      },
      warning: null,
    });
  } catch (thrown) {
    return err(fromThrown(thrown, 'CAPTURE_FAILED'));
  } finally {
    // Restore runs even when the capture threw: the page belongs to the user.
    await deps.tabs
      .sendCommand(input.tabId, { type: 'restorePage', sessionId: input.sessionId })
      .catch(() => undefined);
  }
}

async function stitch(
  deps: VisualCaptureDeps,
  input: VisualCaptureInput,
  plan: TilePlan,
  viewportWidth: number,
): Promise<Result<StitchCanvas>> {
  const canvas = deps.canvas.createCanvas(
    Math.max(1, Math.round(plan.width * plan.scale)),
    Math.max(1, Math.round(plan.height * plan.scale)),
  );

  const quality = QUALITY_SETTINGS[input.quality];
  let previousCaptureAt = 0;

  for (const [index, tile] of plan.tiles.entries()) {
    const scrolled = await deps.tabs.sendCommand(input.tabId, {
      type: 'scrollToTile',
      sessionId: input.sessionId,
      x: tile.scrollX,
      y: tile.scrollY,
      // Sticky headers belong on the first tile only; repeating them down the
      // page is the classic full-page-capture artefact.
      hideFixedElements: input.fullPage && index > 0,
    });
    if (!scrolled.ok) {
      return scrolled;
    }

    // `captureVisibleTab` is rate limited; exceeding it fails the whole capture.
    const sinceLast = Date.now() - previousCaptureAt;
    if (previousCaptureAt !== 0 && sinceLast < CAPTURE_THROTTLE_MS) {
      await deps.wait(CAPTURE_THROTTLE_MS - sinceLast);
    }

    const dataUrl = await deps.tabs.captureVisibleTab(input.windowId, {
      format: quality.format === 'image/png' ? 'png' : 'jpeg',
      ...(quality.format === 'image/jpeg' ? { quality: Math.round(quality.jpegQuality * 100) } : {}),
    });
    previousCaptureAt = Date.now();

    const image = await deps.canvas.decode(dataUrl);

    // The screenshot arrives at the display's own pixel ratio, which may differ
    // from the ratio the plan chose. Deriving the ratio from the image keeps the
    // mapping correct on mixed-DPI setups and after a browser zoom change.
    const capturedScale = image.width / Math.max(1, viewportWidth);

    // The page may not have reached the requested offset (a short page, or a
    // scroll container that clamped), so the actual position decides the crop.
    const deltaX = tile.scrollX - scrolled.value.scrollX;
    const deltaY = tile.scrollY - scrolled.value.scrollY;
    const sourceX = tile.sourceX + deltaX;
    const sourceY = tile.sourceY + deltaY;

    canvas.drawImage(
      image,
      {
        x: sourceX * capturedScale,
        y: sourceY * capturedScale,
        width: tile.sourceWidth * capturedScale,
        height: tile.sourceHeight * capturedScale,
      },
      {
        x: tile.destX * plan.scale,
        y: tile.destY * plan.scale,
        width: tile.sourceWidth * plan.scale,
        height: tile.sourceHeight * plan.scale,
      },
    );

    image.close?.();
  }

  return ok(canvas);
}
