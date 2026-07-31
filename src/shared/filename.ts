/**
 * Filename generation. Default pattern:
 * `{sanitized-page-title}_{content-label}_{YYYY-MM-DD}.pdf`
 */

/** Windows reserves these device names regardless of extension. */
const RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * Characters that are invalid or awkward on Windows, macOS or Linux
 * filesystems, plus the C0 control range.
 */
// eslint-disable-next-line no-control-regex
const INVALID_CHARACTERS = /[<>:"/\\|?*\u0000-\u001F\u007F]/g;

/** Typographic dashes, which read as separators but travel badly. */
const TYPOGRAPHIC_DASHES = /[\u2010-\u2015\u2212]/g;

export const MAX_BASENAME_LENGTH = 120;

/**
 * Reduces arbitrary text to a filesystem-safe fragment. Returns an empty string
 * when nothing usable survives, so callers can fall back to the hostname.
 */
export function sanitizeFilenameFragment(input: string): string {
  return (
    input
      .normalize('NFC')
      .replace(TYPOGRAPHIC_DASHES, '-')
      .replace(INVALID_CHARACTERS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s/g, '_')
      .replace(/_+/g, '_')
      // A hyphen already separates; surrounding underscores only add noise.
      .replace(/_-_/g, '-')
      // Leading dots hide files on Unix; trailing dots and spaces break Windows.
      .replace(/^[._-]+/, '')
      .replace(/[._\-\s]+$/, '')
  );
}

/** Extracts a usable hostname, dropping a leading `www.`. */
export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Formats a date as `YYYY-MM-DD` in the user's local timezone. */
export function formatCaptureDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface FilenameInput {
  readonly title: string;
  readonly url: string;
  readonly contentLabel: string;
  readonly capturedAt: Date;
  /** Appends `_HHMMSS` so repeated captures never collide. */
  readonly timestampSuffix?: boolean;
}

/**
 * Builds the suggested download filename. Chrome's own duplicate numbering
 * handles collisions unless the user opted into a timestamp suffix.
 */
export function buildFilename(input: FilenameInput): string {
  const title = sanitizeFilenameFragment(input.title);
  const host = sanitizeFilenameFragment(hostnameFromUrl(input.url));
  const label = sanitizeFilenameFragment(input.contentLabel);
  const date = formatCaptureDate(input.capturedAt);

  // A name built only from the date would be ambiguous in a downloads folder,
  // so an unusable title and hostname fall back to an explicit word.
  const name = title !== '' ? title : host !== '' ? host : 'capture';
  const parts = [name, label, date].filter((part) => part !== '');
  let base = parts.join('_');

  if (input.timestampSuffix === true) {
    const time = input.capturedAt.toTimeString().slice(0, 8).replace(/:/g, '');
    base = `${base}_${time}`;
  }

  base = truncateBasename(base);

  if (base === '' || RESERVED_BASENAMES.has(base.toLowerCase())) {
    base = `capture_${date}`;
  }

  return `${base}.pdf`;
}

/** Truncates on an underscore boundary where possible so names stay readable. */
export function truncateBasename(base: string, limit = MAX_BASENAME_LENGTH): string {
  if (base.length <= limit) {
    return base;
  }
  const clipped = base.slice(0, limit);
  const lastSeparator = clipped.lastIndexOf('_');
  const result = lastSeparator > limit * 0.5 ? clipped.slice(0, lastSeparator) : clipped;
  return result.replace(/[._-]+$/, '');
}

/**
 * Normalizes a filename the user typed into the preview. Always ends in `.pdf`
 * and never contains a path separator.
 */
export function normalizeUserFilename(input: string): string {
  const withoutExtension = input.replace(/\.pdf$/i, '');
  const base = truncateBasename(sanitizeFilenameFragment(withoutExtension));
  return base === '' ? 'capture.pdf' : `${base}.pdf`;
}
