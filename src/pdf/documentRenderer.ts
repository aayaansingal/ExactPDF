/**
 * Draws a laid-out document into PDF bytes with selectable text and working
 * links.
 *
 * Text is drawn as text operators rather than rasterized, which is the entire
 * point of Document mode: the result is searchable, copyable, and a fraction of
 * the size of the equivalent Exact export.
 */

import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import { layoutDocument, type FontSet } from './documentLayout.js';
import { applyDocumentMetadata, buildFooterText, clipTextToWidth } from './exactRenderer.js';
import { encodeBlocksForStandardFont } from './textEncoding.js';
import {
  resolveMargins,
  marginsToPoints,
  PAPER_SIZES,
  applyOrientation,
  cssPixelsToPoints,
} from './units.js';
import { err, fromThrown, ok, type Result } from '../shared/errors.js';
import type { CaptureSource, DocBlock, DocumentCapturePayload, ExportOptions } from '../shared/types.js';
import type { RenderedPdf } from './exactRenderer.js';

const BASE_FONT_SIZE = 11;
const FOOTER_FONT_SIZE = 7;
const LINK_COLOR = rgb(0.11, 0.34, 0.75);
const TEXT_COLOR = rgb(0.1, 0.11, 0.13);
const RULE_COLOR = rgb(0.82, 0.84, 0.87);
const CODE_BACKGROUND = rgb(0.96, 0.965, 0.975);

/** Document mode ignores `original`, which has no meaning without a raster. */
const DEFAULT_DOCUMENT_PAGE: 'a4' | 'letter' = 'a4';

/** Width of a continuous page, chosen to match a comfortable reading measure. */
const CONTINUOUS_PAGE_WIDTH_PT = cssPixelsToPoints(820);

export interface DocumentRenderInput {
  readonly payload: DocumentCapturePayload;
  readonly options: ExportOptions;
  readonly source: CaptureSource;
}

export async function renderDocumentPdf(input: DocumentRenderInput): Promise<Result<RenderedPdf>> {
  const { payload, options, source } = input;

  try {
    const pdf = await PDFDocument.create();
    applyDocumentMetadata(pdf, source, options);

    const fonts = {
      body: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
      mono: await pdf.embedFont(StandardFonts.Courier),
    };

    const margins = marginsToPoints(resolveMargins(options.marginPreset, options.customMargins));
    const page = resolvePageSize(options);
    const footerText = options.metadata.includeFooter ? buildFooterText(source, options) : '';
    const footerHeight = footerText === '' ? 0 : FOOTER_FONT_SIZE * 2;

    // Encoding precedes layout so that line breaking measures exactly the text
    // that will be drawn, and so an unencodable character cannot throw from
    // inside the measurement pass.
    const blocks = encodeBlocksForStandardFont(withHeading(payload, options));

    const layout = layoutDocument(blocks, {
      pageWidth: page.width,
      pageHeight: page.height,
      margins,
      baseFontSize: BASE_FONT_SIZE,
      fonts: fonts as FontSet,
      footerHeight,
    });

    // Images are embedded once and reused: the same figure can legitimately
    // appear more than once in a document, and re-embedding would duplicate it
    // in the file.
    const imageCache = new Map<string, Awaited<ReturnType<typeof embedImage>>>();

    for (const laidOutPage of layout.pages) {
      const pdfPage = pdf.addPage([page.width, page.height]);

      if (options.background === 'forceLight' || options.background === 'preserve') {
        pdfPage.drawRectangle({
          x: 0,
          y: 0,
          width: page.width,
          height: page.height,
          color: rgb(1, 1, 1),
        });
      }

      // Backgrounds first, so text and rules land on top of them.
      for (const item of laidOutPage.items) {
        if (item.kind === 'codeBackground') {
          pdfPage.drawRectangle({
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            color: CODE_BACKGROUND,
          });
        }
      }

      for (const item of laidOutPage.items) {
        switch (item.kind) {
          case 'codeBackground':
            break;

          case 'rule':
            pdfPage.drawLine({
              start: { x: item.x, y: item.y },
              end: { x: item.x + item.width, y: item.y },
              thickness: 0.5,
              color: RULE_COLOR,
            });
            break;

          case 'image': {
            let embedded = imageCache.get(item.dataUrl);
            if (embedded === undefined) {
              embedded = await embedImage(pdf, item.dataUrl);
              imageCache.set(item.dataUrl, embedded);
            }
            if (embedded !== null) {
              pdfPage.drawImage(embedded, {
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
              });
            }
            break;
          }

          case 'line':
            for (const run of item.line.runs) {
              // Already encoded before layout; drawing it again would be a
              // second lossy pass over text that is known to be safe.
              const text = run.text;
              if (text.trim() === '') {
                continue;
              }
              const font = fonts[run.role];

              pdfPage.drawText(text, {
                x: run.x,
                y: item.y,
                size: run.size,
                font,
                color: run.href === undefined ? TEXT_COLOR : LINK_COLOR,
              });

              if (run.href !== undefined) {
                addLinkAnnotation(pdf, pdfPage, {
                  x: run.x,
                  y: item.y - run.size * 0.2,
                  width: font.widthOfTextAtSize(text, run.size),
                  height: run.size * 1.2,
                  url: run.href,
                });
              }
            }
            break;
        }
      }

      if (footerText !== '') {
        const clipped = clipTextToWidth(
          footerText,
          fonts.body,
          FOOTER_FONT_SIZE,
          page.width - margins.left - margins.right,
        );
        pdfPage.drawText(clipped, {
          x: margins.left,
          y: Math.max(6, margins.bottom - FOOTER_FONT_SIZE * 1.5),
          size: FOOTER_FONT_SIZE,
          font: fonts.body,
          color: rgb(0.45, 0.47, 0.5),
        });
      }
    }

    const bytes = await pdf.save({ useObjectStreams: true });
    return ok({ bytes, pageCount: layout.pages.length });
  } catch (thrown) {
    return err(fromThrown(thrown, 'RENDER_FAILED'));
  }
}

/** Prepends the article title unless the user turned title metadata off. */
function withHeading(payload: DocumentCapturePayload, options: ExportOptions): DocBlock[] {
  if (!options.metadata.includeTitle || payload.heading.trim() === '') {
    return payload.blocks;
  }
  const alreadyLeads =
    payload.blocks[0]?.type === 'heading' &&
    payload.blocks[0].spans
      .map((span) => span.text)
      .join('')
      .trim() === payload.heading.trim();

  return alreadyLeads
    ? payload.blocks
    : [{ type: 'heading', level: 1, spans: [{ text: payload.heading }] }, ...payload.blocks];
}

function resolvePageSize(options: ExportOptions): { width: number; height: number } {
  if (options.pageSize === 'continuous') {
    // A very tall single page defeats the purpose of Document mode, so
    // "continuous" here means a narrow, screen-shaped page instead.
    return { width: CONTINUOUS_PAGE_WIDTH_PT, height: CONTINUOUS_PAGE_WIDTH_PT * 1.6 };
  }
  const paper =
    options.pageSize === 'a4' || options.pageSize === 'letter'
      ? PAPER_SIZES[options.pageSize]
      : PAPER_SIZES[DEFAULT_DOCUMENT_PAGE];

  // Aspect ratio below 1 keeps `auto` in portrait, which is right for prose.
  return applyOrientation(paper, options.orientation, 0.7);
}

async function embedImage(
  pdf: PDFDocument,
  dataUrl: string,
): Promise<Awaited<ReturnType<PDFDocument['embedPng']>> | null> {
  try {
    if (dataUrl.startsWith('data:image/png')) {
      return await pdf.embedPng(dataUrl);
    }
    if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
      return await pdf.embedJpg(dataUrl);
    }
    return null;
  } catch {
    // A corrupt image must not fail the whole export.
    return null;
  }
}

/**
 * Attaches a clickable link rectangle.
 *
 * pdf-lib has no high-level link API, so the annotation dictionary is built
 * directly. `/Border [0 0 0]` suppresses the reader's default outline, which
 * would otherwise box every link in the document.
 */
function addLinkAnnotation(
  pdf: PDFDocument,
  page: PDFPage,
  link: { x: number; y: number; width: number; height: number; url: string },
): void {
  const annotation = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [link.x, link.y, link.x + link.width, link.y + link.height],
    Border: [0, 0, 0],
    A: {
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of(link.url),
    },
  });

  const existing = page.node.lookup(PDFName.of('Annots'));
  if (existing instanceof PDFArray) {
    existing.push(annotation);
  } else {
    page.node.set(PDFName.of('Annots'), pdf.context.obj([annotation]));
  }
}
