/**
 * Expected failures are modelled as typed results rather than thrown exceptions
 * (see docs/decisions/0002-typed-results.md). Every code carries a
 * user-facing message and, where applicable, a concrete recovery action so the
 * UI never has to invent copy for a failure it did not anticipate.
 */

export type ExactPdfErrorCode =
  | 'UNSUPPORTED_PAGE'
  | 'PERMISSION_DENIED'
  | 'CAPTURE_FAILED'
  | 'CAPTURE_TOO_LARGE'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'DOCUMENT_STRUCTURE_NOT_FOUND'
  | 'CROSS_ORIGIN_UNAVAILABLE'
  | 'PARTIAL_LAZY_CONTENT'
  | 'RENDER_FAILED'
  | 'SESSION_EXPIRED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UNKNOWN';

/** What the user can do next. The preview and popup render these as buttons. */
export type RecoveryAction =
  | 'retryLowerQuality'
  | 'selectRegion'
  | 'useExactMode'
  | 'recaptureAfterScrolling'
  | 'openSupportedPage'
  | 'retry'
  | 'none';

export interface ExactPdfError {
  readonly code: ExactPdfErrorCode;
  /** Plain-language explanation shown directly to the user. */
  readonly message: string;
  readonly recovery: RecoveryAction;
  /**
   * Non-identifying technical detail for local diagnostics. Never contains page
   * content, URLs or titles.
   */
  readonly detail?: string;
}

interface ErrorTemplate {
  readonly message: string;
  readonly recovery: RecoveryAction;
}

const ERROR_TEMPLATES: Record<ExactPdfErrorCode, ErrorTemplate> = {
  UNSUPPORTED_PAGE: {
    message: 'Chrome does not allow extensions to read this page, so it cannot be captured.',
    recovery: 'openSupportedPage',
  },
  PERMISSION_DENIED: {
    message: 'ExactPDF needs permission for this tab. Open the extension again from the toolbar.',
    recovery: 'retry',
  },
  CAPTURE_FAILED: {
    message: 'The page could not be captured. The page may have changed while it was being read.',
    recovery: 'retry',
  },
  CAPTURE_TOO_LARGE: {
    message: 'This capture is larger than ExactPDF can process safely.',
    recovery: 'retryLowerQuality',
  },
  STORAGE_QUOTA_EXCEEDED: {
    message: 'This capture is too large to hand over to the preview.',
    recovery: 'retryLowerQuality',
  },
  DOCUMENT_STRUCTURE_NOT_FOUND: {
    message: 'No clear article structure was found on this page.',
    recovery: 'useExactMode',
  },
  CROSS_ORIGIN_UNAVAILABLE: {
    message: 'Part of this page comes from another site and cannot be read directly.',
    recovery: 'selectRegion',
  },
  PARTIAL_LAZY_CONTENT: {
    message: 'Some content had not finished loading when the capture was taken.',
    recovery: 'recaptureAfterScrolling',
  },
  RENDER_FAILED: {
    message: 'The PDF could not be created from this capture.',
    recovery: 'retryLowerQuality',
  },
  SESSION_EXPIRED: {
    message: 'This capture is no longer available. Start a new capture from the toolbar.',
    recovery: 'retry',
  },
  TIMEOUT: {
    message: 'The page took too long to respond.',
    recovery: 'retry',
  },
  CANCELLED: {
    message: 'The capture was cancelled.',
    recovery: 'none',
  },
  UNKNOWN: {
    message: 'Something went wrong while preparing this capture.',
    recovery: 'retry',
  },
};

export function createError(code: ExactPdfErrorCode, detail?: string): ExactPdfError {
  const template = ERROR_TEMPLATES[code];
  return detail === undefined
    ? { code, message: template.message, recovery: template.recovery }
    : { code, message: template.message, recovery: template.recovery, detail };
}

/**
 * Maps an unexpected thrown value onto a typed error. Only the error's
 * constructor name and message shape are retained; a rejected Chrome API call
 * can embed a URL in its message, so the detail is scrubbed of anything that
 * looks like one.
 */
export function fromThrown(thrown: unknown, fallback: ExactPdfErrorCode = 'UNKNOWN'): ExactPdfError {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  const detail = scrubDetail(raw);

  if (/cannot be scripted|cannot access|chrome:\/\/|extension gallery|showing error page/i.test(raw)) {
    return createError('UNSUPPORTED_PAGE', detail);
  }
  if (/quota|QUOTA_BYTES/i.test(raw)) {
    return createError('STORAGE_QUOTA_EXCEEDED', detail);
  }
  if (/out of memory|allocation failed|Array buffer allocation/i.test(raw)) {
    return createError('CAPTURE_TOO_LARGE', detail);
  }
  if (/receiving end does not exist|message port closed/i.test(raw)) {
    return createError('SESSION_EXPIRED', detail);
  }
  return createError(fallback, detail);
}

/** Removes URLs, quoted strings and long tokens so diagnostics stay content-free. */
export function scrubDetail(raw: string): string {
  return raw
    .replace(/[a-z]+:\/\/\S+/gi, '<url>')
    .replace(/"[^"]*"/g, '"<redacted>"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export type Result<T, E = ExactPdfError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}
