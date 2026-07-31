/**
 * Styles for the selection overlays.
 *
 * The overlay lives in a closed shadow root attached to a single host element,
 * so page CSS cannot restyle it and these rules cannot leak into the page. That
 * matters twice over: the overlay must look the same on every site, and it must
 * leave no trace once the capture finishes.
 */
export const OVERLAY_STYLES = `
:host { all: initial; }

.root {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  cursor: crosshair;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.dim {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.28);
  pointer-events: none;
}

.highlight {
  position: absolute;
  border: 2px solid #2563eb;
  border-radius: 2px;
  background: rgba(37, 99, 235, 0.12);
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.28);
  pointer-events: none;
  transition: none;
}

.label {
  position: absolute;
  padding: 4px 8px;
  border-radius: 4px;
  background: #2563eb;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.3);
}

.hint {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 10px 16px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.92);
  color: #f8fafc;
  font-size: 12.5px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.35);
}

.hint kbd {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(248, 250, 252, 0.35);
  background: rgba(248, 250, 252, 0.12);
  font-family: inherit;
  font-size: 11px;
}

.region {
  position: absolute;
  border: 2px solid #2563eb;
  background: rgba(37, 99, 235, 0.14);
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.28);
}

.size {
  position: absolute;
  padding: 3px 7px;
  border-radius: 4px;
  background: #0f172a;
  color: #f8fafc;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid #2563eb;
  border-radius: 50%;
  background: #ffffff;
}

@media (prefers-reduced-motion: reduce) {
  .highlight { transition: none; }
}
`;
