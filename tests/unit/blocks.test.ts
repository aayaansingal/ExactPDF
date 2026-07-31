/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { buildBlocks, inlineSpans } from '../../src/capture/document/blocks.js';
import { scoreConfidence, totalTextLength } from '../../src/capture/document/confidence.js';
import type { DocBlock } from '../../src/shared/types.js';

function root(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

function textOf(block: DocBlock): string {
  return 'spans' in block ? block.spans.map((span) => span.text).join('') : '';
}

describe('buildBlocks: structure', () => {
  it('captures headings with their level', () => {
    const blocks = buildBlocks(root('<h1>Title</h1><h3>Sub</h3>'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ type: 'heading', level: 3 });
  });

  it('captures paragraphs in document order', () => {
    const blocks = buildBlocks(root('<p>one</p><p>two</p>'));
    expect(blocks.map(textOf)).toEqual(['one', 'two']);
  });

  it('treats a div of inline content as a paragraph', () => {
    const blocks = buildBlocks(root('<div>plain text</div>'));
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    expect(textOf(blocks[0]!)).toBe('plain text');
  });

  it('recurses through nested containers without duplicating text', () => {
    const blocks = buildBlocks(root('<section><div><p>deep</p></div></section>'));
    expect(blocks).toHaveLength(1);
    expect(textOf(blocks[0]!)).toBe('deep');
  });

  it('preserves code blocks verbatim, including indentation', () => {
    const blocks = buildBlocks(root('<pre><code>def f():\n    return 1</code></pre>'));
    expect(blocks[0]).toEqual({ type: 'code', text: 'def f():\n    return 1' });
  });

  it('reads ordered and unordered lists', () => {
    const blocks = buildBlocks(root('<ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>'));
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: true });
    expect((blocks[0] as { items: { text: string }[][] }).items).toHaveLength(2);
  });

  it('flattens a nested list into a following sibling list', () => {
    const blocks = buildBlocks(root('<ul><li>a<ul><li>a1</li></ul></li></ul>'));
    const lists = blocks.filter((block) => block.type === 'list');
    expect(lists.length).toBeGreaterThanOrEqual(2);
  });

  it('separates a table header row from the body', () => {
    const blocks = buildBlocks(
      root('<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>'),
    );
    expect(blocks[0]).toEqual({ type: 'table', header: ['H1', 'H2'], rows: [['a', 'b']] });
  });

  it('handles a table with no header row', () => {
    const blocks = buildBlocks(root('<table><tr><td>a</td></tr></table>'));
    expect(blocks[0]).toEqual({ type: 'table', header: null, rows: [['a']] });
  });

  it('reads blockquotes and captions as their own kinds', () => {
    const blocks = buildBlocks(root('<blockquote>quoted</blockquote><figcaption>cap</figcaption>'));
    expect(blocks[0]!.type).toBe('quote');
    expect(blocks[1]!.type).toBe('caption');
  });

  it('emits a rule for a horizontal rule between content', () => {
    const blocks = buildBlocks(root('<p>a</p><hr><p>b</p>'));
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'rule', 'paragraph']);
  });

  it('drops rules that divide nothing', () => {
    expect(buildBlocks(root('<hr><p>a</p><hr>')).map((block) => block.type)).toEqual(['paragraph']);
    expect(buildBlocks(root('<hr><hr>'))).toEqual([]);
  });

  it('drops images that could not be inlined', () => {
    const blocks = buildBlocks(root('<img src="https://example.com/a.png" alt="x">'));
    expect(blocks).toEqual([]);
  });

  it('keeps an image the resolver supplies', () => {
    const blocks = buildBlocks(root('<img src="https://example.com/a.png" alt="Diagram">'), {
      resolveImage: () => ({ dataUrl: 'data:image/png;base64,AAAA', width: 400, height: 300 }),
    });
    expect(blocks[0]).toMatchObject({ type: 'image', alt: 'Diagram', width: 400, height: 300 });
  });

  it('produces nothing for empty input', () => {
    expect(buildBlocks(root(''))).toEqual([]);
    expect(buildBlocks(root('<p>   </p>'))).toEqual([]);
  });
});

describe('inlineSpans: formatting', () => {
  it('marks bold and italic runs', () => {
    const spans = inlineSpans(root('<p>a <strong>bold</strong> <em>it</em></p>').firstElementChild!);
    expect(spans.find((span) => span.text === 'bold')?.bold).toBe(true);
    expect(spans.find((span) => span.text === 'it')?.italic).toBe(true);
  });

  it('carries formatting through nesting', () => {
    const spans = inlineSpans(root('<p><strong><em>both</em></strong></p>').firstElementChild!);
    expect(spans[0]).toMatchObject({ text: 'both', bold: true, italic: true });
  });

  it('records safe link targets', () => {
    const spans = inlineSpans(root('<p><a href="https://example.com/x">link</a></p>').firstElementChild!);
    expect(spans[0]).toMatchObject({ text: 'link', href: 'https://example.com/x' });
  });

  it('omits an unsafe link target but keeps the text', () => {
    const spans = inlineSpans(root('<p><a href="javascript:alert(1)">bad</a></p>').firstElementChild!);
    expect(spans[0]!.text).toBe('bad');
    expect(spans[0]!.href).toBeUndefined();
  });

  it('marks inline code', () => {
    const spans = inlineSpans(root('<p>use <code>npm</code></p>').firstElementChild!);
    expect(spans.find((span) => span.text === 'npm')?.code).toBe(true);
  });

  it('collapses runs of whitespace', () => {
    const spans = inlineSpans(root('<p>a     b\n\nc</p>').firstElementChild!);
    expect(spans.map((span) => span.text).join('')).toBe('a b c');
  });

  it('trims whitespace at the block edges', () => {
    const spans = inlineSpans(root('<p>   padded   </p>').firstElementChild!);
    expect(spans.map((span) => span.text).join('')).toBe('padded');
  });

  it('merges adjacent runs that share a style', () => {
    const spans = inlineSpans(root('<p><b>a</b><b>b</b></p>').firstElementChild!);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe('ab');
  });

  it('turns a line break into a newline run', () => {
    const spans = inlineSpans(root('<p>a<br>b</p>').firstElementChild!);
    expect(spans.map((span) => span.text).join('')).toContain('\n');
  });
});

describe('scoreConfidence', () => {
  const paragraph = (length: number): DocBlock => ({
    type: 'paragraph',
    spans: [{ text: 'x'.repeat(length) }],
  });

  it('is zero when extraction failed', () => {
    expect(scoreConfidence({ blocks: [], pageTextLength: 5000, extractorSucceeded: false })).toBe(0);
  });

  it('is zero when nothing was extracted', () => {
    expect(scoreConfidence({ blocks: [], pageTextLength: 5000, extractorSucceeded: true })).toBe(0);
  });

  it('scores a long, well-structured article highly', () => {
    const blocks: DocBlock[] = [
      { type: 'heading', level: 1, spans: [{ text: 'Title' }] },
      { type: 'heading', level: 2, spans: [{ text: 'Section' }] },
      ...Array.from({ length: 10 }, () => paragraph(400)),
    ];
    const score = scoreConfidence({ blocks, pageTextLength: 6000, extractorSucceeded: true });
    expect(score).toBeGreaterThan(0.8);
  });

  it('scores a thin fragment of a large page low', () => {
    const score = scoreConfidence({
      blocks: [paragraph(60)],
      pageTextLength: 40_000,
      extractorSucceeded: true,
    });
    expect(score).toBeLessThan(0.3);
  });

  it('returns a value in [0, 1]', () => {
    const score = scoreConfidence({
      blocks: Array.from({ length: 200 }, () => paragraph(1000)),
      pageTextLength: 100,
      extractorSucceeded: true,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('totalTextLength', () => {
  it('counts text across every block kind', () => {
    const blocks: DocBlock[] = [
      { type: 'heading', level: 1, spans: [{ text: '12345' }] },
      { type: 'list', ordered: false, items: [[{ text: '123' }]] },
      { type: 'code', text: '12' },
      { type: 'table', header: ['1'], rows: [['12']] },
      { type: 'rule' },
    ];
    expect(totalTextLength(blocks)).toBe(5 + 3 + 2 + 1 + 2);
  });
});
