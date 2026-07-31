/**
 * Plans a scroll-and-capture sequence.
 *
 * `chrome.tabs.captureVisibleTab` can only photograph the visible viewport, so
 * anything taller or wider than one screen is assembled from tiles. Tiles
 * overlap by {@link TILE_OVERLAP_CSS_PX} because the bottom edge of a viewport
 * screenshot is where partially-composited content shows up; the overlap is
 * discarded when stitching rather than blended, which keeps the result
 * deterministic and therefore testable.
 */

import { MAX_CAPTURE_PIXEL_AREA, TILE_OVERLAP_CSS_PX } from '../../shared/constants.js';
import type { CaptureBounds } from '../../shared/types.js';

export interface Tile {
  /** Document-space scroll target for this tile, in CSS pixels. */
  readonly scrollX: number;
  readonly scrollY: number;
  /**
   * Source rectangle within the captured viewport image, in CSS pixels
   * relative to the viewport's top-left.
   */
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Destination offset within the stitched canvas, in CSS pixels. */
  readonly destX: number;
  readonly destY: number;
}

export interface TilePlan {
  readonly tiles: Tile[];
  /** Stitched canvas size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /**
   * Device-pixel scale to capture at. Reduced below the display's own ratio
   * when the full-resolution canvas would exceed the pixel budget.
   */
  readonly scale: number;
  /** True when `scale` was lowered to stay inside the pixel budget. */
  readonly downscaled: boolean;
}

export interface TilePlanInput {
  readonly bounds: CaptureBounds;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly devicePixelRatio: number;
  /** Upper bound on the capture scale from the quality preset. */
  readonly maxScale: number;
  readonly maxPixelArea?: number;
}

/**
 * Chooses the capture scale, then walks the bounds in viewport-sized steps.
 *
 * The scale is resolved first because it decides whether a capture is possible
 * at all: a 40,000px-tall page at devicePixelRatio 3 would need a canvas far
 * beyond what Chrome will allocate, and silently producing a blank canvas is a
 * worse outcome than a slightly softer image.
 */
export function planTiles(input: TilePlanInput): TilePlan {
  const budget = input.maxPixelArea ?? MAX_CAPTURE_PIXEL_AREA;
  const requested = Math.min(input.devicePixelRatio, input.maxScale);
  const area = input.bounds.width * input.bounds.height;

  const maxScaleForBudget = area > 0 ? Math.sqrt(budget / area) : requested;
  const scale = Math.max(0.5, Math.min(requested, maxScaleForBudget));
  const downscaled = scale < requested - 1e-9;

  // The last tile in each axis is clamped to the content edge, so a page that
  // cannot scroll far enough still contributes its visible remainder.
  const maxScrollX = Math.max(0, input.pageWidth - input.viewportWidth);
  const maxScrollY = Math.max(0, input.pageHeight - input.viewportHeight);

  const right = input.bounds.x + input.bounds.width;
  const bottom = input.bounds.y + input.bounds.height;

  const columns = planAxis(input.bounds.x, right, input.viewportWidth, maxScrollX);
  const rows = planAxis(input.bounds.y, bottom, input.viewportHeight, maxScrollY);

  const tiles: Tile[] = [];
  for (const row of rows) {
    for (const column of columns) {
      tiles.push({
        scrollX: column.scroll,
        scrollY: row.scroll,
        sourceX: column.source,
        sourceY: row.source,
        sourceWidth: column.size,
        sourceHeight: row.size,
        destX: column.start - input.bounds.x,
        destY: row.start - input.bounds.y,
      });
    }
  }

  return {
    tiles,
    width: input.bounds.width,
    height: input.bounds.height,
    scale,
    downscaled,
  };
}

interface AxisStep {
  /** Document-space position of this step's leading edge. */
  readonly start: number;
  /** Scroll offset to reach it, clamped to what the page allows. */
  readonly scroll: number;
  /** Offset of the wanted content inside the captured viewport. */
  readonly source: number;
  readonly size: number;
}

/**
 * Steps along one axis, advancing by how much each tile actually covered
 * rather than by a fixed stride.
 *
 * Advancing blindly by `viewport - overlap` produces a spurious extra tile
 * whenever the content ends within the overlap of the previous one -- including
 * the common case of content exactly one viewport wide.
 */
function planAxis(from: number, to: number, viewport: number, maxScroll: number): AxisStep[] {
  const steps: AxisStep[] = [];
  let position = from;

  while (position < to) {
    const scroll = Math.min(Math.max(0, position), maxScroll);
    const source = position - scroll;
    const size = Math.min(viewport - source, to - position);

    if (size <= 0) {
      break;
    }
    steps.push({ start: position, scroll, source, size });

    const covered = position + size;
    if (covered >= to) {
      break;
    }
    const next = covered - TILE_OVERLAP_CSS_PX;
    // Guarantee forward progress even if the overlap exceeds the tile size.
    position = next > position ? next : covered;
  }

  return steps;
}

/** True when the plan needs more than one screenshot. */
export function isTiled(plan: TilePlan): boolean {
  return plan.tiles.length > 1;
}
