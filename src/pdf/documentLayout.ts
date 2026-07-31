/**
 * Line breaking and pagination for Document mode.
 *
 * This is a deliberately small typesetting engine: consistent typography and
 * predictable page breaks, rather than an attempt to reproduce the source
 * page's CSS. Layout is computed separately from drawing so it can be tested
 * against a stub font, and so the preview and the exported file are guaranteed
 * to paginate identically.
 */

import type { DocBlock, DocSpan } from '../shared/types.js';

/** Just enough of a font to measure with; satisfied by pdf-lib's `PDFFont`. */
export interface MeasurableFont {
  widthOfTextAtSize(text: string, size: number): number;
  heightAtSize(size: number): number;
}

export type FontRole = 'body' | 'bold' | 'italic' | 'boldItalic' | 'mono';

export interface FontSet {
  readonly body: MeasurableFont;
  readonly bold: MeasurableFont;
  readonly italic: MeasurableFont;
  readonly boldItalic: MeasurableFont;
  readonly mono: MeasurableFont;
}

/** A run of text on one line, already measured and positioned. */
export interface PositionedRun {
  readonly text: string;
  readonly x: number;
  readonly size: number;
  readonly role: FontRole;
  readonly href?: string;
  readonly width: number;
}

export interface LaidOutLine {
  readonly runs: PositionedRun[];
  /** Distance from the line's baseline to the top of its box. */
  readonly height: number;
}

export type LaidOutItem =
  | { readonly kind: 'line'; readonly line: LaidOutLine; readonly y: number }
  | {
      readonly kind: 'image';
      readonly dataUrl: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'rule'; readonly y: number; readonly x: number; readonly width: number }
  | {
      readonly kind: 'codeBackground';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };

export interface LaidOutPage {
  readonly items: LaidOutItem[];
}

export interface DocumentLayoutOptions {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly margins: { top: number; right: number; bottom: number; left: number };
  readonly baseFontSize: number;
  readonly fonts: FontSet;
  /** Extra bottom space reserved on every page for the metadata footer. */
  readonly footerHeight: number;
}

export interface DocumentLayout {
  readonly pages: LaidOutPage[];
}

const HEADING_SCALE: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1: 1.9,
  2: 1.55,
  3: 1.3,
  4: 1.15,
  5: 1.05,
  6: 1,
};

const LINE_HEIGHT_RATIO = 1.45;
const PARAGRAPH_SPACING_RATIO = 0.65;
const HEADING_SPACE_ABOVE_RATIO = 1.1;
const LIST_INDENT_RATIO = 1.4;
const QUOTE_INDENT_RATIO = 1.2;
const CODE_PADDING_RATIO = 0.5;
const TABLE_CELL_PADDING_RATIO = 0.3;

/**
 * Flows the block list into pages.
 *
 * A single cursor walks down the content box, starting a new page whenever the
 * next line would cross the bottom. Blocks are never split across pages except
 * where splitting is the only sensible option (long paragraphs, code blocks and
 * tables), because an orphaned heading reads far worse than a slightly short
 * page.
 */
export function layoutDocument(blocks: DocBlock[], options: DocumentLayoutOptions): DocumentLayout {
  const contentLeft = options.margins.left;
  const contentWidth = options.pageWidth - options.margins.left - options.margins.right;
  const contentTop = options.pageHeight - options.margins.top;
  const contentBottom = options.margins.bottom + options.footerHeight;

  const pages: LaidOutPage[] = [];
  let items: LaidOutItem[] = [];
  let cursor = contentTop;

  const flushPage = (): void => {
    pages.push({ items });
    items = [];
    cursor = contentTop;
  };

  /** Reserves vertical space, starting a new page when the block will not fit. */
  const reserve = (height: number): void => {
    if (cursor - height < contentBottom && items.length > 0) {
      flushPage();
    }
  };

  const emitLines = (lines: LaidOutLine[], xOffset: number, lineHeight: number): void => {
    for (const line of lines) {
      reserve(lineHeight);
      cursor -= lineHeight;
      items.push({
        kind: 'line',
        y: cursor,
        line: {
          height: line.height,
          runs: line.runs.map((run) => ({ ...run, x: run.x + xOffset })),
        },
      });
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'pageBreak':
        if (items.length > 0) {
          flushPage();
        }
        break;

      case 'heading': {
        const size = options.baseFontSize * HEADING_SCALE[block.level];
        const lineHeight = size * 1.3;
        cursor -= size * HEADING_SPACE_ABOVE_RATIO;

        // Keep a heading with the line that follows it.
        reserve(lineHeight * 2);
        emitLines(wrapSpans(block.spans, contentWidth, size, options.fonts, true), contentLeft, lineHeight);
        cursor -= size * 0.25;
        break;
      }

      case 'paragraph': {
        const size = options.baseFontSize;
        emitLines(
          wrapSpans(block.spans, contentWidth, size, options.fonts, false),
          contentLeft,
          size * LINE_HEIGHT_RATIO,
        );
        cursor -= size * PARAGRAPH_SPACING_RATIO;
        break;
      }

      case 'caption': {
        const size = options.baseFontSize * 0.85;
        emitLines(
          wrapSpans(
            block.spans.map((span) => ({ ...span, italic: true })),
            contentWidth,
            size,
            options.fonts,
            false,
          ),
          contentLeft,
          size * LINE_HEIGHT_RATIO,
        );
        cursor -= size * PARAGRAPH_SPACING_RATIO;
        break;
      }

      case 'quote': {
        const size = options.baseFontSize;
        const indent = size * QUOTE_INDENT_RATIO;
        emitLines(
          wrapSpans(
            block.spans.map((span) => ({ ...span, italic: true })),
            contentWidth - indent,
            size,
            options.fonts,
            false,
          ),
          contentLeft + indent,
          size * LINE_HEIGHT_RATIO,
        );
        cursor -= size * PARAGRAPH_SPACING_RATIO;
        break;
      }

      case 'list': {
        const size = options.baseFontSize;
        const indent = size * LIST_INDENT_RATIO;

        block.items.forEach((item, index) => {
          const marker = block.ordered ? `${index + 1}.` : '*';
          const lines = wrapSpans(item, contentWidth - indent, size, options.fonts, false);

          lines.forEach((line, lineIndex) => {
            const lineHeight = size * LINE_HEIGHT_RATIO;
            reserve(lineHeight);
            cursor -= lineHeight;

            const runs: PositionedRun[] = line.runs.map((run) => ({
              ...run,
              x: run.x + contentLeft + indent,
            }));

            // The marker sits in the indent, aligned with the item's first line.
            if (lineIndex === 0) {
              runs.unshift({
                text: marker,
                x: contentLeft,
                size,
                role: 'body',
                width: options.fonts.body.widthOfTextAtSize(marker, size),
              });
            }
            items.push({ kind: 'line', y: cursor, line: { height: line.height, runs } });
          });
          cursor -= size * 0.2;
        });
        cursor -= size * PARAGRAPH_SPACING_RATIO * 0.5;
        break;
      }

      case 'code': {
        const size = options.baseFontSize * 0.85;
        const lineHeight = size * 1.35;
        const padding = size * CODE_PADDING_RATIO;
        const codeLines = wrapCode(block.text, contentWidth - padding * 2, size, options.fonts.mono);

        // The tinted background is emitted per page so a split block still
        // looks like one continuous listing.
        let runStart = cursor;
        let linesOnPage = 0;

        const closeBackground = (): void => {
          if (linesOnPage > 0) {
            items.unshift({
              kind: 'codeBackground',
              x: contentLeft,
              y: cursor - padding,
              width: contentWidth,
              height: runStart - cursor + padding * 2,
            });
          }
        };

        cursor -= padding;
        for (const text of codeLines) {
          if (cursor - lineHeight < contentBottom && items.length > 0) {
            closeBackground();
            flushPage();
            runStart = cursor;
            linesOnPage = 0;
            cursor -= padding;
          }
          cursor -= lineHeight;
          linesOnPage += 1;
          items.push({
            kind: 'line',
            y: cursor,
            line: {
              height: lineHeight,
              runs: [
                {
                  text,
                  x: contentLeft + padding,
                  size,
                  role: 'mono',
                  width: options.fonts.mono.widthOfTextAtSize(text, size),
                },
              ],
            },
          });
        }
        closeBackground();
        cursor -= padding + size * PARAGRAPH_SPACING_RATIO;
        break;
      }

      case 'table': {
        const size = options.baseFontSize * 0.85;
        const rows = block.header === null ? block.rows : [block.header, ...block.rows];
        const widths = columnWidths(rows, contentWidth, size, options.fonts);
        const lineHeight = size * LINE_HEIGHT_RATIO;
        const padding = size * TABLE_CELL_PADDING_RATIO;

        rows.forEach((row, rowIndex) => {
          const isHeader = block.header !== null && rowIndex === 0;
          const cellLines = row.map((cell, columnIndex) =>
            wrapCode(
              cell,
              (widths[columnIndex] ?? contentWidth) - padding * 2,
              size,
              isHeader ? options.fonts.bold : options.fonts.body,
            ),
          );
          const rowHeight = Math.max(1, ...cellLines.map((lines) => lines.length)) * lineHeight;

          reserve(rowHeight);
          const rowTop = cursor;

          cellLines.forEach((lines, columnIndex) => {
            let x = contentLeft;
            for (let index = 0; index < columnIndex; index += 1) {
              x += widths[index] ?? 0;
            }
            lines.forEach((text, lineIndex) => {
              items.push({
                kind: 'line',
                y: rowTop - lineHeight * (lineIndex + 1),
                line: {
                  height: lineHeight,
                  runs: [
                    {
                      text,
                      x: x + padding,
                      size,
                      role: isHeader ? 'bold' : 'body',
                      width: 0,
                    },
                  ],
                },
              });
            });
          });

          cursor = rowTop - rowHeight;
          items.push({ kind: 'rule', y: cursor, x: contentLeft, width: contentWidth });
        });
        cursor -= size * PARAGRAPH_SPACING_RATIO;
        break;
      }

      case 'image': {
        const aspect = block.height / Math.max(1, block.width);
        const width = Math.min(contentWidth, block.width);
        const height = width * aspect;

        // An image taller than the content box is scaled to fit one page rather
        // than split, which would cut a diagram in half.
        const available = contentTop - contentBottom;
        const finalHeight = Math.min(height, available);
        const finalWidth = finalHeight === height ? width : finalHeight / aspect;

        reserve(finalHeight);
        cursor -= finalHeight;
        items.push({
          kind: 'image',
          dataUrl: block.dataUrl,
          x: contentLeft + (contentWidth - finalWidth) / 2,
          y: cursor,
          width: finalWidth,
          height: finalHeight,
        });
        cursor -= options.baseFontSize * PARAGRAPH_SPACING_RATIO;
        break;
      }

      case 'rule': {
        reserve(options.baseFontSize);
        cursor -= options.baseFontSize * 0.5;
        items.push({ kind: 'rule', y: cursor, x: contentLeft, width: contentWidth });
        cursor -= options.baseFontSize * 0.5;
        break;
      }
    }
  }

  if (items.length > 0 || pages.length === 0) {
    pages.push({ items });
  }
  return { pages };
}

function fontFor(span: Pick<DocSpan, 'bold' | 'italic' | 'code'>, forceBold: boolean): FontRole {
  if (span.code === true) {
    return 'mono';
  }
  const bold = span.bold === true || forceBold;
  if (bold && span.italic === true) {
    return 'boldItalic';
  }
  if (bold) {
    return 'bold';
  }
  return span.italic === true ? 'italic' : 'body';
}

/**
 * Greedy line breaking across styled runs.
 *
 * Breaking is on whitespace, with an overlong single word placed on its own
 * line rather than hyphenated: a URL split mid-token is unreadable and, worse,
 * uncopyable.
 */
export function wrapSpans(
  spans: DocSpan[],
  maxWidth: number,
  size: number,
  fonts: FontSet,
  forceBold: boolean,
): LaidOutLine[] {
  const lines: LaidOutLine[] = [];
  let runs: PositionedRun[] = [];
  let x = 0;

  const flush = (): void => {
    if (runs.length > 0) {
      lines.push({ runs, height: size * LINE_HEIGHT_RATIO });
      runs = [];
      x = 0;
    }
  };

  for (const span of spans) {
    const role = fontFor(span, forceBold);
    const font = fonts[role];

    for (const segment of span.text.split('\n')) {
      if (segment !== span.text) {
        flush();
      }
      // Keep the separators so inter-word spacing survives the split.
      for (const token of segment.split(/(\s+)/)) {
        if (token === '') {
          continue;
        }
        const width = font.widthOfTextAtSize(token, size);

        if (x + width > maxWidth && x > 0) {
          flush();
          if (/^\s+$/.test(token)) {
            continue;
          }
        }

        runs.push({
          text: token,
          x,
          size,
          role,
          width,
          ...(span.href === undefined ? {} : { href: span.href }),
        });
        x += width;
      }
    }
  }

  flush();
  return lines;
}

/** Hard-wraps preformatted text, which has no reflowable whitespace. */
export function wrapCode(text: string, maxWidth: number, size: number, font: MeasurableFont): string[] {
  const output: string[] = [];

  for (const line of text.split('\n')) {
    if (font.widthOfTextAtSize(line, size) <= maxWidth) {
      output.push(line);
      continue;
    }
    let current = '';
    for (const character of line) {
      if (font.widthOfTextAtSize(current + character, size) > maxWidth && current !== '') {
        output.push(current);
        current = '';
      }
      current += character;
    }
    if (current !== '') {
      output.push(current);
    }
  }
  return output;
}

/**
 * Distributes table width by each column's natural content width, so a narrow
 * "Yes/No" column does not claim the same space as a sentence.
 */
export function columnWidths(rows: string[][], totalWidth: number, size: number, fonts: FontSet): number[] {
  const count = Math.max(...rows.map((row) => row.length), 1);
  const natural = new Array<number>(count).fill(0);

  for (const row of rows) {
    row.forEach((cell, index) => {
      const width = fonts.body.widthOfTextAtSize(cell, size);
      natural[index] = Math.max(natural[index] ?? 0, Math.min(width, totalWidth / 2));
    });
  }

  const sum = natural.reduce((total, width) => total + width, 0);
  if (sum === 0) {
    return new Array<number>(count).fill(totalWidth / count);
  }
  return natural.map((width) => (width / sum) * totalWidth);
}
