import { describe, expect, it } from 'vitest';
import { displayHost, isCapturableUrl } from '../../src/shared/pageSupport.js';
import { createError, fromThrown, scrubDetail } from '../../src/shared/errors.js';

describe('isCapturableUrl', () => {
  it('accepts ordinary web pages', () => {
    expect(isCapturableUrl('https://example.com/article')).toBe(true);
    expect(isCapturableUrl('http://localhost:3000/page')).toBe(true);
  });

  it('rejects browser-internal pages Chrome will not inject into', () => {
    for (const url of [
      'chrome://settings',
      'chrome-untrusted://print',
      'devtools://devtools/bundled/inspector.html',
      'about:blank',
      'edge://flags',
      'brave://rewards',
      'view-source:https://example.com',
    ]) {
      expect(isCapturableUrl(url), url).toBe(false);
    }
  });

  it('rejects other extensions and local files', () => {
    expect(isCapturableUrl('chrome-extension://abcdef/page.html')).toBe(false);
    expect(isCapturableUrl('file:///Users/someone/notes.html')).toBe(false);
  });

  it('rejects the Chrome Web Store, which blocks extensions', () => {
    expect(isCapturableUrl('https://chromewebstore.google.com/detail/x')).toBe(false);
    expect(isCapturableUrl('https://chrome.google.com/webstore/category/extensions')).toBe(false);
  });

  it('rejects an empty or non-http URL', () => {
    expect(isCapturableUrl('')).toBe(false);
    expect(isCapturableUrl('ftp://example.com/file')).toBe(false);
    expect(isCapturableUrl('javascript:alert(1)')).toBe(false);
  });

  it('is case-insensitive about the scheme', () => {
    expect(isCapturableUrl('CHROME://settings')).toBe(false);
    expect(isCapturableUrl('HTTPS://example.com')).toBe(true);
  });
});

describe('displayHost', () => {
  it('extracts the hostname', () => {
    expect(displayHost('https://developer.chrome.com/docs')).toBe('developer.chrome.com');
  });

  it('degrades gracefully for an unparseable URL', () => {
    expect(displayHost('not a url')).toBe('not a url');
  });
});

describe('error mapping', () => {
  it('gives every code a message and a recovery action', () => {
    const error = createError('CAPTURE_TOO_LARGE');
    expect(error.message).not.toBe('');
    expect(error.recovery).toBe('retryLowerQuality');
  });

  it('maps a Chrome injection refusal to an unsupported page', () => {
    const error = fromThrown(new Error('Cannot access contents of url "chrome://settings".'));
    expect(error.code).toBe('UNSUPPORTED_PAGE');
  });

  it('maps a storage quota rejection to the lower-quality retry path', () => {
    const error = fromThrown(new Error('QUOTA_BYTES quota exceeded'));
    expect(error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(error.recovery).toBe('retryLowerQuality');
  });

  it('maps a dead message port to an expired session', () => {
    const error = fromThrown(new Error('Could not establish connection. Receiving end does not exist.'));
    expect(error.code).toBe('SESSION_EXPIRED');
  });

  it('falls back to the caller-supplied code for unrecognised failures', () => {
    expect(fromThrown(new Error('something odd'), 'RENDER_FAILED').code).toBe('RENDER_FAILED');
  });

  it('accepts a non-Error throw', () => {
    expect(fromThrown('a string').code).toBe('UNKNOWN');
  });
});

describe('scrubDetail', () => {
  it('removes URLs so diagnostics carry no browsing information', () => {
    expect(scrubDetail('failed loading https://private.example.com/secret?token=abc')).toBe(
      'failed loading <url>',
    );
  });

  it('redacts quoted strings, which often hold page text', () => {
    expect(scrubDetail('element "My Secret Heading" not found')).toBe('element "<redacted>" not found');
  });

  it('caps the length', () => {
    expect(scrubDetail('x'.repeat(500)).length).toBe(200);
  });
});
