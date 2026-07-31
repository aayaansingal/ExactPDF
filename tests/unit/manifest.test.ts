import { describe, expect, it } from 'vitest';
import { buildManifest, PERMISSION_JUSTIFICATIONS } from '../../src/manifest.config.js';

describe('production manifest', () => {
  const manifest = buildManifest('1.2.3');

  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('carries the version it was given', () => {
    expect(manifest.version).toBe('1.2.3');
  });

  it('requests exactly the four documented permissions', () => {
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage', 'contextMenus']);
  });

  it('requests none of the permissions the plan rules out', () => {
    const forbidden = ['<all_urls>', 'debugger', 'webRequest', 'tabs', 'history', 'cookies', 'downloads'];
    for (const permission of forbidden) {
      expect(manifest.permissions).not.toContain(permission);
    }
  });

  it('declares no host permissions at all', () => {
    expect(manifest.host_permissions).toBeUndefined();
  });

  it('never carries the end-to-end host grant unless explicitly asked', () => {
    expect(buildManifest('1.0.0', {}).host_permissions).toBeUndefined();
    expect(buildManifest('1.0.0', { e2eHostAccess: false }).host_permissions).toBeUndefined();
    // The automation grant exists, but only when deliberately requested.
    expect(buildManifest('1.0.0', { e2eHostAccess: true }).host_permissions).toEqual(['<all_urls>']);
  });

  it('runs the service worker as an ES module', () => {
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
  });

  it('forbids remote code through the content security policy', () => {
    const policy = manifest.content_security_policy?.extension_pages ?? '';
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'self'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain('http://');
    expect(policy).not.toContain('https://');
  });

  it('exposes no web-accessible resources', () => {
    expect(manifest.web_accessible_resources).toBeUndefined();
  });

  it('documents a justification for every permission it requests', () => {
    const documented = PERMISSION_JUSTIFICATIONS.map((entry) => entry.permission);
    expect(new Set(documented)).toEqual(new Set(manifest.permissions));

    for (const entry of PERMISSION_JUSTIFICATIONS) {
      // Store reviewers reject one-line justifications; these must be real.
      expect(entry.justification.length).toBeGreaterThan(80);
    }
  });

  it('points every declared file at a real build output path', () => {
    expect(manifest.action?.default_popup).toBe('src/popup/index.html');
    expect(manifest.options_page).toBe('src/options/index.html');
    expect(Object.values(manifest.icons ?? {})).toEqual([
      'icons/icon-16.png',
      'icons/icon-32.png',
      'icons/icon-48.png',
      'icons/icon-128.png',
    ]);
  });
});
