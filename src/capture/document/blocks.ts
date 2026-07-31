/**
 * Converts a sanitized DOM fragment into the renderer's intermediate
 * representation.
 *
 * The PDF renderer draws explicit primitives rather than interpreting CSS, so
 * everything is reduced here to a small set of blocks whose layout rules are
 * fully known. Structures with no faithful equivalent (nested tables, floated
 * asides) collapse to their text rather than being approximated badly.
 */

import type { DocBlock, DocSpan } from '../../shared/types.js';
import { isSafeUrl } from './sanitize.js';

/** Inline elements that contribute formatting rather than structure. */
const BOLD_TAGS = new Set(['strong', 'b', 'th']);
const ITALIC_TAGS = new Set(['em', 'i', 'cite', 'var', 'dfn']);
const CODE_TAGS = new Set(['code', 'kbd', 'samp', 'tt']);

const HEADING_LEVELS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

export interface BlockBuildOptions {
  /** Resolves an image element to an inlined data URL, or null to drop it. */
  readonly resolveImage?: (element: Element) => { dataUrl: string; width: number; height: number } | null;
}

/** Walks a sanitized root and produces the block list, in document order. */
export function buildBlocks(root: Element, options: BlockBuildOptions = {}): DocBlock[] {
  const blocks: DocBlock[] = [];
  visit(root, blocks, options);
  return mergeAdjacentText(blocks);
}

function visit(node: Element, blocks: DocBlock[], options: BlockBuildOptions): void {
  for (const child of Array.from(node.children)) {
    const tag = child.tagName.toLowerCase();

    const level = HEADING_LEVELS[tag];
    if (level !== undefined) {
      pushIfNonEmpty(blocks, { type: 'heading', level, spans: inlineSpans(child) });
      continue;
    }

    switch (tag) {
      case 'p':
      case 'address':
        pushIfNonEmpty(blocks, { type: 'paragraph', spans: inlineSpans(child) });
        continue;

      case 'blockquote':
        pushIfNonEmpty(blocks, { type: 'quote', spans: inlineSpans(child) });
        continue;

      case 'figcaption':
      case 'caption':
        pushIfNonEmpty(blocks, { type: 'caption', spans: inlineSpans(child) });
        continue;

      case 'pre': {
        const text = child.textContent.replace(/\s+$/, '');
        if (text.trim() !== '') {
          blocks.push({ type: 'code', text });
        }
        continue;
      }

      case 'ul':
      case 'ol':
      case 'dl':
        blocks.push(...listBlocks(child, options));
        continue;

      case 'table': {
        const table = tableBlock(child);
        if (table !== null) {
          blocks.push(table);
        }
        continue;
      }

      case 'img': {
        const image = imageBlock(child, options);
        if (image !== null) {
          blocks.push(image);
        }
        continue;
      }

      case 'hr':
        blocks.push({ type: 'rule' });
        continue;

      case 'br':
        continue;

      default:
        break;
    }

    // A container: recurse, but if it holds only inline content it is itself a
    // paragraph, which is how most sites mark up body text inside a `div`.
    if (hasBlockChildren(child)) {
      visit(child, blocks, options);
    } else {
      pushIfNonEmpty(blocks, { type: 'paragraph', spans: inlineSpans(child) });
    }
  }
}

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'ul',
  'ol',
  'dl',
  'li',
  'table',
  'pre',
  'blockquote',
  'figure',
  'figcaption',
  'hr',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'address',
  'caption',
]);

function hasBlockChildren(element: Element): boolean {
  return Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName.toLowerCase()));
}

function listBlocks(element: Element, options: BlockBuildOptions): DocBlock[] {
  const tag = element.tagName.toLowerCase();
  const ordered = tag === 'ol';
  const itemSelector = tag === 'dl' ? 'dt, dd' : 'li';

  const items: DocSpan[][] = [];
  const nested: DocBlock[] = [];

  for (const item of Array.from(element.children)) {
    if (!itemSelector.split(', ').includes(item.tagName.toLowerCase())) {
      continue;
    }
    const spans = inlineSpans(item);
    if (spans.length > 0) {
      items.push(spans);
    }
    // A nested list becomes a sibling list: the renderer does not indent
    // recursively, and a flat list reads better than a mangled hierarchy.
    for (const sublist of Array.from(item.children)) {
      const subtag = sublist.tagName.toLowerCase();
      if (subtag === 'ul' || subtag === 'ol') {
        nested.push(...listBlocks(sublist, options));
      }
    }
  }

  const result: DocBlock[] = [];
  if (items.length > 0) {
    result.push({ type: 'list', ordered, items });
  }
  result.push(...nested);
  return result;
}

/**
 * Flattens a table to plain cell text.
 *
 * Cells are reduced to strings because the renderer measures column widths from
 * text alone; a cell containing a paragraph and an image has no sensible width,
 * and preserving its markup would promise a fidelity Document mode does not
 * offer.
 */
function tableBlock(element: Element): DocBlock | null {
  const rows: string[][] = [];
  let header: string[] | null = null;

  for (const row of Array.from(element.querySelectorAll('tr'))) {
    const cells = Array.from(row.children)
      .filter((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()))
      .map((cell) => collapseWhitespace(cell.textContent));

    if (cells.length === 0) {
      continue;
    }
    const isHeaderRow = Array.from(row.children).every((cell) => cell.tagName.toLowerCase() === 'th');
    if (isHeaderRow && header === null && rows.length === 0) {
      header = cells;
    } else {
      rows.push(cells);
    }
  }

  return header === null && rows.length === 0 ? null : { type: 'table', header, rows };
}

function imageBlock(element: Element, options: BlockBuildOptions): DocBlock | null {
  const resolved = options.resolveImage?.(element) ?? null;
  if (resolved === null || !isSafeUrl(resolved.dataUrl)) {
    return null;
  }
  return {
    type: 'image',
    dataUrl: resolved.dataUrl,
    width: resolved.width,
    height: resolved.height,
    alt: collapseWhitespace(element.getAttribute('alt') ?? ''),
  };
}

/**
 * Flattens an element's inline descendants into styled runs.
 *
 * Formatting nests (bold inside a link inside emphasis), so state is carried
 * down the walk rather than read from the immediate parent.
 */
export function inlineSpans(element: Element): DocSpan[] {
  const spans: DocSpan[] = [];

  const walk = (node: Node, style: Omit<DocSpan, 'text'>): void => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? '';
      if (text !== '') {
        spans.push({ ...style, text });
      }
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }

    const child = node as Element;
    const tag = child.tagName.toLowerCase();

    if (tag === 'br') {
      spans.push({ ...style, text: '\n' });
      return;
    }
    // Nested block content is handled by the block walker, not inline.
    if (BLOCK_TAGS.has(tag) && tag !== 'img') {
      return;
    }

    const href = tag === 'a' ? child.getAttribute('href') : null;
    const next: Omit<DocSpan, 'text'> = {
      ...style,
      ...(BOLD_TAGS.has(tag) ? { bold: true } : {}),
      ...(ITALIC_TAGS.has(tag) ? { italic: true } : {}),
      ...(CODE_TAGS.has(tag) ? { code: true } : {}),
      ...(href !== null && isSafeUrl(href) ? { href } : {}),
    };

    for (const grandchild of Array.from(child.childNodes)) {
      walk(grandchild, next);
    }
  };

  for (const child of Array.from(element.childNodes)) {
    walk(child, {});
  }

  return normalizeSpans(spans);
}

/** Collapses whitespace across runs and drops spans that carry none. */
function normalizeSpans(spans: DocSpan[]): DocSpan[] {
  const result: DocSpan[] = [];

  for (const span of spans) {
    const text = span.text === '\n' ? '\n' : collapseWhitespace(span.text, true);
    if (text === '') {
      continue;
    }

    const previous = result[result.length - 1];
    if (previous !== undefined && sameStyle(previous, span)) {
      result[result.length - 1] = { ...previous, text: previous.text + text };
    } else {
      result.push({ ...span, text });
    }
  }

  // Leading and trailing whitespace at the block edges is layout, not content.
  const first = result[0];
  if (first !== undefined) {
    result[0] = { ...first, text: first.text.replace(/^\s+/, '') };
  }
  const last = result[result.length - 1];
  if (last !== undefined) {
    result[result.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') };
  }

  return result.filter((span) => span.text !== '');
}

function sameStyle(a: DocSpan, b: DocSpan): boolean {
  return (
    (a.bold ?? false) === (b.bold ?? false) &&
    (a.italic ?? false) === (b.italic ?? false) &&
    (a.code ?? false) === (b.code ?? false) &&
    a.href === b.href
  );
}

export function collapseWhitespace(text: string, keepEdges = false): string {
  const collapsed = text.replace(/\s+/g, ' ');
  return keepEdges ? collapsed : collapsed.trim();
}

function pushIfNonEmpty(blocks: DocBlock[], block: DocBlock): void {
  if ('spans' in block && block.spans.length === 0) {
    return;
  }
  blocks.push(block);
}

/** Merges consecutive paragraphs produced by nested wrapper elements. */
function mergeAdjacentText(blocks: DocBlock[]): DocBlock[] {
  const result: DocBlock[] = [];

  for (const block of blocks) {
    const previous = result[result.length - 1];
    if (block.type === 'rule' && (previous === undefined || previous.type === 'rule')) {
      continue;
    }
    result.push(block);
  }

  // A rule at either end is a divider against nothing.
  while (result.length > 0 && result[result.length - 1]?.type === 'rule') {
    result.pop();
  }
  while (result.length > 0 && result[0]?.type === 'rule') {
    result.shift();
  }
  return result;
}
