import { describe, expect, it } from 'vitest';
import {
  buildFilename,
  formatCaptureDate,
  hostnameFromUrl,
  MAX_BASENAME_LENGTH,
  normalizeUserFilename,
  sanitizeFilenameFragment,
  truncateBasename,
} from '../../src/shared/filename.js';

const CAPTURED_AT = new Date(2026, 6, 23, 14, 5, 9);

describe('sanitizeFilenameFragment', () => {
  it('removes characters that are invalid on any supported filesystem', () => {
    expect(sanitizeFilenameFragment('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('strips control characters', () => {
    expect(sanitizeFilenameFragment(`report${String.fromCharCode(0)}${String.fromCharCode(31)}x`)).toBe(
      'report_x',
    );
  });

  it('collapses repeated whitespace into a single separator', () => {
    expect(sanitizeFilenameFragment('Lecture    Notes \t\n Week 3')).toBe('Lecture_Notes_Week_3');
  });

  it('keeps hyphens but does not double them up with underscores', () => {
    expect(sanitizeFilenameFragment('Chapter 4 - Integration')).toBe('Chapter_4-Integration');
  });

  it('normalizes typographic dashes to ASCII hyphens', () => {
    expect(sanitizeFilenameFragment('Part—One')).toBe('Part-One');
  });

  it('trims leading and trailing punctuation', () => {
    expect(sanitizeFilenameFragment('...Draft...')).toBe('Draft');
    expect(sanitizeFilenameFragment('  _-notes-_  ')).toBe('notes');
  });

  it('returns an empty string when nothing usable survives', () => {
    expect(sanitizeFilenameFragment('///')).toBe('');
    expect(sanitizeFilenameFragment('   ')).toBe('');
  });
});

describe('hostnameFromUrl', () => {
  it('drops a leading www', () => {
    expect(hostnameFromUrl('https://www.developer.chrome.com/docs')).toBe('developer.chrome.com');
  });

  it('returns an empty string for an unparseable URL', () => {
    expect(hostnameFromUrl('not a url')).toBe('');
  });
});

describe('formatCaptureDate', () => {
  it('formats as YYYY-MM-DD with zero padding', () => {
    expect(formatCaptureDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('buildFilename', () => {
  it('follows the documented title_label_date pattern', () => {
    expect(
      buildFilename({
        title: 'MAT137 Lecture Integration Example',
        url: 'https://q.utoronto.ca/courses/1',
        contentLabel: '',
        capturedAt: CAPTURED_AT,
      }),
    ).toBe('MAT137_Lecture_Integration_Example_2026-07-23.pdf');
  });

  it('falls back to the hostname when the title is unavailable', () => {
    expect(
      buildFilename({
        title: '',
        url: 'https://developer.chrome.com/docs/extensions',
        contentLabel: 'activeTab',
        capturedAt: CAPTURED_AT,
      }),
    ).toBe('developer.chrome.com_activeTab_2026-07-23.pdf');
  });

  it('appends a time suffix when the user enabled it', () => {
    expect(
      buildFilename({
        title: 'Receipt',
        url: 'https://example.com',
        contentLabel: 'Region',
        capturedAt: CAPTURED_AT,
        timestampSuffix: true,
      }),
    ).toBe('Receipt_Region_2026-07-23_140509.pdf');
  });

  it('produces a usable name when the title and URL are both unusable', () => {
    expect(buildFilename({ title: '///', url: 'nonsense', contentLabel: '', capturedAt: CAPTURED_AT })).toBe(
      'capture_2026-07-23.pdf',
    );
  });

  it('avoids Windows reserved device names', () => {
    expect(buildFilename({ title: 'CON', url: '', contentLabel: '', capturedAt: CAPTURED_AT })).not.toMatch(
      /^CON\./i,
    );
  });

  it('never emits a filesystem-invalid character', () => {
    const name = buildFilename({
      title: 'A<B>C:D"E/F\\G|H?I*J',
      url: 'https://example.com',
      contentLabel: 'Image',
      capturedAt: CAPTURED_AT,
    });
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('caps the base name length', () => {
    const name = buildFilename({
      title: 'x'.repeat(500),
      url: 'https://example.com',
      contentLabel: 'Article',
      capturedAt: CAPTURED_AT,
    });
    expect(name.length).toBeLessThanOrEqual(MAX_BASENAME_LENGTH + '.pdf'.length);
  });
});

describe('truncateBasename', () => {
  it('prefers to cut on an underscore boundary', () => {
    expect(truncateBasename('alpha_beta_gamma_delta', 14)).toBe('alpha_beta');
  });

  it('cuts mid-token when no late boundary exists', () => {
    expect(truncateBasename('averyverylongsingletoken', 10)).toBe('averyveryl');
  });

  it('leaves short names untouched', () => {
    expect(truncateBasename('short', 10)).toBe('short');
  });
});

describe('normalizeUserFilename', () => {
  it('adds the pdf extension exactly once', () => {
    expect(normalizeUserFilename('notes')).toBe('notes.pdf');
    expect(normalizeUserFilename('notes.pdf')).toBe('notes.pdf');
    expect(normalizeUserFilename('notes.PDF')).toBe('notes.pdf');
  });

  it('strips path separators so a download cannot escape the folder', () => {
    expect(normalizeUserFilename('../../etc/passwd')).toBe('etc_passwd.pdf');
  });

  it('falls back when the user clears the field', () => {
    expect(normalizeUserFilename('   ')).toBe('capture.pdf');
  });
});
