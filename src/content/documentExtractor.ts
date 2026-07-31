/**
 * Clean Document mode's page-side half.
 *
 * Clones the page, hands the clone to Mozilla Readability to find the primary
 * content, strips and sanitizes what comes back, then reduces it to the
 * renderer's block representation. The live page is never mutated: Readability
 * rewrites the document it is given, so it only ever sees a copy.
 */

import { Readability } from '@mozilla/readability';
import { buildBlocks } from '../capture/document/blocks.js';
import { scoreConfidence } from '../capture/document/confidence.js';
import { sanitizeFragment, stripUnsafeElements } from '../capture/document/sanitize.js';
import { claimInjectionSlot } from './lib/messaging.js';
import { countUnsupportedGlyphs } from '../pdf/textEncoding.js';
import { createError, err, fromThrown, ok, type Result } from '../shared/errors.js';
import type { ContentCommand } from '../shared/messages.js';
import type { DocBlock, DocumentCapturePayload } from '../shared/types.js';

const SLOT = 'documentExtractor';

/** Images larger than this are referenced by alt text rather than inlined. */
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Total inlined image budget, keeping the payload inside the session quota. */
const TOTAL_IMAGE_BUDGET_BYTES = 6 * 1024 * 1024;

async function extractDocument(maxImageBytes: number): Promise<Result<DocumentCapturePayload>> {
  try {
    const clone = document.cloneNode(true) as Document;
    const article = new Readability(clone, { keepClasses: false }).parse();

    const content = article?.content ?? null;
    if (content === null || content === '') {
      return err(createError('DOCUMENT_STRUCTURE_NOT_FOUND'));
    }

    // DOMParser does not execute scripts or load subresources, so parsing the
    // extractor's HTML output here is inert.
    const parsed = new DOMParser().parseFromString(content, 'text/html');
    const root = parsed.body;

    stripUnsafeElements(root);
    sanitizeFragment(root, document.baseURI);

    const images = await inlineImages(root, maxImageBytes);
    const blocks = buildBlocks(root, {
      resolveImage: (element) => images.get(element) ?? null,
    });

    const confidence = scoreConfidence({
      blocks,
      pageTextLength: document.body.innerText.length,
      extractorSucceeded: true,
    });

    return ok({
      kind: 'document',
      blocks,
      heading: article?.title ?? document.title,
      byline: article?.byline ?? null,
      confidence,
      unsupportedGlyphCount: countUnsupportedGlyphsInBlocks(blocks),
    });
  } catch (thrown) {
    return err(fromThrown(thrown, 'DOCUMENT_STRUCTURE_NOT_FOUND'));
  }
}

interface InlinedImage {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Fetches each image and converts it to a data URL.
 *
 * Fetching rather than drawing to a canvas keeps the original encoding and
 * avoids a tainted-canvas failure, but it is subject to the page's CORS rules,
 * so cross-origin images from strict hosts will not resolve. Those are dropped
 * rather than reported as an error: an article missing a decorative image is
 * still the document the user asked for.
 */
async function inlineImages(root: Element, maxImageBytes: number): Promise<Map<Element, InlinedImage>> {
  const results = new Map<Element, InlinedImage>();
  let budget = TOTAL_IMAGE_BUDGET_BYTES;

  const elements = Array.from(root.querySelectorAll('img')).slice(0, 60);

  for (const element of elements) {
    const src = element.getAttribute('src');
    if (src === null || budget <= 0) {
      continue;
    }
    if (src.startsWith('data:')) {
      const size = Math.ceil((src.length * 3) / 4);
      if (size <= maxImageBytes && size <= budget) {
        results.set(element, { dataUrl: src, ...intrinsicSize(element) });
        budget -= size;
      }
      continue;
    }

    try {
      const response = await fetch(src, { credentials: 'include', cache: 'force-cache' });
      if (!response.ok) {
        continue;
      }
      const blob = await response.blob();
      if (blob.size > maxImageBytes || blob.size > budget || !blob.type.startsWith('image/')) {
        continue;
      }
      // PDF embedding supports JPEG and PNG only; other formats are skipped
      // rather than transcoded, which would need a canvas and lose alpha.
      if (!/^image\/(png|jpeg|jpg)$/.test(blob.type)) {
        continue;
      }

      const dataUrl = await blobToDataUrl(blob);
      results.set(element, { dataUrl, ...intrinsicSize(element) });
      budget -= blob.size;
    } catch {
      // Cross-origin or offline: drop the image and keep the document.
    }
  }

  return results;
}

function intrinsicSize(element: Element): { width: number; height: number } {
  const image = element as HTMLImageElement;
  const width = image.naturalWidth > 0 ? image.naturalWidth : Number(element.getAttribute('width'));
  const height = image.naturalHeight > 0 ? image.naturalHeight : Number(element.getAttribute('height'));

  return {
    width: Number.isFinite(width) && width > 0 ? width : 600,
    height: Number.isFinite(height) && height > 0 ? height : 400,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(new Error('image read failed'));
    };
    reader.readAsDataURL(blob);
  });
}

function countUnsupportedGlyphsInBlocks(blocks: DocBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'quote':
      case 'caption':
        for (const span of block.spans) {
          total += countUnsupportedGlyphs(span.text);
        }
        break;
      case 'list':
        for (const item of block.items) {
          for (const span of item) {
            total += countUnsupportedGlyphs(span.text);
          }
        }
        break;
      case 'code':
        total += countUnsupportedGlyphs(block.text);
        break;
      case 'table':
        for (const cell of [...(block.header ?? []), ...block.rows.flat()]) {
          total += countUnsupportedGlyphs(cell);
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

if (claimInjectionSlot(`${SLOT}Listener`)) {
  chrome.runtime.onMessage.addListener(
    (message: ContentCommand, _sender, sendResponse: (response: Result<unknown>) => void) => {
      if (message.type === 'extractDocument') {
        void extractDocument(message.maxImageBytes || DEFAULT_MAX_IMAGE_BYTES).then(sendResponse);
        return true;
      }
      return false;
    },
  );
}
