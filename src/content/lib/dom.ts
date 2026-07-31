/** DOM helpers shared by the selection overlays and the page controller. */

import type { CaptureBounds } from '../../shared/types.js';

/**
 * Plain-language names for elements, as required by the selection overlay.
 * Technical vocabulary such as "node" or "DOM element" is deliberately absent.
 */
const ELEMENT_LABELS: Record<string, string> = {
  img: 'Image',
  picture: 'Image',
  svg: 'Graphic',
  canvas: 'Graphic',
  figure: 'Figure',
  figcaption: 'Caption',
  table: 'Table',
  thead: 'Table header',
  tbody: 'Table',
  tr: 'Table row',
  article: 'Article',
  main: 'Main content',
  section: 'Section',
  aside: 'Sidebar',
  nav: 'Navigation',
  header: 'Header',
  footer: 'Footer',
  form: 'Form',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  dl: 'List',
  pre: 'Code block',
  code: 'Code',
  blockquote: 'Quote',
  p: 'Paragraph',
  video: 'Video',
  iframe: 'Embedded frame',
  button: 'Button',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
};

/** Describes an element the way a person would name it. */
export function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const explicit = ELEMENT_LABELS[tag];
  if (explicit !== undefined) {
    return explicit;
  }

  // A generic container is more usefully described by what it contains.
  const role = element.getAttribute('role');
  if (role === 'article' || role === 'main') {
    return 'Article';
  }
  if (role === 'table' || role === 'grid') {
    return 'Table';
  }
  if (element.querySelector('img, picture, svg') !== null && element.textContent.trim() === '') {
    return 'Image';
  }
  return 'Section';
}

/** Bounds of an element in document coordinates, in CSS pixels. */
export function elementBounds(element: Element): CaptureBounds {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Full scrollable size of the document.
 *
 * The maximum across the four candidate measurements is used because no single
 * one is correct on every page: `body.scrollHeight` misses absolutely
 * positioned content that overflows, while `documentElement.scrollHeight` can
 * be short on pages that set `height: 100%`.
 */
export function documentBounds(): { width: number; height: number } {
  const { body, documentElement: root } = document;
  return {
    width: Math.max(body.scrollWidth, body.offsetWidth, root.scrollWidth, root.offsetWidth, root.clientWidth),
    height: Math.max(
      body.scrollHeight,
      body.offsetHeight,
      root.scrollHeight,
      root.offsetHeight,
      root.clientHeight,
    ),
  };
}

/** Clamps a rectangle to the document, discarding sub-pixel jitter. */
export function normalizeBounds(bounds: CaptureBounds): CaptureBounds {
  const page = documentBounds();
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.ceil(bounds.width), page.width - x)),
    height: Math.max(1, Math.min(Math.ceil(bounds.height), page.height - y)),
  };
}

/** True when an element is laid out and visible enough to be worth selecting. */
export function isSelectable(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return false;
  }
  const style = window.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

/**
 * Walks up to the nearest ancestor that is meaningfully larger than the
 * starting element, so repeatedly pressing "parent" makes visible progress
 * instead of stepping through wrapper elements of identical size.
 */
export function meaningfulParent(element: Element): Element | null {
  const startArea = element.getBoundingClientRect().width * element.getBoundingClientRect().height;
  let candidate = element.parentElement;

  while (candidate !== null && candidate !== document.documentElement) {
    const rect = candidate.getBoundingClientRect();
    if (rect.width * rect.height > startArea * 1.05 && isSelectable(candidate)) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return candidate;
}

/** The largest selectable child, used for stepping inward from a container. */
export function meaningfulChild(element: Element): Element | null {
  let best: Element | null = null;
  let bestArea = 0;

  for (const child of Array.from(element.children)) {
    if (!isSelectable(child)) {
      continue;
    }
    const rect = child.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = child;
      bestArea = area;
    }
  }
  return best;
}
