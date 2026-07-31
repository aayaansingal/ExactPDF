/**
 * Generates the extension icons as PNGs.
 *
 * Written by hand rather than pulled from an image library: the mark is a few
 * rectangles, and a build-time dependency that decodes arbitrary image formats
 * is a poor trade for that. Keeping the generator in the repository also means
 * the icons are reproducible from source, which the store submission checklist
 * asks for.
 *
 * The mark: a rounded document with a crop-corner bracket over it, in the
 * product's accent blue. It reads at 16px because it is only three shapes.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const OUTPUT_DIR = 'public/icons';

const ACCENT = [37, 99, 235, 255];
const PAPER = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

/** Signed CRC-32, as PNG requires. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** Encodes RGBA pixel data as a PNG buffer. */
function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const unit = size / 32;

  const set = (x, y, colour) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 4;
    pixels[offset] = colour[0];
    pixels[offset + 1] = colour[1];
    pixels[offset + 2] = colour[2];
    pixels[offset + 3] = colour[3];
  };

  const fillRect = (x0, y0, x1, y1, colour) => {
    for (let y = Math.round(y0); y < Math.round(y1); y += 1) {
      for (let x = Math.round(x0); x < Math.round(x1); x += 1) {
        set(x, y, colour);
      }
    }
  };

  // Rounded accent tile.
  const radius = Math.max(1, Math.round(6 * unit));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      const inCorner = dx < radius && dy < radius;
      const distance = Math.hypot(radius - dx, radius - dy);
      set(x, y, inCorner && distance > radius ? TRANSPARENT : ACCENT);
    }
  }

  // The document.
  fillRect(9 * unit, 7 * unit, 23 * unit, 25 * unit, PAPER);

  // Text lines, drawn in the accent so they read as ink on paper.
  const lineHeight = Math.max(1, Math.round(1.5 * unit));
  for (let index = 0; index < 4; index += 1) {
    const top = (11 + index * 3.2) * unit;
    const right = index === 3 ? 18 * unit : 20 * unit;
    fillRect(11.5 * unit, top, right, top + lineHeight, ACCENT);
  }

  // Crop bracket, marking this as a selection tool rather than a file icon.
  const thickness = Math.max(1, Math.round(2 * unit));
  fillRect(4 * unit, 4 * unit, 4 * unit + thickness, 12 * unit, PAPER);
  fillRect(4 * unit, 4 * unit, 12 * unit, 4 * unit + thickness, PAPER);
  fillRect(28 * unit - thickness, 20 * unit, 28 * unit, 28 * unit, PAPER);
  fillRect(20 * unit, 28 * unit - thickness, 28 * unit, 28 * unit, PAPER);

  return pixels;
}

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const size of SIZES) {
  const png = encodePng(drawIcon(size), size);
  writeFileSync(`${OUTPUT_DIR}/icon-${size}.png`, png);
  console.log(`  ${OUTPUT_DIR}/icon-${size}.png (${png.length} bytes)`);
}
