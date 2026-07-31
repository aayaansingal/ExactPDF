/**
 * Text preparation for the PDF standard fonts.
 *
 * ExactPDF ships no font files: the 14 standard PDF fonts are guaranteed to be
 * present in every reader, keep the extension bundle small enough to review
 * quickly, and avoid embedding a megabyte of glyphs the majority of captures
 * never use. Their cost is the WinAnsi character set, which covers Latin
 * scripts only.
 *
 * Rather than let pdf-lib throw part-way through a render, unsupported
 * characters are transliterated where an honest ASCII equivalent exists and
 * counted where one does not, so the preview can tell the user plainly that
 * Document mode will drop characters and offer Exact mode instead.
 */

import type { DocBlock, DocSpan } from '../shared/types.js';

/** Characters that have a faithful WinAnsi or ASCII equivalent. */
const TRANSLITERATIONS = new Map<string, string>([
  ['‘', "'"],
  ['’', "'"],
  ['‚', ','],
  ['‛', "'"],
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  ['‟', '"'],
  ['‐', '-'],
  ['‑', '-'],
  ['‒', '-'],
  ['–', '-'],
  ['—', '--'],
  ['―', '--'],
  ['−', '-'],
  ['…', '...'],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  ['　', ' '],
  ['​', ''],
  ['‌', ''],
  ['‍', ''],
  ['﻿', ''],
  ['•', '*'],
  ['·', '*'],
  ['‣', '>'],
  ['●', '*'],
  ['→', '->'],
  ['←', '<-'],
  ['⇒', '=>'],
  ['↔', '<->'],
  ['≤', '<='],
  ['≥', '>='],
  ['≠', '!='],
  ['×', 'x'],
  ['′', "'"],
  ['″', '"'],
  ['‹', '<'],
  ['›', '>'],
  ['⁄', '/'],
  ['∕', '/'],
  ['	', '    '],
]);

/** Replacement for a character with no reasonable Latin equivalent. */
const UNSUPPORTED_PLACEHOLDER = '?';

export interface EncodedText {
  readonly text: string;
  /** Characters replaced by the placeholder because no equivalent exists. */
  readonly unsupportedCount: number;
}

/**
 * WinAnsi covers ASCII plus most of Latin-1 and a handful of extras that
 * pdf-lib maps explicitly. Testing the codepoint ranges is both faster and more
 * predictable than probing pdf-lib's encoder per character.
 */
function isWinAnsiEncodable(codePoint: number): boolean {
  if (codePoint === 0x0a || codePoint === 0x0d) {
    return true;
  }
  if (codePoint >= 0x20 && codePoint <= 0x7e) {
    return true;
  }
  if (codePoint >= 0xa0 && codePoint <= 0xff) {
    return true;
  }
  // The WinAnsi 0x80-0x9F block, addressed by Unicode codepoint.
  return [
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
    0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e,
    0x0178,
  ].includes(codePoint);
}

/**
 * Makes text safe for a standard font, reporting what could not be preserved.
 *
 * Transliteration runs before the encodability check so that, for example, an
 * em dash becomes `--` rather than being counted as a loss -- the reader sees
 * the author's intent even though the exact glyph is gone.
 */
export function encodeForStandardFont(input: string): EncodedText {
  let output = '';
  let unsupportedCount = 0;

  for (const character of input) {
    const replacement = TRANSLITERATIONS.get(character);
    if (replacement !== undefined) {
      output += replacement;
      continue;
    }

    const codePoint = character.codePointAt(0) ?? 0;
    if (isWinAnsiEncodable(codePoint)) {
      output += character;
      continue;
    }

    output += UNSUPPORTED_PLACEHOLDER;
    unsupportedCount += 1;
  }

  return { text: output, unsupportedCount };
}

/** Convenience wrapper for call sites that do not track the loss count. */
export function toStandardFontText(input: string): string {
  return encodeForStandardFont(input).text;
}

/** Counts characters that Document mode cannot render, without building output. */
export function countUnsupportedGlyphs(input: string): number {
  return encodeForStandardFont(input).unsupportedCount;
}

/**
 * Encodes every string in a block list up front.
 *
 * This has to happen before layout, not at draw time: line breaking measures
 * text with the same standard font that will draw it, and asking pdf-lib to
 * measure a character it cannot encode throws. Encoding first also guarantees
 * the measured text and the drawn text are identical, so a line can never
 * overflow the measure it was fitted to.
 */
export function encodeBlocksForStandardFont(blocks: DocBlock[]): DocBlock[] {
  const encodeSpans = (spans: DocSpan[]): DocSpan[] =>
    spans.map((span) => ({ ...span, text: encodeForStandardFont(span.text).text }));

  return blocks.map((block): DocBlock => {
    switch (block.type) {
      case 'heading':
        return { ...block, spans: encodeSpans(block.spans) };
      case 'paragraph':
      case 'quote':
      case 'caption':
        return { ...block, spans: encodeSpans(block.spans) };
      case 'list':
        return { ...block, items: block.items.map(encodeSpans) };
      case 'code':
        return { ...block, text: encodeForStandardFont(block.text).text };
      case 'table':
        return {
          ...block,
          header: block.header === null ? null : block.header.map((cell) => encodeForStandardFont(cell).text),
          rows: block.rows.map((row) => row.map((cell) => encodeForStandardFont(cell).text)),
        };
      case 'image':
        return { ...block, alt: encodeForStandardFont(block.alt).text };
      case 'rule':
      case 'pageBreak':
        return block;
    }
  });
}
