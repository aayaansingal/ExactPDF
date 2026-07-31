/**
 * Automatic blank-space removal.
 *
 * Element captures frequently include a band of page background above or below
 * the content the user actually wanted -- an element's box can be far taller
 * than its ink. Rows and columns are trimmed only while they are uniformly the
 * same colour as the image's own border, so a deliberately blank margin inside
 * a screenshot of a UI is preserved while page background is not.
 */

export interface CropBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AutoCropOptions {
  /**
   * Per-channel tolerance (0-255). Anti-aliasing and JPEG ringing mean an
   * exactly uniform row is rare, so a small tolerance is required for the
   * detection to fire at all on real captures.
   */
  readonly tolerance?: number;
  /** Fraction of a row's pixels that may differ before it counts as content. */
  readonly noiseRatio?: number;
  /** Blank pixels deliberately left around the content, in image pixels. */
  readonly padding?: number;
}

const DEFAULT_TOLERANCE = 6;
const DEFAULT_NOISE_RATIO = 0.005;

/**
 * Computes the crop rectangle for RGBA pixel data.
 *
 * Returns the full image when the capture is entirely uniform: an empty crop
 * would produce a zero-page PDF, and handing the user their blank capture is
 * more honest than silently producing nothing.
 */
export function computeAutoCropBox(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: AutoCropOptions = {},
): CropBox {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const noiseRatio = options.noiseRatio ?? DEFAULT_NOISE_RATIO;
  const padding = options.padding ?? 0;
  const full: CropBox = { x: 0, y: 0, width, height };

  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) {
    return full;
  }

  const background = sampleBackground(pixels, width, height);

  const isBlankAt = (x: number, y: number): boolean => {
    const offset = (y * width + x) * 4;
    return (
      Math.abs((pixels[offset] ?? 0) - background.r) <= tolerance &&
      Math.abs((pixels[offset + 1] ?? 0) - background.g) <= tolerance &&
      Math.abs((pixels[offset + 2] ?? 0) - background.b) <= tolerance &&
      Math.abs((pixels[offset + 3] ?? 0) - background.a) <= tolerance
    );
  };

  const rowIsBlank = (y: number): boolean => {
    const allowed = Math.floor(width * noiseRatio);
    let differing = 0;
    for (let x = 0; x < width; x += 1) {
      if (!isBlankAt(x, y)) {
        differing += 1;
        if (differing > allowed) {
          return false;
        }
      }
    }
    return true;
  };

  const columnIsBlank = (x: number, top: number, bottom: number): boolean => {
    const allowed = Math.floor((bottom - top + 1) * noiseRatio);
    let differing = 0;
    for (let y = top; y <= bottom; y += 1) {
      if (!isBlankAt(x, y)) {
        differing += 1;
        if (differing > allowed) {
          return false;
        }
      }
    }
    return true;
  };

  let top = 0;
  while (top < height && rowIsBlank(top)) {
    top += 1;
  }
  if (top === height) {
    return full;
  }

  let bottom = height - 1;
  while (bottom > top && rowIsBlank(bottom)) {
    bottom -= 1;
  }

  let left = 0;
  while (left < width && columnIsBlank(left, top, bottom)) {
    left += 1;
  }
  if (left === width) {
    return full;
  }

  let right = width - 1;
  while (right > left && columnIsBlank(right, top, bottom)) {
    right -= 1;
  }

  const x = Math.max(0, left - padding);
  const y = Math.max(0, top - padding);
  return {
    x,
    y,
    width: Math.min(width - x, right - left + 1 + padding * 2),
    height: Math.min(height - y, bottom - top + 1 + padding * 2),
  };
}

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Takes the most common colour around the image's border.
 *
 * Sampling the whole perimeter rather than the four corners matters on real
 * captures: a corner routinely lands on a logo, a rounded card or a scrollbar,
 * and one unlucky pixel would otherwise define "background" for the entire
 * crop. Colours are bucketed before counting so anti-aliasing along the border
 * does not split one background into dozens of near-identical votes.
 */
function sampleBackground(pixels: Uint8ClampedArray, width: number, height: number): Rgba {
  const counts = new Map<number, { color: Rgba; count: number }>();

  const record = (x: number, y: number): void => {
    const color = readPixel(pixels, width, x, y);
    // 3-bit-per-channel buckets: coarse enough to absorb gradients, fine
    // enough to keep genuinely different backgrounds apart.
    const key = ((color.r >> 3) << 24) | ((color.g >> 3) << 16) | ((color.b >> 3) << 8) | (color.a >> 3);
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, { color, count: 1 });
    } else {
      existing.count += 1;
    }
  };

  for (let x = 0; x < width; x += 1) {
    record(x, 0);
    record(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    record(0, y);
    record(width - 1, y);
  }

  let best = readPixel(pixels, width, 0, 0);
  let bestCount = 0;
  for (const entry of counts.values()) {
    if (entry.count > bestCount) {
      best = entry.color;
      bestCount = entry.count;
    }
  }
  return best;
}

function readPixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): Rgba {
  const offset = (y * width + x) * 4;
  return {
    r: pixels[offset] ?? 0,
    g: pixels[offset + 1] ?? 0,
    b: pixels[offset + 2] ?? 0,
    a: pixels[offset + 3] ?? 255,
  };
}
