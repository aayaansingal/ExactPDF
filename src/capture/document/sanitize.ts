/**
 * Sanitization of extracted page content.
 *
 * Everything that reaches the preview has been through this module. The rules
 * are allowlist-based rather than denylist-based: an unknown element is dropped
 * to its text content instead of being passed through, so a tag this code has
 * never heard of cannot become an execution vector in the extension's own
 * origin, which is far more privileged than the page's.
 */

/** Elements whose semantics the document renderer understands. */
export const ALLOWED_ELEMENTS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'div',
  'span',
  'section',
  'article',
  'main',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'q',
  'cite',
  'pre',
  'code',
  'kbd',
  'samp',
  'var',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'a',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'sub',
  'sup',
  'small',
  'mark',
  'img',
  'figure',
  'figcaption',
  'picture',
  'source',
  'br',
  'hr',
  'time',
  'abbr',
  'address',
]);

/** Attributes kept on any element; everything else is discarded. */
const ALLOWED_ATTRIBUTES = new Set([
  'href',
  'src',
  'alt',
  'title',
  'colspan',
  'rowspan',
  'datetime',
  'srcset',
]);

/** URL schemes that may appear in a sanitized document. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'data:']);

/**
 * `data:` URLs are permitted only for still images. A `data:text/html` href
 * would otherwise navigate the preview into attacker-controlled markup.
 */
const SAFE_DATA_PREFIXES = ['data:image/png', 'data:image/jpeg', 'data:image/gif', 'data:image/webp'];

export function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  // A control character can hide a scheme from a naive parser but not from the
  // browser's own URL handling, so they are rejected outright.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007F]/.test(trimmed)) {
    return false;
  }
  if (trimmed.toLowerCase().startsWith('data:')) {
    return SAFE_DATA_PREFIXES.some((prefix) => trimmed.toLowerCase().startsWith(prefix));
  }
  try {
    return SAFE_SCHEMES.has(new URL(trimmed, 'https://example.invalid').protocol);
  } catch {
    return false;
  }
}

/** Resolves a possibly relative URL against the page, returning null if unsafe. */
export function resolveUrl(value: string | null, baseUrl: string): string | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  try {
    const resolved = new URL(value, baseUrl).toString();
    return isSafeUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Strips a detached document fragment down to the allowlist, in place.
 *
 * The fragment must already be detached: this never touches the live page.
 */
export function sanitizeFragment(root: Element, baseUrl: string): void {
  // Removing nodes while walking invalidates a live NodeList, so the tree is
  // snapshotted first.
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];

  for (const element of elements) {
    const tag = element.tagName.toLowerCase();

    if (!ALLOWED_ELEMENTS.has(tag) && element !== root) {
      // Keep the words, drop the container: unwrapping preserves readable text
      // inside an unknown wrapper without trusting the wrapper itself.
      unwrap(element);
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();

      if (name.startsWith('on') || !ALLOWED_ATTRIBUTES.has(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'href' || name === 'src') {
        const resolved = resolveUrl(attribute.value, baseUrl);
        if (resolved === null) {
          element.removeAttribute(attribute.name);
        } else {
          element.setAttribute(name, resolved);
        }
      }
    }
  }
}

/** Replaces an element with its children. */
function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (parent === null) {
    element.remove();
    return;
  }
  while (element.firstChild !== null) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

/** Elements removed outright, along with everything inside them. */
export const STRIPPED_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'canvas',
  'video',
  'audio',
  'svg',
  'math',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'label',
  'fieldset',
  'nav',
  'aside',
  'dialog',
  'menu',
];

/** Removes executable, interactive and navigational content before sanitizing. */
export function stripUnsafeElements(root: Element): void {
  for (const selector of STRIPPED_ELEMENTS) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      element.remove();
    }
  }
}
