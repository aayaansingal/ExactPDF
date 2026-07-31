/**
 * Decides how one captured image becomes one or more PDF pages.
 *
 * The four page-size presets answer genuinely different needs, so they are
 * defined here rather than left to the renderer:
 *
 * - `original`   The page matches the capture's own size at 96 DPI, paginating
 *                only when the capture exceeds PDF's 14,400 pt limit. What you
 *                selected is what the page is.
 * - `continuous` Exactly one page holding the whole capture, scaled down if it
 *                would otherwise breach the format limit. Best for feeds and
 *                conversations, where a page break is an artefact.
 * - `a4`/`letter` The capture is fitted to the printable width and sliced down
 *                its length across standard sheets.
 */

import {
  clampToPdfLimit,
  cssPixelsToPoints,
  isPaperSize,
  marginsToPoints,
  PAPER_SIZES,
  applyOrientation,
} from './units.js';
import { MAX_PDF_DIMENSION_PT } from '../shared/constants.js';
import type { Margins, Orientation, PageSize } from '../shared/types.js';

export interface ExactPageSlice {
  /** Page box in points. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  /** Source rectangle of the capture, in image pixels. */
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Where the slice is drawn on the page, in points, from the bottom-left. */
  readonly drawX: number;
  readonly drawY: number;
  readonly drawWidth: number;
  readonly drawHeight: number;
}

export interface ExactLayoutInput {
  /** Capture size in image (device) pixels. */
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** Device pixel ratio the capture was taken at. */
  readonly scale: number;
  readonly pageSize: PageSize;
  readonly orientation: Orientation;
  /** Margins in millimetres. */
  readonly margins: Margins;
}

export interface ExactLayout {
  readonly slices: ExactPageSlice[];
  /** True when the capture had to be scaled below 1:1 to fit the format. */
  readonly scaledDown: boolean;
}

export function planExactLayout(input: ExactLayoutInput): ExactLayout {
  const margins = marginsToPoints(input.margins);

  // The capture's intrinsic size in points, i.e. its CSS size at 96 DPI.
  const naturalWidth = cssPixelsToPoints(input.imageWidth / input.scale);
  const naturalHeight = cssPixelsToPoints(input.imageHeight / input.scale);

  if (isPaperSize(input.pageSize)) {
    return planPaperLayout(input, margins, naturalWidth, naturalHeight);
  }
  if (input.pageSize === 'continuous') {
    return planContinuousLayout(input, margins, naturalWidth, naturalHeight);
  }
  return planOriginalLayout(input, margins, naturalWidth, naturalHeight);
}

/** One page per capture, split only when the format limit forces it. */
function planOriginalLayout(
  input: ExactLayoutInput,
  margins: Margins,
  naturalWidth: number,
  naturalHeight: number,
): ExactLayout {
  const pageWidth = clampToPdfLimit(naturalWidth + margins.left + margins.right);
  const contentWidth = pageWidth - margins.left - margins.right;
  const widthScale = contentWidth / naturalWidth;

  const maxContentHeight = MAX_PDF_DIMENSION_PT - margins.top - margins.bottom;
  const scaledHeight = naturalHeight * widthScale;
  const sliceCount = Math.max(1, Math.ceil(scaledHeight / maxContentHeight));

  const slices: ExactPageSlice[] = [];
  for (let index = 0; index < sliceCount; index += 1) {
    const drawnHeight = Math.min(maxContentHeight, scaledHeight - index * maxContentHeight);
    const pageHeight = drawnHeight + margins.top + margins.bottom;
    const sourceHeight = (drawnHeight / scaledHeight) * input.imageHeight;
    const sourceY = ((index * maxContentHeight) / scaledHeight) * input.imageHeight;

    slices.push({
      pageWidth,
      pageHeight,
      sourceX: 0,
      sourceY,
      sourceWidth: input.imageWidth,
      sourceHeight,
      drawX: margins.left,
      drawY: margins.bottom,
      drawWidth: contentWidth,
      drawHeight: drawnHeight,
    });
  }

  return { slices, scaledDown: widthScale < 1 - 1e-9 };
}

/** Exactly one page, uniformly scaled to fit inside the format limit. */
function planContinuousLayout(
  input: ExactLayoutInput,
  margins: Margins,
  naturalWidth: number,
  naturalHeight: number,
): ExactLayout {
  const maxContentWidth = MAX_PDF_DIMENSION_PT - margins.left - margins.right;
  const maxContentHeight = MAX_PDF_DIMENSION_PT - margins.top - margins.bottom;

  const fitScale = Math.min(1, maxContentWidth / naturalWidth, maxContentHeight / naturalHeight);
  const drawWidth = naturalWidth * fitScale;
  const drawHeight = naturalHeight * fitScale;

  return {
    slices: [
      {
        pageWidth: drawWidth + margins.left + margins.right,
        pageHeight: drawHeight + margins.top + margins.bottom,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: input.imageWidth,
        sourceHeight: input.imageHeight,
        drawX: margins.left,
        drawY: margins.bottom,
        drawWidth,
        drawHeight,
      },
    ],
    scaledDown: fitScale < 1 - 1e-9,
  };
}

/** Fit to the printable width of a standard sheet, then slice down its length. */
function planPaperLayout(
  input: ExactLayoutInput,
  margins: Margins,
  naturalWidth: number,
  naturalHeight: number,
): ExactLayout {
  const paper = PAPER_SIZES[input.pageSize as 'a4' | 'letter'];
  const page = applyOrientation(paper, input.orientation, naturalWidth / naturalHeight);

  const contentWidth = Math.max(1, page.width - margins.left - margins.right);
  const contentHeight = Math.max(1, page.height - margins.top - margins.bottom);

  // Never enlarge: a small diagram blown up to fill A4 looks worse, not better.
  const drawScale = Math.min(1, contentWidth / naturalWidth);
  const drawWidth = naturalWidth * drawScale;
  const totalDrawHeight = naturalHeight * drawScale;

  // Centre horizontally so a narrow capture is not pinned to the left margin.
  const drawX = margins.left + (contentWidth - drawWidth) / 2;

  const sliceCount = Math.max(1, Math.ceil(totalDrawHeight / contentHeight));
  const slices: ExactPageSlice[] = [];

  for (let index = 0; index < sliceCount; index += 1) {
    const drawHeight = Math.min(contentHeight, totalDrawHeight - index * contentHeight);
    const sourceHeight = (drawHeight / totalDrawHeight) * input.imageHeight;
    const sourceY = ((index * contentHeight) / totalDrawHeight) * input.imageHeight;

    slices.push({
      pageWidth: page.width,
      pageHeight: page.height,
      sourceX: 0,
      sourceY,
      sourceWidth: input.imageWidth,
      sourceHeight,
      drawX,
      // Slices are top-aligned; PDF's origin is the bottom-left corner.
      drawY: page.height - margins.top - drawHeight,
      drawWidth,
      drawHeight,
    });
  }

  return { slices, scaledDown: drawScale < 1 - 1e-9 };
}
