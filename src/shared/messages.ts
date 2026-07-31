/**
 * The single source of truth for every message that crosses an extension
 * boundary. Each request type maps to exactly one response type, so senders and
 * receivers cannot drift apart without a type error.
 */

import type { ExactPdfError, Result } from './errors.js';
import type {
  CaptureBounds,
  CaptureMode,
  CapturePayload,
  CaptureSource,
  DocumentCapturePayload,
  QualityPreset,
} from './types.js';

/** Sent by the popup to begin a capture in the active tab. */
export interface StartCaptureRequest {
  readonly type: 'startCapture';
  readonly mode: CaptureMode;
  readonly quality: QualityPreset;
}

export interface StartCaptureResponse {
  readonly sessionId: string;
}

/** Sent by the popup to learn whether the active tab can be captured at all. */
export interface GetTabAvailabilityRequest {
  readonly type: 'getTabAvailability';
}

export interface TabAvailability {
  readonly supported: boolean;
  /** Present when `supported` is false. */
  readonly reason?: ExactPdfError;
  readonly tabTitle: string;
  readonly tabHost: string;
}

/** Sent by a selection content script once the user confirms a selection. */
export interface SelectionCompleteRequest {
  readonly type: 'selectionComplete';
  readonly sessionId: string;
  readonly bounds: CaptureBounds;
  readonly contentLabel: string;
  readonly devicePixelRatio: number;
}

/** Sent by a selection content script when the user presses Escape. */
export interface SelectionCancelledRequest {
  readonly type: 'selectionCancelled';
  readonly sessionId: string;
}

/** Sent by the preview page to fetch its capture payload. */
export interface GetSessionRequest {
  readonly type: 'getSession';
  readonly sessionId: string;
}

export interface GetSessionResponse {
  readonly source: CaptureSource;
  readonly mode: CaptureMode;
  readonly payload: CapturePayload;
  /** A non-fatal problem the user should know about, e.g. partial lazy loading. */
  readonly warning?: ExactPdfError;
}

/** Sent by the preview page once the PDF has been downloaded or abandoned. */
export interface ReleaseSessionRequest {
  readonly type: 'releaseSession';
  readonly sessionId: string;
}

/** Sent by the preview page to re-run a capture at a lower quality. */
export interface RetryCaptureRequest {
  readonly type: 'retryCapture';
  readonly sessionId: string;
  readonly quality: QualityPreset;
}

export type ExtensionRequest =
  | StartCaptureRequest
  | GetTabAvailabilityRequest
  | SelectionCompleteRequest
  | SelectionCancelledRequest
  | GetSessionRequest
  | ReleaseSessionRequest
  | RetryCaptureRequest;

/** Maps each request to the payload its handler resolves with. */
export interface ResponseMap {
  startCapture: StartCaptureResponse;
  getTabAvailability: TabAvailability;
  selectionComplete: { readonly acknowledged: true };
  selectionCancelled: { readonly acknowledged: true };
  getSession: GetSessionResponse;
  releaseSession: { readonly acknowledged: true };
  retryCapture: StartCaptureResponse;
}

export type ResponseFor<R extends ExtensionRequest> = ResponseMap[R['type']];

/** Every handler replies with a `Result` so failures survive the message boundary. */
export type ExtensionResponse<R extends ExtensionRequest> = Result<ResponseFor<R>>;

/* -------------------------------------------------------------------------- */
/* Service worker -> content script commands                                  */
/* -------------------------------------------------------------------------- */

/** Prepares a page for tiled capture: freezes animation, records scroll state. */
export interface PreparePageCommand {
  readonly type: 'preparePage';
  readonly sessionId: string;
}

export interface PreparePageResult {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly devicePixelRatio: number;
}

/** Scrolls to a tile origin and reports the scroll position actually reached. */
export interface ScrollToTileCommand {
  readonly type: 'scrollToTile';
  readonly sessionId: string;
  readonly x: number;
  readonly y: number;
  /** Fixed and sticky elements are hidden from the second tile onwards. */
  readonly hideFixedElements: boolean;
}

export interface ScrollToTileResult {
  readonly scrollX: number;
  readonly scrollY: number;
}

/** Scrolls the whole page once to trigger lazy loading, then returns to the top. */
export interface PrimeLazyContentCommand {
  readonly type: 'primeLazyContent';
  readonly sessionId: string;
  readonly maxDurationMs: number;
}

export interface PrimeLazyContentResult {
  /** True when the bounded wait expired before all images settled. */
  readonly incomplete: boolean;
  readonly pageHeight: number;
}

/** Undoes every temporary page modification. Safe to call more than once. */
export interface RestorePageCommand {
  readonly type: 'restorePage';
  readonly sessionId: string;
}

/**
 * Activates a freshly injected selection overlay. The session id travels in a
 * message rather than in the page's DOM so the extension never writes an
 * attribute the page could read or that could survive a failed capture.
 */
export interface BeginSelectionCommand {
  readonly type: 'beginSelection';
  readonly sessionId: string;
}

/** Removes a selection overlay without waiting for the user, e.g. on timeout. */
export interface AbortSelectionCommand {
  readonly type: 'abortSelection';
  readonly sessionId: string;
}

/** Extracts the page's primary content for Document mode. */
export interface ExtractDocumentCommand {
  readonly type: 'extractDocument';
  readonly sessionId: string;
  /** Images above this many bytes are dropped rather than inlined. */
  readonly maxImageBytes: number;
}

export type ContentCommand =
  | PreparePageCommand
  | ScrollToTileCommand
  | PrimeLazyContentCommand
  | RestorePageCommand
  | BeginSelectionCommand
  | AbortSelectionCommand
  | ExtractDocumentCommand;

export interface ContentResponseMap {
  preparePage: PreparePageResult;
  scrollToTile: ScrollToTileResult;
  primeLazyContent: PrimeLazyContentResult;
  restorePage: { readonly restored: true };
  beginSelection: { readonly started: true };
  abortSelection: { readonly aborted: true };
  extractDocument: DocumentCapturePayload;
}

export type ContentResponse<C extends ContentCommand> = Result<ContentResponseMap[C['type']]>;
