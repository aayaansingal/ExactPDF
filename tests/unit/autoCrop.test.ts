import { describe, expect, it } from 'vitest';
import { computeAutoCropBox } from '../../src/capture/exact/autoCrop.js';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: [number, number, number, number];
}

/** Builds RGBA pixel data: a background fill plus any number of blocks. */
function image(
  width: number,
  height: number,
  background: [number, number, number, number],
  rects: Rect[] = [],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels.set(background, index * 4);
  }
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        pixels.set(rect.color, (y * width + x) * 4);
      }
    }
  }
  return pixels;
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

describe('computeAutoCropBox', () => {
  it('trims uniform background down to the content', () => {
    const pixels = image(100, 100, WHITE, [{ x: 20, y: 30, width: 40, height: 25, color: BLACK }]);
    expect(computeAutoCropBox(pixels, 100, 100)).toEqual({ x: 20, y: 30, width: 40, height: 25 });
  });

  it('returns the whole image when it is entirely uniform', () => {
    const pixels = image(50, 40, WHITE);
    expect(computeAutoCropBox(pixels, 50, 40)).toEqual({ x: 0, y: 0, width: 50, height: 40 });
  });

  it('detects a dark background as readily as a light one', () => {
    const dark: [number, number, number, number] = [17, 24, 39, 255];
    const pixels = image(60, 60, dark, [{ x: 10, y: 10, width: 20, height: 20, color: WHITE }]);
    expect(computeAutoCropBox(pixels, 60, 60)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('keeps content that reaches the image edge', () => {
    const pixels = image(40, 40, WHITE, [{ x: 0, y: 0, width: 30, height: 20, color: BLACK }]);
    expect(computeAutoCropBox(pixels, 40, 40)).toEqual({ x: 0, y: 0, width: 30, height: 20 });
  });

  it('tolerates compression noise within the tolerance', () => {
    const pixels = image(40, 40, WHITE, [
      { x: 5, y: 5, width: 10, height: 10, color: BLACK },
      // A near-white speck that JPEG would introduce, well inside tolerance.
      { x: 35, y: 35, width: 1, height: 1, color: [252, 253, 255, 255] },
    ]);
    expect(computeAutoCropBox(pixels, 40, 40, { tolerance: 6 })).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 10,
    });
  });

  it('treats a lone stray pixel as noise under the noise ratio', () => {
    const pixels = image(200, 200, WHITE, [
      { x: 50, y: 50, width: 50, height: 50, color: BLACK },
      { x: 190, y: 5, width: 1, height: 1, color: BLACK },
    ]);
    const box = computeAutoCropBox(pixels, 200, 200, { noiseRatio: 0.01 });
    expect(box).toEqual({ x: 50, y: 50, width: 50, height: 50 });
  });

  it('applies padding without leaving the image', () => {
    const pixels = image(50, 50, WHITE, [{ x: 1, y: 1, width: 10, height: 10, color: BLACK }]);
    const box = computeAutoCropBox(pixels, 50, 50, { padding: 4 });
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.x + box.width).toBeLessThanOrEqual(50);
    expect(box.y + box.height).toBeLessThanOrEqual(50);
  });

  it('returns the full image for malformed input rather than an empty crop', () => {
    expect(computeAutoCropBox(new Uint8ClampedArray(4), 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(computeAutoCropBox(new Uint8ClampedArray(0), 0, 0)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it('ignores a logo in one corner when sampling the background', () => {
    // Three corners are white, one is dark: the majority must win.
    const pixels = image(80, 80, WHITE, [
      { x: 0, y: 0, width: 8, height: 8, color: BLACK },
      { x: 30, y: 30, width: 20, height: 20, color: BLACK },
    ]);
    const box = computeAutoCropBox(pixels, 80, 80);
    expect(box).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });
});
