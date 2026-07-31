/**
 * End-to-end checks on the PDF writers.
 *
 * Each test renders real bytes and then re-opens them with pdf-lib, so the
 * assertions are about the file a user would actually receive -- page count,
 * page geometry, embedded metadata -- rather than about the layout structures
 * that produced it.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderExactPdf, type RasterSlicer } from '../../src/pdf/exactRenderer.js';
import { renderDocumentPdf } from '../../src/pdf/documentRenderer.js';
import { PAPER_SIZES, cssPixelsToPoints } from '../../src/pdf/units.js';
import { DEFAULT_SETTINGS } from '../../src/shared/settings.js';
import type {
  CaptureSource,
  DocBlock,
  DocumentCapturePayload,
  ExportOptions,
  VisualCapturePayload,
} from '../../src/shared/types.js';

/** A 1x1 opaque white PNG; the smallest input pdf-lib will accept. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const PNG_BYTES = Uint8Array.from(atob(PNG_1X1), (character) => character.charCodeAt(0));

const SOURCE: CaptureSource = {
  url: 'https://example.com/articles/one',
  title: 'An Example Article',
  capturedAt: '2026-07-23T12:00:00.000Z',
  contentLabel: 'Article',
};

function exportOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    renderMode: 'exact',
    pageSize: 'original',
    orientation: 'auto',
    marginPreset: 'zero',
    customMargins: DEFAULT_SETTINGS.customMargins,
    background: 'preserve',
    quality: 'balanced',
    filename: 'test.pdf',
    metadata: {
      includeSourceUrl: false,
      includeTitle: true,
      includeCaptureDate: false,
      includeFooter: false,
    },
    ...overrides,
  };
}

function visualPayload(overrides: Partial<VisualCapturePayload> = {}): VisualCapturePayload {
  return {
    kind: 'visual',
    dataUrl: 'data:image/png;base64,AAAA',
    width: 1600,
    height: 1200,
    scale: 2,
    format: 'image/png',
    tileCount: 1,
    mayBeIncomplete: false,
    ...overrides,
  };
}

/** Records the slice requests so the tests can assert on what was encoded. */
function slicer(payload: VisualCapturePayload): RasterSlicer & {
  requests: { x: number; y: number; width: number; height: number }[];
} {
  const requests: { x: number; y: number; width: number; height: number }[] = [];
  return {
    width: payload.width,
    height: payload.height,
    requests,
    async encodeSlice(rect) {
      requests.push(rect);
      return { bytes: PNG_BYTES, format: 'image/png' as const };
    },
  };
}

async function reopen(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes);
}

/**
 * The renderers save with object streams, which compresses the document
 * structure out of plain sight. Re-saving without them exposes the same objects
 * as readable text so a test can assert on what the file actually contains.
 */
async function rawText(bytes: Uint8Array): Promise<string> {
  const reopened = await PDFDocument.load(bytes);
  const expanded = await reopened.save({ useObjectStreams: false });
  return new TextDecoder('latin1').decode(expanded);
}

describe('renderExactPdf', () => {
  it('produces a loadable PDF file', async () => {
    const payload = visualPayload();
    const result = await renderExactPdf({
      payload,
      options: exportOptions(),
      source: SOURCE,
      slicer: slicer(payload),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(new TextDecoder().decode(result.value.bytes.slice(0, 5))).toBe('%PDF-');
    const reopened = await reopen(result.value.bytes);
    expect(reopened.getPageCount()).toBe(1);
  });

  it('sizes an original-size page to the capture at 96 DPI', async () => {
    const payload = visualPayload();
    const result = await renderExactPdf({
      payload,
      options: exportOptions({ pageSize: 'original' }),
      source: SOURCE,
      slicer: slicer(payload),
    });
    if (!result.ok) throw new Error('render failed');

    const [page] = (await reopen(result.value.bytes)).getPages();
    // 1600 device px at scale 2 = 800 CSS px = 600 pt.
    expect(page!.getWidth()).toBeCloseTo(cssPixelsToPoints(800), 1);
    expect(page!.getHeight()).toBeCloseTo(cssPixelsToPoints(600), 1);
  });

  it('emits standard A4 pages when asked for A4', async () => {
    const payload = visualPayload({ width: 800, height: 6000, scale: 1 });
    const result = await renderExactPdf({
      payload,
      options: exportOptions({ pageSize: 'a4', orientation: 'portrait' }),
      source: SOURCE,
      slicer: slicer(payload),
    });
    if (!result.ok) throw new Error('render failed');

    const pages = (await reopen(result.value.bytes)).getPages();
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.getWidth()).toBeCloseTo(PAPER_SIZES.a4.width, 1);
      expect(page.getHeight()).toBeCloseTo(PAPER_SIZES.a4.height, 1);
    }
  });

  it('reports the page count it actually wrote', async () => {
    const payload = visualPayload({ width: 800, height: 6000, scale: 1 });
    const result = await renderExactPdf({
      payload,
      options: exportOptions({ pageSize: 'letter' }),
      source: SOURCE,
      slicer: slicer(payload),
    });
    if (!result.ok) throw new Error('render failed');

    expect((await reopen(result.value.bytes)).getPageCount()).toBe(result.value.pageCount);
  });

  it('slices the capture once per page, with no gaps', async () => {
    const payload = visualPayload({ width: 800, height: 6000, scale: 1 });
    const raster = slicer(payload);
    const result = await renderExactPdf({
      payload,
      options: exportOptions({ pageSize: 'a4' }),
      source: SOURCE,
      slicer: raster,
    });
    if (!result.ok) throw new Error('render failed');

    expect(raster.requests).toHaveLength(result.value.pageCount);
    const covered = raster.requests.reduce((total, rect) => total + rect.height, 0);
    expect(covered).toBeGreaterThanOrEqual(payload.height - raster.requests.length);
  });

  it('keeps a continuous export on a single page', async () => {
    const payload = visualPayload({ width: 800, height: 20_000, scale: 1 });
    const result = await renderExactPdf({
      payload,
      options: exportOptions({ pageSize: 'continuous' }),
      source: SOURCE,
      slicer: slicer(payload),
    });
    if (!result.ok) throw new Error('render failed');

    expect((await reopen(result.value.bytes)).getPageCount()).toBe(1);
  });

  it('honours landscape orientation', async () => {
    const payload = visualPayload({ width: 800, height: 600, scale: 1 });
    const result = await renderExactPdf({
      payload,
      options: exportOptions({ pageSize: 'a4', orientation: 'landscape' }),
      source: SOURCE,
      slicer: slicer(payload),
    });
    if (!result.ok) throw new Error('render failed');

    const [page] = (await reopen(result.value.bytes)).getPages();
    expect(page!.getWidth()).toBeGreaterThan(page!.getHeight());
  });

  it('writes the title only when title metadata is enabled', async () => {
    const payload = visualPayload();

    const withTitle = await renderExactPdf({
      payload,
      options: exportOptions(),
      source: SOURCE,
      slicer: slicer(payload),
    });
    const withoutTitle = await renderExactPdf({
      payload,
      options: exportOptions({
        metadata: {
          includeSourceUrl: false,
          includeTitle: false,
          includeCaptureDate: false,
          includeFooter: false,
        },
      }),
      source: SOURCE,
      slicer: slicer(payload),
    });
    if (!withTitle.ok || !withoutTitle.ok) throw new Error('render failed');

    expect((await reopen(withTitle.value.bytes)).getTitle()).toBe('An Example Article');
    expect((await reopen(withoutTitle.value.bytes)).getTitle()).toBeUndefined();
  });

  it('does not embed the source URL unless the user opted in', async () => {
    const payload = visualPayload();
    const result = await renderExactPdf({
      payload,
      options: exportOptions(),
      source: SOURCE,
      slicer: slicer(payload),
    });
    if (!result.ok) throw new Error('render failed');

    expect((await reopen(result.value.bytes)).getSubject()).toBeUndefined();
    expect(await rawText(result.value.bytes)).not.toContain('example.com/articles/one');
  });

  it('rejects an empty capture rather than writing a blank file', async () => {
    const payload = visualPayload({ width: 0, height: 0 });
    const result = await renderExactPdf({
      payload,
      options: exportOptions(),
      source: SOURCE,
      slicer: slicer(payload),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RENDER_FAILED');
    }
  });

  it('returns a typed failure when encoding throws', async () => {
    const payload = visualPayload();
    const result = await renderExactPdf({
      payload,
      options: exportOptions(),
      source: SOURCE,
      slicer: {
        width: payload.width,
        height: payload.height,
        encodeSlice: () => Promise.reject(new Error('canvas gone')),
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RENDER_FAILED');
      expect(result.error.recovery).toBe('retryLowerQuality');
    }
  });
});

function documentPayload(
  blocks: DocBlock[],
  overrides: Partial<DocumentCapturePayload> = {},
): DocumentCapturePayload {
  return {
    kind: 'document',
    blocks,
    heading: 'An Example Article',
    byline: null,
    confidence: 0.9,
    unsupportedGlyphCount: 0,
    ...overrides,
  };
}

describe('renderDocumentPdf', () => {
  const article: DocBlock[] = [
    { type: 'heading', level: 1, spans: [{ text: 'Introduction' }] },
    { type: 'paragraph', spans: [{ text: 'The quick brown fox jumps over the lazy dog. '.repeat(6) }] },
    { type: 'list', ordered: false, items: [[{ text: 'First point' }], [{ text: 'Second point' }]] },
    { type: 'code', text: 'const answer = 42;\nconsole.log(answer);' },
    {
      type: 'table',
      header: ['Name', 'Value'],
      rows: [
        ['alpha', '1'],
        ['beta', '2'],
      ],
    },
    { type: 'paragraph', spans: [{ text: 'See ' }, { text: 'the docs', href: 'https://example.com/docs' }] },
  ];

  it('produces a loadable PDF with A4 pages by default', async () => {
    const result = await renderDocumentPdf({
      payload: documentPayload(article),
      options: exportOptions({ renderMode: 'document', pageSize: 'a4' }),
      source: SOURCE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [page] = (await reopen(result.value.bytes)).getPages();
    expect(page!.getWidth()).toBeCloseTo(PAPER_SIZES.a4.width, 1);
  });

  it('writes real text operators rather than an image', async () => {
    const result = await renderDocumentPdf({
      payload: documentPayload(article),
      options: exportOptions({ renderMode: 'document' }),
      source: SOURCE,
    });
    if (!result.ok) throw new Error('render failed');

    const raw = await rawText(result.value.bytes);
    // Font resources are present and no image XObject was created.
    expect(raw).toContain('/Helvetica');
    expect(raw).not.toContain('/Subtype /Image');
  });

  it('embeds a link annotation for a hyperlink', async () => {
    const result = await renderDocumentPdf({
      payload: documentPayload(article),
      options: exportOptions({ renderMode: 'document' }),
      source: SOURCE,
    });
    if (!result.ok) throw new Error('render failed');

    const raw = await rawText(result.value.bytes);
    expect(raw).toContain('/Link');
    expect(raw).toContain('https://example.com/docs');
  });

  it('paginates a long article', async () => {
    const long: DocBlock[] = Array.from({ length: 120 }, (_, index) => ({
      type: 'paragraph',
      spans: [{ text: `Paragraph ${index}. ${'filler text '.repeat(20)}` }],
    }));
    const result = await renderDocumentPdf({
      payload: documentPayload(long),
      options: exportOptions({ renderMode: 'document', pageSize: 'a4' }),
      source: SOURCE,
    });
    if (!result.ok) throw new Error('render failed');

    expect(result.value.pageCount).toBeGreaterThan(1);
    expect((await reopen(result.value.bytes)).getPageCount()).toBe(result.value.pageCount);
  });

  it('honours an explicit page break', async () => {
    const result = await renderDocumentPdf({
      payload: documentPayload([
        { type: 'paragraph', spans: [{ text: 'before' }] },
        { type: 'pageBreak' },
        { type: 'paragraph', spans: [{ text: 'after' }] },
      ]),
      options: exportOptions({ renderMode: 'document' }),
      source: SOURCE,
    });
    if (!result.ok) throw new Error('render failed');

    expect(result.value.pageCount).toBe(2);
  });

  it('survives text the standard fonts cannot encode', async () => {
    const result = await renderDocumentPdf({
      payload: documentPayload([{ type: 'paragraph', spans: [{ text: 'Hello 世界 and emoji 😀' }] }], {
        unsupportedGlyphCount: 3,
      }),
      options: exportOptions({ renderMode: 'document' }),
      source: SOURCE,
    });

    expect(result.ok).toBe(true);
  });

  it('does not duplicate the heading when the article already starts with it', async () => {
    const result = await renderDocumentPdf({
      payload: documentPayload([
        { type: 'heading', level: 1, spans: [{ text: 'An Example Article' }] },
        { type: 'paragraph', spans: [{ text: 'body' }] },
      ]),
      options: exportOptions({ renderMode: 'document' }),
      source: SOURCE,
    });
    if (!result.ok) throw new Error('render failed');

    const raw = await rawText(result.value.bytes);
    const occurrences = raw.split('An Example Article').length - 1;
    // Once in the metadata title, once in the visible heading.
    expect(occurrences).toBeLessThanOrEqual(2);
  });

  it('produces a valid file from an empty document', async () => {
    const result = await renderDocumentPdf({
      payload: documentPayload([], { heading: '' }),
      options: exportOptions({ renderMode: 'document' }),
      source: SOURCE,
    });
    if (!result.ok) throw new Error('render failed');

    expect((await reopen(result.value.bytes)).getPageCount()).toBe(1);
  });

  it('is far smaller than the equivalent raster export', async () => {
    const document = await renderDocumentPdf({
      payload: documentPayload(article),
      options: exportOptions({ renderMode: 'document' }),
      source: SOURCE,
    });
    if (!document.ok) throw new Error('render failed');

    // A text-only page has no image data at all.
    expect(document.value.bytes.byteLength).toBeLessThan(20_000);
  });
});
