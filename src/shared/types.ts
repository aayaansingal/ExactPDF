/**
 * Core domain types for ExactPDF.
 *
 * Everything in this module must be JSON-serializable: these values cross the
 * service worker / content script / preview page boundaries via
 * `chrome.runtime.sendMessage` and `chrome.storage.session`, both of which
 * perform a structured-clone-to-JSON round trip.
 */

/** How the user asked for content to be captured. */
export type CaptureMode = 'element' | 'region' | 'fullPage' | 'document';

/** How the captured content is turned into PDF bytes. */
export type RenderMode = 'exact' | 'document';

export type PageSize = 'original' | 'continuous' | 'a4' | 'letter';

export type Orientation = 'auto' | 'portrait' | 'landscape';

export type MarginPreset = 'zero' | 'narrow' | 'standard' | 'custom';

export type BackgroundMode = 'preserve' | 'forceLight' | 'transparent';

export type QualityPreset = 'compact' | 'balanced' | 'maximum';

/**
 * A rectangle in CSS pixels, relative to the top-left of the *document*
 * (not the viewport). Scroll offsets are already applied.
 */
export interface CaptureBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Margins in millimetres. */
export interface Margins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Where a capture came from. Used for filenames, metadata and diagnostics. */
export interface CaptureSource {
  readonly url: string;
  readonly title: string;
  /** ISO-8601 timestamp of when the capture was taken. */
  readonly capturedAt: string;
  /** Plain-language label for the captured content, e.g. `Image`, `Article`. */
  readonly contentLabel: string;
}

/** A raster capture: one stitched image covering the requested bounds. */
export interface VisualCapturePayload {
  readonly kind: 'visual';
  /** Data URL of the stitched image. */
  readonly dataUrl: string;
  /** Image width in device pixels. */
  readonly width: number;
  /** Image height in device pixels. */
  readonly height: number;
  /** Device pixel ratio the capture was taken at. */
  readonly scale: number;
  readonly format: 'image/png' | 'image/jpeg';
  /** Number of scroll tiles stitched together (1 for single-viewport captures). */
  readonly tileCount: number;
  /** True when lazy content may still have been loading when capture finished. */
  readonly mayBeIncomplete: boolean;
}

/** Inline text run inside a document block. */
export interface DocSpan {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly code?: boolean;
  /** Absolute URL. Relative hrefs are resolved during extraction. */
  readonly href?: string;
}

export type DocBlock =
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly spans: DocSpan[] }
  | { readonly type: 'paragraph'; readonly spans: DocSpan[] }
  | { readonly type: 'quote'; readonly spans: DocSpan[] }
  | { readonly type: 'caption'; readonly spans: DocSpan[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: DocSpan[][] }
  | { readonly type: 'code'; readonly text: string; readonly language?: string }
  | {
      readonly type: 'table';
      readonly header: string[] | null;
      readonly rows: string[][];
    }
  | {
      readonly type: 'image';
      /** Data URL. Images that could not be fetched are dropped at extraction time. */
      readonly dataUrl: string;
      readonly width: number;
      readonly height: number;
      readonly alt: string;
    }
  | { readonly type: 'rule' }
  /** User- or extractor-inserted hard page break. */
  | { readonly type: 'pageBreak' };

/** A sanitized, semantic representation of the page's primary content. */
export interface DocumentCapturePayload {
  readonly kind: 'document';
  readonly blocks: DocBlock[];
  /** Article title as detected by extraction, may differ from the tab title. */
  readonly heading: string;
  readonly byline: string | null;
  /**
   * Extraction confidence in [0, 1]. Below
   * {@link DOCUMENT_CONFIDENCE_THRESHOLD} the UI recommends Exact mode.
   */
  readonly confidence: number;
  /** Count of characters that cannot be encoded by the built-in PDF fonts. */
  readonly unsupportedGlyphCount: number;
}

export type CapturePayload = VisualCapturePayload | DocumentCapturePayload;

/** Below this confidence, Document mode is not offered as the default. */
export const DOCUMENT_CONFIDENCE_THRESHOLD = 0.55;

export interface MetadataOptions {
  readonly includeSourceUrl: boolean;
  readonly includeTitle: boolean;
  readonly includeCaptureDate: boolean;
  /** Draw a footer line on every page with the enabled metadata fields. */
  readonly includeFooter: boolean;
}

export interface ExportOptions {
  readonly renderMode: RenderMode;
  readonly pageSize: PageSize;
  readonly orientation: Orientation;
  readonly marginPreset: MarginPreset;
  /** Only meaningful when `marginPreset === 'custom'`. Millimetres. */
  readonly customMargins: Margins;
  readonly background: BackgroundMode;
  readonly quality: QualityPreset;
  readonly filename: string;
  readonly metadata: MetadataOptions;
}

export interface ExportResult {
  readonly filename: string;
  readonly byteLength: number;
  readonly pageCount: number;
}

/** A capture in flight, checkpointed so it survives a service-worker restart. */
export interface CaptureSession {
  readonly id: string;
  readonly mode: CaptureMode;
  readonly tabId: number;
  readonly source: CaptureSource;
  readonly createdAt: number;
  readonly status: 'pending' | 'ready' | 'failed';
}
