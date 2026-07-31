/**
 * Scores how much to trust a Document-mode extraction.
 *
 * Extraction succeeding is not the same as extraction being right: a settings
 * page or a dashboard will still yield *something*. The score combines signals
 * that are cheap to compute and independent of one another, and the preview
 * uses it to decide whether to recommend Exact mode instead of quietly
 * producing a thin, wrong-looking document.
 */

import type { DocBlock } from '../../shared/types.js';

export interface ConfidenceInput {
  readonly blocks: DocBlock[];
  /** Characters of visible text in the whole page body. */
  readonly pageTextLength: number;
  /** True when the extractor identified an article container at all. */
  readonly extractorSucceeded: boolean;
}

/** Below this many characters, a page is not a document worth paginating. */
const MINIMUM_TEXT_LENGTH = 400;

/** Prose-heavy pages sit well above this; navigation-heavy ones far below. */
const HEALTHY_TEXT_RATIO = 0.25;

export function scoreConfidence(input: ConfidenceInput): number {
  if (!input.extractorSucceeded || input.blocks.length === 0) {
    return 0;
  }

  const textLength = totalTextLength(input.blocks);
  if (textLength === 0) {
    return 0;
  }

  // Enough prose to be worth reading as a document.
  const lengthScore = clamp01(textLength / (MINIMUM_TEXT_LENGTH * 3));

  // How much of the page the extraction kept. A very low ratio means the
  // extractor found a fragment; a ratio near 1 on a huge page means it kept
  // the navigation too.
  const ratio = input.pageTextLength > 0 ? textLength / input.pageTextLength : 0;
  const ratioScore = ratio >= HEALTHY_TEXT_RATIO ? 1 : ratio / HEALTHY_TEXT_RATIO;

  // Structure: headings and paragraphs indicate a document rather than a
  // scraped list of links.
  const paragraphs = input.blocks.filter((block) => block.type === 'paragraph').length;
  const headings = input.blocks.filter((block) => block.type === 'heading').length;
  const structureScore = clamp01((paragraphs + headings * 2) / 12);

  const score = lengthScore * 0.4 + ratioScore * 0.3 + structureScore * 0.3;
  return Math.round(clamp01(score) * 100) / 100;
}

export function totalTextLength(blocks: DocBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'quote':
      case 'caption':
        total += block.spans.reduce((sum, span) => sum + span.text.length, 0);
        break;
      case 'list':
        for (const item of block.items) {
          total += item.reduce((sum, span) => sum + span.text.length, 0);
        }
        break;
      case 'code':
        total += block.text.length;
        break;
      case 'table':
        total += (block.header ?? []).join('').length;
        for (const row of block.rows) {
          total += row.join('').length;
        }
        break;
      case 'image':
      case 'rule':
      case 'pageBreak':
        break;
    }
  }
  return total;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
