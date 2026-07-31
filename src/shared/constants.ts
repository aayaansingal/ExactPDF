import type { Margins, QualityPreset } from './types.js';

export const EXTENSION_NAME = 'ExactPDF';

/** URL schemes and hosts where Chrome refuses content-script injection. */
export const BLOCKED_URL_PREFIXES = [
  'chrome://',
  'chrome-untrusted://',
  'devtools://',
  'edge://',
  'brave://',
  'about:',
  'view-source:',
  'chrome-extension://',
  'moz-extension://',
  'file://',
] as const;

/** Chrome also blocks injection across the Web Store's own pages. */
export const BLOCKED_HOSTS = [
  'chromewebstore.google.com',
  'chrome.google.com/webstore',
  'microsoftedge.microsoft.com',
] as const;

/**
 * `chrome.tabs.captureVisibleTab` is rate limited to roughly two calls per
 * second. Tiles are spaced slightly beyond that to leave headroom for a busy
 * renderer, otherwise the API starts rejecting mid-capture.
 */
export const CAPTURE_THROTTLE_MS = 550;

/** Tiles overlap so seam alignment can discard a partially rendered edge row. */
export const TILE_OVERLAP_CSS_PX = 24;

/**
 * Upper bound on the stitched canvas area in device pixels. Chosen to stay well
 * inside the ~268 megapixel canvas limit shared by desktop Chrome on Windows
 * and macOS while leaving room for the JPEG encode buffer.
 */
export const MAX_CAPTURE_PIXEL_AREA = 120_000_000;

/** Beyond this page height the popup warns before starting a full-page capture. */
export const LONG_PAGE_WARNING_CSS_PX = 20_000;

/** Hard stop for full-page capture, protecting against infinite scroll. */
export const MAX_PAGE_HEIGHT_CSS_PX = 60_000;

/** Bounded wait for lazy-loaded content during full-page preparation. */
export const LAZY_LOAD_MAX_DURATION_MS = 6_000;

/** A capture handed to the preview is discarded if untouched for this long. */
export const SESSION_TTL_MS = 15 * 60 * 1000;

/** PDF's own hard limit on a page dimension, in points (200 inches). */
export const MAX_PDF_DIMENSION_PT = 14_400;

export const QUALITY_SETTINGS: Record<
  QualityPreset,
  { readonly format: 'image/png' | 'image/jpeg'; readonly jpegQuality: number; readonly maxScale: number }
> = {
  compact: { format: 'image/jpeg', jpegQuality: 0.7, maxScale: 1 },
  balanced: { format: 'image/jpeg', jpegQuality: 0.92, maxScale: 2 },
  maximum: { format: 'image/png', jpegQuality: 1, maxScale: 3 },
};

/** Margin presets in millimetres. */
export const MARGIN_PRESETS: Record<'zero' | 'narrow' | 'standard', Margins> = {
  zero: { top: 0, right: 0, bottom: 0, left: 0 },
  narrow: { top: 6.35, right: 6.35, bottom: 6.35, left: 6.35 },
  standard: { top: 19.05, right: 19.05, bottom: 19.05, left: 19.05 },
};

export const STORAGE_KEYS = {
  settings: 'exactpdf:settings',
  sessionPrefix: 'exactpdf:session:',
  sessionIndex: 'exactpdf:sessions',
} as const;
