/**
 * Unit conversions.
 *
 * PDF works in points (1/72 inch). CSS pixels are defined as 1/96 inch, so a
 * capture rendered at "original size" maps 96 CSS px to 72 pt. Margins are
 * expressed in millimetres because that is what the settings UI presents.
 */

import { MAX_PDF_DIMENSION_PT, MARGIN_PRESETS } from '../shared/constants.js';
import type { MarginPreset, Margins, Orientation, PageSize } from '../shared/types.js';

export const POINTS_PER_INCH = 72;
export const CSS_PIXELS_PER_INCH = 96;
export const MM_PER_INCH = 25.4;

export function cssPixelsToPoints(px: number): number {
  return (px * POINTS_PER_INCH) / CSS_PIXELS_PER_INCH;
}

export function pointsToCssPixels(pt: number): number {
  return (pt * CSS_PIXELS_PER_INCH) / POINTS_PER_INCH;
}

export function mmToPoints(mm: number): number {
  return (mm / MM_PER_INCH) * POINTS_PER_INCH;
}

export function pointsToMm(pt: number): number {
  return (pt / POINTS_PER_INCH) * MM_PER_INCH;
}

export interface PageDimensions {
  readonly width: number;
  readonly height: number;
}

/** Portrait dimensions in points. */
export const PAPER_SIZES: Record<'a4' | 'letter', PageDimensions> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

export function resolveMargins(preset: MarginPreset, custom: Margins): Margins {
  return preset === 'custom' ? custom : MARGIN_PRESETS[preset];
}

/** Converts a margin set from millimetres to points. */
export function marginsToPoints(margins: Margins): Margins {
  return {
    top: mmToPoints(margins.top),
    right: mmToPoints(margins.right),
    bottom: mmToPoints(margins.bottom),
    left: mmToPoints(margins.left),
  };
}

/**
 * Applies an orientation to a paper size. `auto` follows the content's own
 * aspect ratio so a wide table does not arrive rotated by default.
 */
export function applyOrientation(
  size: PageDimensions,
  orientation: Orientation,
  contentAspectRatio: number,
): PageDimensions {
  const landscape = orientation === 'landscape' || (orientation === 'auto' && contentAspectRatio > 1);

  if (landscape && size.height > size.width) {
    return { width: size.height, height: size.width };
  }
  if (!landscape && size.width > size.height) {
    return { width: size.height, height: size.width };
  }
  return size;
}

/** Clamps a dimension to the largest value the PDF format permits. */
export function clampToPdfLimit(value: number): number {
  return Math.min(Math.max(value, 1), MAX_PDF_DIMENSION_PT);
}

export function isPaperSize(pageSize: PageSize): pageSize is 'a4' | 'letter' {
  return pageSize === 'a4' || pageSize === 'letter';
}
