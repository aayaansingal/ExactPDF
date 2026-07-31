/**
 * User preferences. Only non-sensitive presentation choices are persisted --
 * never URLs, titles, filenames or export history (see docs/privacy.md).
 */

import type {
  BackgroundMode,
  CaptureMode,
  MarginPreset,
  Margins,
  MetadataOptions,
  Orientation,
  PageSize,
  QualityPreset,
  RenderMode,
} from './types.js';

export const SETTINGS_SCHEMA_VERSION = 1;

export interface Settings {
  readonly schemaVersion: number;
  /** The popup highlights this mode first without hiding the alternatives. */
  readonly lastCaptureMode: CaptureMode;
  readonly defaultRenderMode: RenderMode;
  readonly defaultPageSize: PageSize;
  readonly defaultOrientation: Orientation;
  readonly defaultMarginPreset: MarginPreset;
  readonly customMargins: Margins;
  readonly defaultBackground: BackgroundMode;
  readonly defaultQuality: QualityPreset;
  readonly metadata: MetadataOptions;
  /** Adds `_HHMMSS` to suggested filenames instead of relying on Chrome's `(1)`. */
  readonly timestampSuffix: boolean;
  /** Warn before capturing pages beyond the long-page threshold. */
  readonly warnOnLongPages: boolean;
  readonly onboardingComplete: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  lastCaptureMode: 'element',
  defaultRenderMode: 'exact',
  defaultPageSize: 'original',
  defaultOrientation: 'auto',
  defaultMarginPreset: 'zero',
  customMargins: { top: 10, right: 10, bottom: 10, left: 10 },
  defaultBackground: 'preserve',
  defaultQuality: 'balanced',
  metadata: {
    includeSourceUrl: false,
    includeTitle: true,
    includeCaptureDate: false,
    includeFooter: false,
  },
  timestampSuffix: false,
  warnOnLongPages: true,
  onboardingComplete: false,
};

const CAPTURE_MODES: readonly CaptureMode[] = ['element', 'region', 'fullPage', 'document'];
const RENDER_MODES: readonly RenderMode[] = ['exact', 'document'];
const PAGE_SIZES: readonly PageSize[] = ['original', 'continuous', 'a4', 'letter'];
const ORIENTATIONS: readonly Orientation[] = ['auto', 'portrait', 'landscape'];
const MARGIN_PRESETS: readonly MarginPreset[] = ['zero', 'narrow', 'standard', 'custom'];
const BACKGROUNDS: readonly BackgroundMode[] = ['preserve', 'forceLight', 'transparent'];
const QUALITIES: readonly QualityPreset[] = ['compact', 'balanced', 'maximum'];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickMargin(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
}

/**
 * Reads whatever is in storage and returns a complete, valid `Settings`.
 *
 * Migration is deliberately field-by-field rather than version-stepped: the
 * schema is small, every field has a safe default, and a partially corrupted
 * record should still yield a usable extension rather than a reset.
 */
export function migrateSettings(raw: unknown): Settings {
  if (raw === null || typeof raw !== 'object') {
    return DEFAULT_SETTINGS;
  }
  const input = raw as Record<string, unknown>;
  const rawMargins = (input['customMargins'] ?? {}) as Record<string, unknown>;
  const rawMetadata = (input['metadata'] ?? {}) as Record<string, unknown>;

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    lastCaptureMode: pick(input['lastCaptureMode'], CAPTURE_MODES, DEFAULT_SETTINGS.lastCaptureMode),
    defaultRenderMode: pick(input['defaultRenderMode'], RENDER_MODES, DEFAULT_SETTINGS.defaultRenderMode),
    defaultPageSize: pick(input['defaultPageSize'], PAGE_SIZES, DEFAULT_SETTINGS.defaultPageSize),
    defaultOrientation: pick(input['defaultOrientation'], ORIENTATIONS, DEFAULT_SETTINGS.defaultOrientation),
    defaultMarginPreset: pick(
      input['defaultMarginPreset'],
      MARGIN_PRESETS,
      DEFAULT_SETTINGS.defaultMarginPreset,
    ),
    customMargins: {
      top: pickMargin(rawMargins['top'], DEFAULT_SETTINGS.customMargins.top),
      right: pickMargin(rawMargins['right'], DEFAULT_SETTINGS.customMargins.right),
      bottom: pickMargin(rawMargins['bottom'], DEFAULT_SETTINGS.customMargins.bottom),
      left: pickMargin(rawMargins['left'], DEFAULT_SETTINGS.customMargins.left),
    },
    defaultBackground: pick(input['defaultBackground'], BACKGROUNDS, DEFAULT_SETTINGS.defaultBackground),
    defaultQuality: pick(input['defaultQuality'], QUALITIES, DEFAULT_SETTINGS.defaultQuality),
    metadata: {
      includeSourceUrl: pickBoolean(
        rawMetadata['includeSourceUrl'],
        DEFAULT_SETTINGS.metadata.includeSourceUrl,
      ),
      includeTitle: pickBoolean(rawMetadata['includeTitle'], DEFAULT_SETTINGS.metadata.includeTitle),
      includeCaptureDate: pickBoolean(
        rawMetadata['includeCaptureDate'],
        DEFAULT_SETTINGS.metadata.includeCaptureDate,
      ),
      includeFooter: pickBoolean(rawMetadata['includeFooter'], DEFAULT_SETTINGS.metadata.includeFooter),
    },
    timestampSuffix: pickBoolean(input['timestampSuffix'], DEFAULT_SETTINGS.timestampSuffix),
    warnOnLongPages: pickBoolean(input['warnOnLongPages'], DEFAULT_SETTINGS.warnOnLongPages),
    onboardingComplete: pickBoolean(input['onboardingComplete'], DEFAULT_SETTINGS.onboardingComplete),
  };
}
