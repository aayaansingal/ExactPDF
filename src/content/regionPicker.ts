/**
 * Select Region mode.
 *
 * A crosshair and a translucent drag rectangle with live pixel dimensions. Once
 * drawn, the rectangle can be moved or resized from any of its eight handles
 * before the user commits, because getting a crop right on the first drag is
 * rare and re-dragging from scratch is the main frustration of this interaction
 * elsewhere.
 */

import { normalizeBounds } from './lib/dom.js';
import { claimInjectionSlot, sendToBackground } from './lib/messaging.js';
import { OVERLAY_STYLES } from './lib/overlayStyles.js';
import { ok, type Result } from '../shared/errors.js';
import type { ContentCommand } from '../shared/messages.js';

const SLOT = 'regionPicker';
const MIN_REGION_PX = 8;

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface PickerHandle {
  abort(): void;
}

function start(sessionId: string): PickerHandle {
  const host = document.createElement('div');
  host.id = 'exactpdf-region-picker';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;

  const root = document.createElement('div');
  root.className = 'root';

  const dim = document.createElement('div');
  dim.className = 'dim';

  const region = document.createElement('div');
  region.className = 'region';
  region.style.display = 'none';

  const size = document.createElement('div');
  size.className = 'size';
  size.style.display = 'none';

  const hint = document.createElement('div');
  hint.className = 'hint';
  for (const [key, action] of [
    ['Drag', 'draw a region'],
    ['Enter', 'capture'],
    ['Esc', 'cancel'],
  ]) {
    const span = document.createElement('span');
    const kbd = document.createElement('kbd');
    kbd.textContent = key ?? '';
    span.append(kbd, document.createTextNode(` ${action ?? ''}`));
    hint.appendChild(span);
  }

  const handles = new Map<Handle, HTMLElement>();
  for (const name of HANDLES) {
    const node = document.createElement('div');
    node.className = 'handle';
    node.style.display = 'none';
    handles.set(name, node);
    root.appendChild(node);
  }

  root.append(dim, region, size, hint);
  shadow.append(style, root);
  document.documentElement.appendChild(host);

  let rect: Rect | null = null;
  let finished = false;
  /** What the current pointer drag is doing: drawing, moving or resizing. */
  let drag:
    | { kind: 'draw'; anchorX: number; anchorY: number }
    | { kind: 'move'; offsetX: number; offsetY: number }
    | { kind: 'resize'; handle: Handle }
    | null = null;

  const clampToViewport = (value: number, max: number): number => Math.max(0, Math.min(value, max));

  const paint = (): void => {
    if (rect === null) {
      region.style.display = 'none';
      size.style.display = 'none';
      for (const node of handles.values()) {
        node.style.display = 'none';
      }
      return;
    }

    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;

    region.style.display = 'block';
    region.style.left = `${rect.left}px`;
    region.style.top = `${rect.top}px`;
    region.style.width = `${width}px`;
    region.style.height = `${height}px`;

    size.style.display = 'block';
    size.textContent = `${Math.round(width)} x ${Math.round(height)} px`;
    size.style.left = `${rect.left}px`;
    size.style.top = rect.top >= 24 ? `${rect.top - 22}px` : `${rect.bottom + 6}px`;

    for (const [name, node] of handles) {
      const position = handlePosition(name, rect);
      node.style.display = 'block';
      node.style.left = `${position.x - 6}px`;
      node.style.top = `${position.y - 6}px`;
      node.style.cursor = `${name}-resize`;
    }
  };

  const normalized = (value: Rect): Rect => ({
    left: Math.min(value.left, value.right),
    right: Math.max(value.left, value.right),
    top: Math.min(value.top, value.bottom),
    bottom: Math.max(value.top, value.bottom),
  });

  const teardown = (): void => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange, true);
    host.remove();
  };

  const confirm = (): void => {
    if (rect === null || finished) {
      return;
    }
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    if (width < MIN_REGION_PX || height < MIN_REGION_PX) {
      return;
    }
    finished = true;

    const bounds = normalizeBounds({
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width,
      height,
    });

    teardown();
    void sendToBackground({
      type: 'selectionComplete',
      sessionId,
      bounds,
      contentLabel: 'Region',
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

  function hitHandle(x: number, y: number): Handle | null {
    if (rect === null) {
      return null;
    }
    for (const name of HANDLES) {
      const position = handlePosition(name, rect);
      if (Math.abs(position.x - x) <= 8 && Math.abs(position.y - y) <= 8) {
        return name;
      }
    }
    return null;
  }

  function onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const handle = hitHandle(event.clientX, event.clientY);
    if (handle !== null) {
      drag = { kind: 'resize', handle };
      return;
    }

    if (rect !== null && isInside(rect, event.clientX, event.clientY)) {
      drag = { kind: 'move', offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      return;
    }

    drag = { kind: 'draw', anchorX: event.clientX, anchorY: event.clientY };
    rect = { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY };
    paint();
  }

  function onPointerMove(event: PointerEvent): void {
    if (drag === null || rect === null) {
      return;
    }
    event.preventDefault();

    const x = clampToViewport(event.clientX, window.innerWidth);
    const y = clampToViewport(event.clientY, window.innerHeight);

    if (drag.kind === 'draw') {
      rect = normalized({ left: drag.anchorX, top: drag.anchorY, right: x, bottom: y });
    } else if (drag.kind === 'move') {
      const width = rect.right - rect.left;
      const height = rect.bottom - rect.top;
      const left = clampToViewport(x - drag.offsetX, window.innerWidth - width);
      const top = clampToViewport(y - drag.offsetY, window.innerHeight - height);
      rect = { left, top, right: left + width, bottom: top + height };
    } else {
      rect = normalized(resizeRect(rect, drag.handle, x, y));
    }
    paint();
  }

  function onPointerUp(event: PointerEvent): void {
    if (drag === null) {
      return;
    }
    event.preventDefault();
    drag = null;

    // A stray click rather than a drag should not leave a one-pixel region.
    if (rect !== null && rect.right - rect.left < MIN_REGION_PX && rect.bottom - rect.top < MIN_REGION_PX) {
      rect = null;
      paint();
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel(true);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      confirm();
    }
  }

  // The rectangle is held in viewport coordinates; a scroll would silently move
  // it over different content, so the selection is discarded instead.
  function onViewportChange(): void {
    if (rect !== null && drag === null) {
      rect = null;
      paint();
    }
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange, true);

  return {
    abort: () => {
      cancel(false);
    },
  };
}

function isInside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function handlePosition(handle: Handle, rect: Rect): { x: number; y: number } {
  const midX = (rect.left + rect.right) / 2;
  const midY = (rect.top + rect.bottom) / 2;
  switch (handle) {
    case 'nw':
      return { x: rect.left, y: rect.top };
    case 'n':
      return { x: midX, y: rect.top };
    case 'ne':
      return { x: rect.right, y: rect.top };
    case 'e':
      return { x: rect.right, y: midY };
    case 'se':
      return { x: rect.right, y: rect.bottom };
    case 's':
      return { x: midX, y: rect.bottom };
    case 'sw':
      return { x: rect.left, y: rect.bottom };
    case 'w':
      return { x: rect.left, y: midY };
  }
}

/** Moves the edges a handle controls, leaving the opposite edges fixed. */
export function resizeRect(rect: Rect, handle: Handle, x: number, y: number): Rect {
  const next = { ...rect };
  if (handle.includes('n')) next.top = y;
  if (handle.includes('s')) next.bottom = y;
  if (handle.includes('w')) next.left = x;
  if (handle.includes('e')) next.right = x;
  return next;
}

let active: PickerHandle | null = null;

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
