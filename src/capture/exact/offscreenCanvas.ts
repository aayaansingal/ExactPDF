/**
 * The `OffscreenCanvas` implementation of {@link CanvasBackend}.
 *
 * `OffscreenCanvas` is what makes compositing possible inside a Manifest V3
 * service worker, which has no DOM and therefore no `<canvas>` element.
 */

import type { CanvasBackend, DecodedImage, StitchCanvas } from './visualCapture.js';

class OffscreenStitchCanvas implements StitchCanvas {
  private canvas: OffscreenCanvas;
  private context: OffscreenCanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      throw new Error('2D context unavailable');
    }
    this.context = context;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  drawImage(
    image: DecodedImage,
    source: { x: number; y: number; width: number; height: number },
    destination: { x: number; y: number; width: number; height: number },
  ): void {
    // Clamp to the decoded image: a tile at the page's bottom edge asks for
    // rows the screenshot does not contain, and drawImage rejects those.
    const sourceWidth = Math.min(source.width, image.width - source.x);
    const sourceHeight = Math.min(source.height, image.height - source.y);
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      return;
    }
    const ratio = sourceHeight / source.height;

    this.context.drawImage(
      image as unknown as ImageBitmap,
      source.x,
      source.y,
      sourceWidth,
      sourceHeight,
      destination.x,
      destination.y,
      destination.width * (sourceWidth / source.width),
      destination.height * ratio,
    );
  }

  getPixels(): Uint8ClampedArray {
    return this.context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
  }

  crop(box: { x: number; y: number; width: number; height: number }): void {
    if (box.width === this.canvas.width && box.height === this.canvas.height && box.x === 0 && box.y === 0) {
      return;
    }
    const cropped = this.context.getImageData(box.x, box.y, box.width, box.height);

    this.canvas = new OffscreenCanvas(box.width, box.height);
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      throw new Error('2D context unavailable');
    }
    this.context = context;
    this.context.putImageData(cropped, 0, 0);
  }

  async toDataUrl(format: 'image/png' | 'image/jpeg', quality: number): Promise<string> {
    const blob = await this.canvas.convertToBlob({ type: format, quality });
    return blobToDataUrl(blob);
  }
}

export const offscreenCanvasBackend: CanvasBackend = {
  createCanvas(width, height) {
    return new OffscreenStitchCanvas(width, height);
  },

  async decode(dataUrl) {
    // `fetch` on a data: URL stays entirely in-process; nothing leaves the
    // device. It is simply the shortest path from a data URL to a Blob.
    const blob = await (await fetch(dataUrl)).blob();
    return createImageBitmap(blob);
  },
};

/**
 * Encodes a Blob as a data URL.
 *
 * `FileReader` does not exist in a Manifest V3 service worker, so the bytes are
 * base64-encoded directly. The chunking matters: `String.fromCharCode` applied
 * to a multi-megabyte screenshot in one call overflows the argument stack.
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK_SIZE = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
