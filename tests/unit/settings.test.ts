import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, migrateSettings, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings.js';

describe('migrateSettings', () => {
  it('returns defaults for a first run', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for a corrupted record', () => {
    expect(migrateSettings('not an object')).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('preserves valid stored values', () => {
    const migrated = migrateSettings({
      schemaVersion: 1,
      lastCaptureMode: 'region',
      defaultPageSize: 'a4',
      defaultQuality: 'maximum',
      timestampSuffix: true,
    });

    expect(migrated.lastCaptureMode).toBe('region');
    expect(migrated.defaultPageSize).toBe('a4');
    expect(migrated.defaultQuality).toBe('maximum');
    expect(migrated.timestampSuffix).toBe(true);
  });

  it('replaces invalid enum values with the default rather than resetting everything', () => {
    const migrated = migrateSettings({
      lastCaptureMode: 'telepathy',
      defaultPageSize: 'a4',
    });

    expect(migrated.lastCaptureMode).toBe(DEFAULT_SETTINGS.lastCaptureMode);
    expect(migrated.defaultPageSize).toBe('a4');
  });

  it('always stamps the current schema version', () => {
    expect(migrateSettings({ schemaVersion: 0 }).schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(migrateSettings({ schemaVersion: 99 }).schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it('fills in fields a previous schema version did not have', () => {
    const migrated = migrateSettings({ schemaVersion: 0, lastCaptureMode: 'fullPage' });
    expect(migrated.lastCaptureMode).toBe('fullPage');
    expect(migrated.metadata).toEqual(DEFAULT_SETTINGS.metadata);
    expect(migrated.customMargins).toEqual(DEFAULT_SETTINGS.customMargins);
  });

  it('rejects out-of-range and non-numeric margins', () => {
    const migrated = migrateSettings({
      customMargins: { top: -5, right: 'wide', bottom: 500, left: 12 },
    });

    expect(migrated.customMargins.top).toBe(DEFAULT_SETTINGS.customMargins.top);
    expect(migrated.customMargins.right).toBe(DEFAULT_SETTINGS.customMargins.right);
    expect(migrated.customMargins.bottom).toBe(DEFAULT_SETTINGS.customMargins.bottom);
    expect(migrated.customMargins.left).toBe(12);
  });

  it('recovers a partially corrupted nested object', () => {
    const migrated = migrateSettings({ metadata: { includeTitle: 'yes', includeFooter: true } });
    expect(migrated.metadata.includeTitle).toBe(DEFAULT_SETTINGS.metadata.includeTitle);
    expect(migrated.metadata.includeFooter).toBe(true);
  });

  it('never persists a value outside the declared type', () => {
    const migrated = migrateSettings({ warnOnLongPages: 'sometimes', onboardingComplete: 1 });
    expect(typeof migrated.warnOnLongPages).toBe('boolean');
    expect(typeof migrated.onboardingComplete).toBe('boolean');
  });

  it('is idempotent', () => {
    const once = migrateSettings({ lastCaptureMode: 'document' });
    expect(migrateSettings(once)).toEqual(once);
  });
});
