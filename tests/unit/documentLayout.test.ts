import { describe, expect, it } from 'vitest';
import {
  columnWidths,
  layoutDocument,
  wrapCode,
  wrapSpans,
  type DocumentLayoutOptions,
  type FontSet,
  type MeasurableFont,
} from '../../src/pdf/documentLayout.js';
import type { DocBlock } from '../../src/shared/types.js';

/**
 * A monospace stub: every character is exactly half the font size wide. This
 * makes wrapping arithmetic exact, so the tests assert on layout decisions
 * rather than on a real font's metrics.
 */
const stubFont: MeasurableFont = {
  widthOfTextAtSize: (text, size) => text.length * size * 0.5,
  heightAtSize: (size) => size,
};

const FONTS: FontSet = {
  body: stubFont,
  bold: stubFont,
  italic: stubFont,
  boldItalic: stubFont,
  mono: stubFont,
};

function options(overrides: Partial<DocumentLayoutOptions> = {}): DocumentLayoutOptions {
  return {
    pageWidth: 600,
    pageHeight: 800,
    margins: { top: 50, right: 50, bottom: 50, left: 50 },
    baseFontSize: 10,
    fonts: FONTS,
    footerHeight: 0,
    ...overrides,
  };
}

function allRunText(layout: ReturnType<typeof layoutDocument>): string {
  return layout.pages
    .flatMap((page) => page.items)
    .filter((item) => item.kind === 'line')
    .flatMap((item) => (item.kind === 'line' ? item.line.runs : []))
    .map((run) => run.text)
    .join('');
}

describe('wrapSpans', () => {
  it('keeps a short line on one line', () => {
    const lines = wrapSpans([{ text: 'hello world' }], 500, 10, FONTS, false);
    expect(lines).toHaveLength(1);
  });

  it('breaks on whitespace when the line is full', () => {
    // Each char is 5pt wide at size 10, so 100pt holds 20 characters.
    const lines = wrapSpans([{ text: 'aaaa bbbb cccc dddd eeee' }], 100, 10, FONTS, false);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const width = line.runs.reduce((total, run) => total + run.width, 0);
      expect(width).toBeLessThanOrEqual(105);
    }
  });

  it('places an overlong single token on its own line rather than splitting it', () => {
    const lines = wrapSpans([{ text: 'short verylongsingletokenthatcannotfit' }], 60, 10, FONTS, false);
    const tokens = lines.flatMap((line) => line.runs.map((run) => run.text));
    expect(tokens).toContain('verylongsingletokenthatcannotfit');
  });

  it('starts a new line at an explicit newline', () => {
    const lines = wrapSpans([{ text: 'a\nb' }], 500, 10, FONTS, false);
    expect(lines).toHaveLength(2);
  });

  it('carries the link target onto every run of the link', () => {
    const lines = wrapSpans([{ text: 'click here now', href: 'https://example.com' }], 500, 10, FONTS, false);
    for (const run of lines[0]!.runs) {
      expect(run.href).toBe('https://example.com');
    }
  });

  it('positions runs left to right without overlap', () => {
    const lines = wrapSpans([{ text: 'aa bb cc' }], 500, 10, FONTS, false);
    const runs = lines[0]!.runs;
    for (let index = 1; index < runs.length; index += 1) {
      expect(runs[index]!.x).toBeGreaterThanOrEqual(runs[index - 1]!.x);
    }
  });

  it('does not begin a line with the whitespace it wrapped on', () => {
    const lines = wrapSpans([{ text: 'aaaaa bbbbb ccccc' }], 55, 10, FONTS, false);
    for (const line of lines) {
      expect(line.runs[0]!.text.trim()).not.toBe('');
    }
  });

  it('returns nothing for empty input', () => {
    expect(wrapSpans([], 500, 10, FONTS, false)).toEqual([]);
  });
});

describe('wrapCode', () => {
  it('leaves lines that fit untouched', () => {
    expect(wrapCode('short', 500, 10, stubFont)).toEqual(['short']);
  });

  it('hard-wraps a line with no whitespace', () => {
    const lines = wrapCode('abcdefghij', 25, 10, stubFont);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('abcdefghij');
  });

  it('preserves existing line structure and indentation', () => {
    expect(wrapCode('a\n  b', 500, 10, stubFont)).toEqual(['a', '  b']);
  });
});

describe('columnWidths', () => {
  it('distributes the full width across the columns', () => {
    const widths = columnWidths([['a', 'bbbb']], 400, 10, FONTS);
    expect(widths.reduce((total, width) => total + width, 0)).toBeCloseTo(400, 4);
  });

  it('gives a wider column to longer content', () => {
    const widths = columnWidths([['a', 'bbbbbbbbbb']], 400, 10, FONTS);
    expect(widths[1]!).toBeGreaterThan(widths[0]!);
  });

  it('falls back to equal columns when every cell is empty', () => {
    const widths = columnWidths([['', '']], 400, 10, FONTS);
    expect(widths[0]).toBeCloseTo(200, 4);
    expect(widths[1]).toBeCloseTo(200, 4);
  });
});

describe('layoutDocument', () => {
  it('produces one page for short content', () => {
    const layout = layoutDocument([{ type: 'paragraph', spans: [{ text: 'hi' }] }], options());
    expect(layout.pages).toHaveLength(1);
  });

  it('always produces at least one page, even with no content', () => {
    expect(layoutDocument([], options()).pages).toHaveLength(1);
  });

  it('flows long content onto further pages', () => {
    const blocks: DocBlock[] = Array.from({ length: 200 }, (_, index) => ({
      type: 'paragraph',
      spans: [{ text: `paragraph number ${index}` }],
    }));
    expect(layoutDocument(blocks, options()).pages.length).toBeGreaterThan(1);
  });

  it('keeps every line inside the content box', () => {
    const blocks: DocBlock[] = Array.from({ length: 100 }, () => ({
      type: 'paragraph',
      spans: [{ text: 'some body text that will wrap across the measure' }],
    }));
    const config = options();
    const layout = layoutDocument(blocks, config);

    for (const page of layout.pages) {
      for (const item of page.items) {
        if (item.kind === 'line') {
          expect(item.y).toBeGreaterThanOrEqual(config.margins.bottom - config.baseFontSize);
          expect(item.y).toBeLessThanOrEqual(config.pageHeight - config.margins.top);
          for (const run of item.line.runs) {
            expect(run.x).toBeGreaterThanOrEqual(config.margins.left - 0.001);
          }
        }
      }
    }
  });

  it('starts a new page at an explicit page break', () => {
    const layout = layoutDocument(
      [
        { type: 'paragraph', spans: [{ text: 'first' }] },
        { type: 'pageBreak' },
        { type: 'paragraph', spans: [{ text: 'second' }] },
      ],
      options(),
    );
    expect(layout.pages).toHaveLength(2);
  });

  it('ignores a page break before any content', () => {
    const layout = layoutDocument(
      [{ type: 'pageBreak' }, { type: 'paragraph', spans: [{ text: 'only' }] }],
      options(),
    );
    expect(layout.pages).toHaveLength(1);
  });

  it('loses no text across pagination', () => {
    const blocks: DocBlock[] = Array.from({ length: 80 }, (_, index) => ({
      type: 'paragraph',
      spans: [{ text: `unique${index}` }],
    }));
    const text = allRunText(layoutDocument(blocks, options()));
    for (let index = 0; index < 80; index += 1) {
      expect(text).toContain(`unique${index}`);
    }
  });

  it('sizes headings above body text', () => {
    const layout = layoutDocument(
      [
        { type: 'heading', level: 1, spans: [{ text: 'Big' }] },
        { type: 'paragraph', spans: [{ text: 'small' }] },
      ],
      options(),
    );
    const lines = layout.pages[0]!.items.filter((item) => item.kind === 'line');
    const headingSize = lines[0]!.kind === 'line' ? lines[0]!.line.runs[0]!.size : 0;
    const bodySize = lines[1]!.kind === 'line' ? lines[1]!.line.runs[0]!.size : 0;
    expect(headingSize).toBeGreaterThan(bodySize);
  });

  it('prefixes list items with a marker aligned in the indent', () => {
    const layout = layoutDocument(
      [{ type: 'list', ordered: true, items: [[{ text: 'first' }], [{ text: 'second' }]] }],
      options(),
    );
    const runs = layout.pages[0]!.items.filter((item) => item.kind === 'line').flatMap((item) =>
      item.kind === 'line' ? item.line.runs : [],
    );

    expect(runs.map((run) => run.text)).toContain('1.');
    expect(runs.map((run) => run.text)).toContain('2.');
    const marker = runs.find((run) => run.text === '1.')!;
    const body = runs.find((run) => run.text === 'first')!;
    expect(marker.x).toBeLessThan(body.x);
  });

  it('uses a bullet for unordered lists', () => {
    const layout = layoutDocument([{ type: 'list', ordered: false, items: [[{ text: 'item' }]] }], options());
    const runs = layout.pages[0]!.items.filter((item) => item.kind === 'line').flatMap((item) =>
      item.kind === 'line' ? item.line.runs : [],
    );
    expect(runs[0]!.text).toBe('*');
  });

  it('draws code in the monospace role over a tinted background', () => {
    const layout = layoutDocument([{ type: 'code', text: 'x = 1' }], options());
    const items = layout.pages[0]!.items;
    expect(items.some((item) => item.kind === 'codeBackground')).toBe(true);

    const runs = items
      .filter((item) => item.kind === 'line')
      .flatMap((item) => (item.kind === 'line' ? item.line.runs : []));
    expect(runs[0]!.role).toBe('mono');
  });

  it('scales an oversized image to fit one page rather than splitting it', () => {
    const config = options();
    const layout = layoutDocument(
      [{ type: 'image', dataUrl: 'data:image/png;base64,A', width: 500, height: 5000, alt: '' }],
      config,
    );
    const image = layout.pages.flatMap((page) => page.items).find((item) => item.kind === 'image')!;

    expect(image.kind).toBe('image');
    if (image.kind === 'image') {
      const available = config.pageHeight - config.margins.top - config.margins.bottom;
      expect(image.height).toBeLessThanOrEqual(available + 0.001);
      expect(image.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('reserves the footer band so text never collides with it', () => {
    const withFooter = layoutDocument(
      Array.from({ length: 60 }, () => ({ type: 'paragraph', spans: [{ text: 'line' }] }) as DocBlock),
      options({ footerHeight: 40 }),
    );
    for (const page of withFooter.pages) {
      for (const item of page.items) {
        if (item.kind === 'line') {
          expect(item.y).toBeGreaterThanOrEqual(50 + 40 - 15);
        }
      }
    }
  });
});
