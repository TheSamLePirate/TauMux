/**
 * Minimal PNG encoder for HyperTerm Canvas demos.
 * Produces zlib-compressed RGBA PNGs — typically 5-20x smaller than uncompressed.
 * Zero dependencies beyond Bun's built-in zlib.
 */

import { deflateSync } from "zlib";

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/**
 * Encode RGBA pixel buffer to compressed PNG.
 * @param w - Width in pixels
 * @param h - Height in pixels
 * @param rgba - RGBA pixel buffer (length must be w * h * 4)
 * @returns PNG file bytes
 */
export function encodePNG(w: number, h: number, rgba: Uint8Array): Uint8Array {
  // Build raw scanlines: filter byte (0 = None) + row RGBA data
  const raw = new Uint8Array(h * (1 + w * 4));
  let offset = 0;
  for (let y = 0; y < h; y++) {
    raw[offset++] = 0; // filter: none
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), offset);
    offset += w * 4;
  }

  // Compress with zlib (deflateSync produces zlib-wrapped output)
  const compressed = deflateSync(raw, { level: 6 });

  // PNG signature
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, w);
  ihdrView.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // compression, filter, interlace = 0

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", new Uint8Array(compressed));
  const iendChunk = makeChunk("IEND", new Uint8Array(0));

  const png = new Uint8Array(
    sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let p = 0;
  png.set(sig, p);
  p += sig.length;
  png.set(ihdrChunk, p);
  p += ihdrChunk.length;
  png.set(idatChunk, p);
  p += idatChunk.length;
  png.set(iendChunk, p);

  return png;
}
