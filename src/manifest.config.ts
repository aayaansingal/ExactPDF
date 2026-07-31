/**
 * The manifest is generated so that the permission set and the version number
 * have exactly one source of truth, and so every permission can carry the
 * justification required for the Chrome Web Store listing.
 */

export interface PermissionJustification {
  readonly permission: string;
  /** The user-visible feature that cannot work without this permission. */
  readonly justification: string;
}

export const PERMISSION_JUSTIFICATIONS: readonly PermissionJustification[] = [
  {
    permission: 'activeTab',
    justification:
      'Grants temporary access to the tab the user is looking at, only after they click the ExactPDF toolbar button or a context-menu item. This is what allows the extension to read the selected element and take the screenshot used for the PDF, without any standing access to browsing activity.',
  },
  {
    permission: 'scripting',
    justification:
      'Injects the selection overlay and the content-extraction code into the active tab for the capture mode the user chose. No code is fetched remotely; every injected file ships inside the extension package.',
  },
  {
    permission: 'storage',
    justification:
      'Stores the user’s export preferences (page size, margins, quality, filename options) and hands the in-progress capture to the preview tab using session storage that is cleared when the browser closes.',
  },
  {
    permission: 'contextMenus',
    justification:
      'Adds the right-click actions "Save selected element as PDF" and "Save image as PDF" so a capture can be started without opening the popup.',
  },
];

export interface ManifestOptions {
  /**
   * Stands in for the `activeTab` grant during end-to-end tests.
   *
   * Playwright cannot click the browser's own toolbar, and it is that click
   * which grants `activeTab`. `chrome.tabs.captureVisibleTab` accepts only
   * `activeTab` or `<all_urls>`, so an automated capture needs the latter.
   *
   * This is set exclusively by `npm run build:e2e`. `npm run build` and
   * `npm run package` never set it, and tests/unit/manifest.test.ts asserts
   * that the shipped manifest declares no host permissions whatsoever.
   */
  readonly e2eHostAccess?: boolean;
}

export function buildManifest(version: string, options: ManifestOptions = {}): chrome.runtime.ManifestV3 {
  return {
    manifest_version: 3,
    name: 'ExactPDF - Select and Save Web Content as PDF',
    short_name: 'ExactPDF',
    version,
    description:
      'Select any webpage element, region, image, or complete page and save it as a clean PDF - locally and without the print dialogue.',
    minimum_chrome_version: '120',
    permissions: PERMISSION_JUSTIFICATIONS.map((entry) => entry.permission),
    // No host_permissions in a shipped build: activeTab supplies temporary
    // access after a gesture.
    ...(options.e2eHostAccess === true ? { host_permissions: ['<all_urls>'] } : {}),
    action: {
      default_title: 'ExactPDF',
      default_popup: 'src/popup/index.html',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    options_page: 'src/options/index.html',
    commands: {
      'capture-element': {
        suggested_key: { default: 'Alt+Shift+E', mac: 'Alt+Shift+E' },
        description: 'Capture an element as PDF',
      },
      'capture-region': {
        suggested_key: { default: 'Alt+Shift+R', mac: 'Alt+Shift+R' },
        description: 'Capture a region as PDF',
      },
    },
    // Everything executable is bundled; no remote code and no eval.
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; worker-src 'self'",
    },
    // No `web_accessible_resources`: content scripts are injected on demand and
    // no page ever needs to reference a file inside the extension.
  } as chrome.runtime.ManifestV3;
}
