/**
 * Select Element mode.
 *
 * Dims the page, outlines whatever is under the pointer, names it in plain
 * language, and lets the user widen or narrow the selection with the arrow keys
 * before confirming. The overlay is injected on demand and removes itself
 * completely on confirm, cancel or abort, leaving no attribute or style behind.
 */

import {
  describeElement,
  elementBounds,
  isSelectable,
  meaningfulChild,
  meaningfulParent,
  normalizeBounds,
} from './lib/dom.js';
import { claimInjectionSlot, sendToBackground } from './lib/messaging.js';
import { OVERLAY_STYLES } from './lib/overlayStyles.js';
import { ok, type Result } from '../shared/errors.js';
import type { ContentCommand } from '../shared/messages.js';

const SLOT = 'elementPicker';
const HOST_ID = 'exactpdf-element-picker';

interface PickerHandle {
  abort(): void;
}

function start(sessionId: string): PickerHandle {
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;

  const root = document.createElement('div');
  root.className = 'root';

  const highlight = document.createElement('div');
  highlight.className = 'highlight';
  highlight.style.display = 'none';

  const labelChip = document.createElement('div');
  labelChip.className = 'label';
  labelChip.style.display = 'none';

  const hint = document.createElement('div');
  hint.className = 'hint';
  for (const [key, action] of [
    ['Click', 'select'],
    ['↑', 'wider'],
    ['↓', 'narrower'],
    ['Enter', 'capture'],
    ['Esc', 'cancel'],
  ]) {
    const span = document.createElement('span');
    const kbd = document.createElement('kbd');
    kbd.textContent = key ?? '';
    span.append(kbd, document.createTextNode(` ${action ?? ''}`));
    hint.appendChild(span);
  }

  root.append(highlight, labelChip, hint);
  shadow.append(style, root);
  document.documentElement.appendChild(host);

  let current: Element | null = null;
  let finished = false;

  const paint = (element: Element | null): void => {
    current = element;
    if (element === null) {
      highlight.style.display = 'none';
      labelChip.style.display = 'none';
      return;
    }

    const rect = element.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;

    labelChip.textContent = `${describeElement(element)}  ${Math.round(rect.width)} x ${Math.round(rect.height)}`;
    labelChip.style.display = 'block';
    labelChip.style.left = `${Math.max(4, rect.left)}px`;
    // Keep the chip on screen when the element touches the viewport top.
    labelChip.style.top =
      rect.top >= 26 ? `${rect.top - 26}px` : `${Math.min(window.innerHeight - 26, rect.bottom + 4)}px`;
  };

  /** The overlay covers the page, so the element beneath it must be asked for. */
  const elementAtPointer = (event: MouseEvent): Element | null => {
    host.style.pointerEvents = 'none';
    const found = document.elementFromPoint(event.clientX, event.clientY);
    host.style.pointerEvents = '';
    return found === null || found === document.documentElement || !isSelectable(found) ? null : found;
  };

  const teardown = (): void => {
    window.removeEventListener('mousemove', onPointerMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange, true);
    host.remove();
  };

  const confirm = (): void => {
    if (current === null || finished) {
      return;
    }
    finished = true;
    const element = current;
    const contentLabel = describeElement(element);
    const bounds = normalizeBounds(elementBounds(element));

    // The overlay must be gone before the service worker photographs the tab.
    teardown();

    void sendToBackground({
      type: 'selectionComplete',
      sessionId,
      bounds,
      contentLabel,
      devicePixelRatio: window.devicePixelRatio,
    });
  };

  const cancel = (notify: boolean): void => {
    if (finished) {
      return;
    }
    finished = true;
    teardown();
    if (notify) {
      void sendToBackground({ type: 'selectionCancelled', sessionId });
    }
  };

  function onClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    paint(elementAtPointer(event));
    confirm();
  }

  function onPointerMove(event: MouseEvent): void {
    paint(elementAtPointer(event));
  }

  function onKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        cancel(true);
        return;
      case 'Enter':
        event.preventDefault();
        confirm();
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (current !== null) {
          paint(meaningfulParent(current) ?? current);
        }
        return;
      case 'ArrowDown':
        event.preventDefault();
        if (current !== null) {
          paint(meaningfulChild(current) ?? current);
        }
        return;
      default:
    }
  }

  // The highlight is positioned in viewport coordinates, so it has to be
  // repainted whenever the viewport moves under it.
  function onViewportChange(): void {
    if (current !== null) {
      paint(current);
    }
  }

  window.addEventListener('mousemove', onPointerMove, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange, true);

  return {
    abort: () => {
      cancel(false);
    },
  };
}

let active: PickerHandle | null = null;

// Re-injecting a file runs it again, so the listener is registered only once per
// frame. The service worker follows injection with `beginSelection`, which the
// already-registered listener handles just as well.
if (claimInjectionSlot(`${SLOT}Listener`)) {
  chrome.runtime.onMessage.addListener(
    (message: ContentCommand, _sender, sendResponse: (response: Result<unknown>) => void) => {
      if (message.type === 'beginSelection') {
        active?.abort();
        active = start(message.sessionId);
        sendResponse(ok({ started: true }));
        return false;
      }
      if (message.type === 'abortSelection') {
        active?.abort();
        active = null;
        sendResponse(ok({ aborted: true }));
        return false;
      }
      return false;
    },
  );
}
