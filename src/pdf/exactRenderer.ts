/**
 * Renders a raster capture into PDF bytes.
 *
 * Each page slice is re-encoded from the stitched capture rather than drawn
 * from one shared image object. Drawing the whole capture on every page and
 * relying on the MediaBox to clip it would be smaller, but content belonging to
 * the neighbouring page then bleeds into the margins, and it makes the
 * transparent-background option impossible to honour. Slicing keeps the output
 * matching the preview under every combination of margins and background.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import { planExactLayout, type ExactPageSlice } from './exactLayout.js';
import { toStandardFontText } from './textEncoding.js';
import { QUALITY_SETTINGS } from '../shared/constants.js';
import { createError, err, fromThrown, ok, type Result } from '../shared/errors.js';
import { resolveMargins, marginsToPoints } from './units.js';
import type { CaptureSource, ExportOptions, VisualCapturePayload } from '../shared/types.js';

/** Abstracts the canvas so the renderer can be exercised without a browser. */
export interface RasterSlicer {
  /** Total capture size in image pixels. */
  readonly width: number;
  readonly height: number;
  /**
   * Encodes a sub-rectangle of the capture.
   * @returns image bytes plus the format they were encoded in.
   */
  encodeSlice(
    rect: { x: number; y: number; width: number; height: number },
    options: { format: 'image/png' | 'image/jpeg'; quality: number; flattenTo?: string },
  ): Promise<{ bytes: Uint8Array; format: 'image/png' | 'image/jpeg' }>;
}

export interface ExactRenderInput {
  readonly payload: VisualCapturePayload;
  readonly options: ExportOptions;
  readonly source: CaptureSource;
  readonly slicer: RasterSlicer;
}

export interface RenderedPdf {
  readonly bytes: Uint8Array;
  readonly pageCount: number;
}

const FOOTER_FONT_SIZE = 7;
const FOOTER_PADDING_PT = 10;

export async function renderExactPdf(input: ExactRenderInput): Promise<Result<RenderedPdf>> {
  const { payload, options, source, slicer } = input;

  if (payload.width <= 0 || payload.height <= 0) {
    return err(createError('RENDER_FAILED', 'empty capture'));
  }

  try {
    const margins = resolveMargins(options.marginPreset, options.customMargins);
    const layout = planExactLayout({
      imageWidth: payload.width,
      imageHeight: payload.height,
      scale: payload.scale,
      pageSize: options.pageSize,
      orientation: options.orientation,
      margins,
    });

    const pdf = await PDFDocument.create();
    applyDocumentMetadata(pdf, source, options);

    const quality = QUALITY_SETTINGS[options.quality];
    // Transparency can only survive in PNG, so a transparent background forces
    // the format regardless of the quality preset's usual choice.
    const format = options.background === 'transparent' ? 'image/png' : quality.format;
    const flattenTo = options.background === 'transparent' ? undefined : '#ffffff';

    const footerFont = options.metadata.includeFooter ? await pdf.embedFont(StandardFonts.Helvetica) : null;

    for (const slice of layout.slices) {
      const encoded = await slicer.encodeSlice(
        {
          x: Math.round(slice.sourceX),
          y: Math.round(slice.sourceY),
          width: Math.max(1, Math.round(slice.sourceWidth)),
          height: Math.max(1, Math.round(slice.sourceHeight)),
        },
        {
          format,
          quality: quality.jpegQuality,
          ...(flattenTo === undefined ? {} : { flattenTo }),
        },
      );

      const image: PDFImage =
        encoded.format === 'image/png'
          ? await pdf.embedPng(encoded.bytes)
          : await pdf.embedJpg(encoded.bytes);

      const page = pdf.addPage([slice.pageWidth, slice.pageHeight]);

      if (options.background === 'forceLight') {
        page.drawRectangle({
          x: 0,
          y: 0,
          width: slice.pageWidth,
          height: slice.pageHeight,
          color: rgb(1, 1, 1),
        });
      }

      page.drawImage(image, {
        x: slice.drawX,
        y: slice.drawY,
        width: slice.drawWidth,
        height: slice.drawHeight,
      });

      if (footerFont !== null) {
        drawFooter(page, footerFont, slice, source, options);
      }
    }

    const bytes = await pdf.save({ useObjectStreams: true });
    return ok({ bytes, pageCount: layout.slices.length });
  } catch (thrown) {
    return err(fromThrown(thrown, 'RENDER_FAILED'));
  }
}

/**
 * Writes the PDF's own metadata fields. These follow the same opt-in choices as
 * the visible footer, so a user who turned the source URL off does not find it
 * embedded in the file's properties.
 */
export function applyDocumentMetadata(pdf: PDFDocument, source: CaptureSource, options: ExportOptions): void {
  pdf.setProducer('ExactPDF');
  pdf.setCreator('ExactPDF');

  if (options.metadata.includeTitle) {
    pdf.setTitle(toStandardFontText(source.title));
  }
  if (options.metadata.includeSourceUrl) {
    pdf.setSubject(toStandardFontText(source.url));
  }
  if (options.metadata.includeCaptureDate) {
    const capturedAt = new Date(source.capturedAt);
    if (!Number.isNaN(capturedAt.getTime())) {
      pdf.setCreationDate(capturedAt);
      pdf.setModificationDate(capturedAt);
    }
  }
}

/** Assembles the footer line from whichever metadata fields are enabled. */
export function buildFooterText(source: CaptureSource, options: ExportOptions): string {
  const parts: string[] = [];
  if (options.metadata.includeTitle && source.title !== '') {
    parts.push(source.title);
  }
  if (options.metadata.includeSourceUrl && source.url !== '') {
    parts.push(source.url);
  }
  if (options.metadata.includeCaptureDate) {
    const capturedAt = new Date(source.capturedAt);
    if (!Number.isNaN(capturedAt.getTime())) {
      parts.push(`Captured ${capturedAt.toISOString().slice(0, 10)}`);
    }
  }
  return toStandardFontText(parts.join('  -  '));
}

interface FooterTarget {
  drawText(
    text: string,
    options: { x: number; y: number; size: number; font: PDFFont; color: ReturnType<typeof rgb> },
  ): void;
}

function drawFooter(
  page: FooterTarget,
  font: PDFFont,
  slice: ExactPageSlice,
  source: CaptureSource,
  options: ExportOptions,
): void {
  const text = buildFooterText(source, options);
  if (text === '') {
    return;
  }

  const margins = marginsToPoints(resolveMargins(options.marginPreset, options.customMargins));
  const available = slice.pageWidth - margins.left - margins.right;
  const clipped = clipTextToWidth(text, font, FOOTER_FONT_SIZE, available);

  page.drawText(clipped, {
    x: Math.max(FOOTER_PADDING_PT, margins.left),
    // Zero margins leave no room below the image, so the footer sits just
    // inside the page edge rather than off it.
    y: Math.max(4, margins.bottom - FOOTER_PADDING_PT),
    size: FOOTER_FONT_SIZE,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
}

/** Truncates with an ellipsis so a long URL cannot run off the page. */
export function clipTextToWidth(
  text: string,
  font: Pick<PDFFont, 'widthOfTextAtSize'>,
  size: number,
  maxWidth: number,
): string {
  if (maxWidth <= 0 || font.widthOfTextAtSize(text, size) <= maxWidth) {
    return text;
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (font.widthOfTextAtSize(`${text.slice(0, mid)}...`, size) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low === 0 ? '' : `${text.slice(0, low)}...`;
}
