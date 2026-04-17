#!/usr/bin/env bun
/**
 * HyperTerm Canvas — QR Code Generator
 *
 * Generates QR codes from text input, rendered as SVG in a floating panel.
 * Pure TypeScript QR encoding — no external dependencies.
 *
 * Usage:
 *   bun scripts/demo_qrcode.ts "https://example.com"   — encode URL
 *   echo "hello" | bun scripts/demo_qrcode.ts           — encode piped input
 *   bun scripts/demo_qrcode.ts                           — interactive live mode
 */

// ---------------------------------------------------------------------------
// Environment / fd setup
// ---------------------------------------------------------------------------

const META_FD = process.env["HYPERTERM_META_FD"]
  ? parseInt(process.env["HYPERTERM_META_FD"])
  : null;
const DATA_FD = process.env["HYPERTERM_DATA_FD"]
  ? parseInt(process.env["HYPERTERM_DATA_FD"])
  : null;
const EVENT_FD = process.env["HYPERTERM_EVENT_FD"]
  ? parseInt(process.env["HYPERTERM_EVENT_FD"])
  : null;

const hasHyperTerm = META_FD !== null && DATA_FD !== null;

if (!hasHyperTerm) {
  console.log(
    "This script requires HyperTerm Canvas.\n" +
      "Run it inside the HyperTerm terminal emulator.",
  );
  process.exit(0);
}

const PANEL_ID = "qrcode";
const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Low-level fd helpers
// ---------------------------------------------------------------------------

function writeMeta(meta: Record<string, unknown>): void {
  try {
    Bun.write(Bun.file(META_FD!), encoder.encode(JSON.stringify(meta) + "\n"));
  } catch {
    /* fd write failed */
  }
}

function writeData(str: string): void {
  try {
    Bun.write(Bun.file(DATA_FD!), encoder.encode(str));
  } catch {
    /* fd write failed */
  }
}

// ---------------------------------------------------------------------------
// Catppuccin Mocha palette
// ---------------------------------------------------------------------------

const C = {
  base: "#1e1e2e",
  surface0: "#313244",
  surface1: "#45475a",
  overlay0: "#6c7086",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  blue: "#89b4fa",
  green: "#a6e3a1",
  red: "#f38ba8",
  yellow: "#f9e2af",
} as const;

// ---------------------------------------------------------------------------
// QR Code — Galois Field GF(256) arithmetic
// ---------------------------------------------------------------------------

// GF(256) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 = 0x11d
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

function initGaloisField(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = x << 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  // Duplicate for wraparound
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

initGaloisField();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}

// ---------------------------------------------------------------------------
// Reed-Solomon error correction
// ---------------------------------------------------------------------------

function rsGeneratorPoly(numEc: number): Uint8Array {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < numEc; i++) {
    const newGen = new Uint8Array(gen.length + 1);
    const factor = GF_EXP[i];
    for (let j = gen.length - 1; j >= 0; j--) {
      newGen[j + 1] ^= gen[j];
      newGen[j] ^= gfMul(gen[j], factor);
    }
    gen = newGen;
  }
  return gen;
}

function rsEncode(data: Uint8Array, numEc: number): Uint8Array {
  const gen = rsGeneratorPoly(numEc);
  const padded = new Uint8Array(data.length + numEc);
  padded.set(data);

  for (let i = 0; i < data.length; i++) {
    const coeff = padded[i];
    if (coeff === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      padded[i + j] ^= gfMul(gen[j], coeff);
    }
  }

  // EC codewords are the remainder
  return padded.slice(data.length);
}

// ---------------------------------------------------------------------------
// QR Code — version/capacity tables (versions 1-10, EC level M)
// ---------------------------------------------------------------------------

// Total codewords, EC codewords per block, number of blocks (group1Count, group1DataCw, group2Count, group2DataCw)
interface VersionInfo {
  version: number;
  size: number; // modules per side
  totalCodewords: number;
  ecCwPerBlock: number;
  group1Blocks: number;
  group1DataCw: number;
  group2Blocks: number;
  group2DataCw: number;
  // Capacity in byte mode (number of data bytes)
  byteCapacity: number;
  alphanumericCapacity: number;
  numericCapacity: number;
}

// EC level M data from QR specification
const VERSION_TABLE: VersionInfo[] = [
  // v1: 21x21, 26 total cw, 10 EC cw/block, 1 block
  {
    version: 1,
    size: 21,
    totalCodewords: 26,
    ecCwPerBlock: 10,
    group1Blocks: 1,
    group1DataCw: 16,
    group2Blocks: 0,
    group2DataCw: 0,
    byteCapacity: 14,
    alphanumericCapacity: 20,
    numericCapacity: 34,
  },
  // v2: 25x25
  {
    version: 2,
    size: 25,
    totalCodewords: 44,
    ecCwPerBlock: 16,
    group1Blocks: 1,
    group1DataCw: 28,
    group2Blocks: 0,
    group2DataCw: 0,
    byteCapacity: 26,
    alphanumericCapacity: 38,
    numericCapacity: 63,
  },
  // v3: 29x29
  {
    version: 3,
    size: 29,
    totalCodewords: 70,
    ecCwPerBlock: 26,
    group1Blocks: 1,
    group1DataCw: 44,
    group2Blocks: 0,
    group2DataCw: 0,
    byteCapacity: 42,
    alphanumericCapacity: 61,
    numericCapacity: 101,
  },
  // v4: 33x33
  {
    version: 4,
    size: 33,
    totalCodewords: 100,
    ecCwPerBlock: 18,
    group1Blocks: 2,
    group1DataCw: 32,
    group2Blocks: 0,
    group2DataCw: 0,
    byteCapacity: 62,
    alphanumericCapacity: 90,
    numericCapacity: 149,
  },
  // v5: 37x37
  {
    version: 5,
    size: 37,
    totalCodewords: 134,
    ecCwPerBlock: 24,
    group1Blocks: 2,
    group1DataCw: 43,
    group2Blocks: 0,
    group2DataCw: 0,
    byteCapacity: 84,
    alphanumericCapacity: 122,
    numericCapacity: 202,
  },
  // v6: 41x41
  {
    version: 6,
    size: 41,
    totalCodewords: 172,
    ecCwPerBlock: 16,
    group1Blocks: 4,
    group1DataCw: 27,
    group2Blocks: 0,
    group2DataCw: 0,
    byteCapacity: 106,
    alphanumericCapacity: 154,
    numericCapacity: 255,
  },
  // v7: 45x45
  {
    version: 7,
    size: 45,
    totalCodewords: 196,
    ecCwPerBlock: 18,
    group1Blocks: 4,
    group1DataCw: 31,
    group2Blocks: 0,
    group2DataCw: 0,
    byteCapacity: 122,
    alphanumericCapacity: 178,
    numericCapacity: 293,
  },
  // v8: 49x49
  {
    version: 8,
    size: 49,
    totalCodewords: 242,
    ecCwPerBlock: 22,
    group1Blocks: 2,
    group1DataCw: 38,
    group2Blocks: 2,
    group2DataCw: 39,
    byteCapacity: 152,
    alphanumericCapacity: 221,
    numericCapacity: 365,
  },
  // v9: 53x53
  {
    version: 9,
    size: 53,
    totalCodewords: 292,
    ecCwPerBlock: 22,
    group1Blocks: 3,
    group1DataCw: 36,
    group2Blocks: 2,
    group2DataCw: 37,
    byteCapacity: 180,
    alphanumericCapacity: 262,
    numericCapacity: 432,
  },
  // v10: 57x57
  {
    version: 10,
    size: 57,
    totalCodewords: 346,
    ecCwPerBlock: 26,
    group1Blocks: 4,
    group1DataCw: 43,
    group2Blocks: 1,
    group2DataCw: 44,
    byteCapacity: 213,
    alphanumericCapacity: 311,
    numericCapacity: 513,
  },
];

// ---------------------------------------------------------------------------
// QR Code — mode detection and encoding
// ---------------------------------------------------------------------------

type QRMode = "numeric" | "alphanumeric" | "byte";

const ALPHANUMERIC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

function detectMode(text: string): QRMode {
  if (/^\d+$/.test(text)) return "numeric";
  if (text.split("").every((ch) => ALPHANUMERIC_CHARS.includes(ch))) {
    return "alphanumeric";
  }
  return "byte";
}

function selectVersion(text: string, mode: QRMode): VersionInfo | null {
  const textBytes = encoder.encode(text);
  for (const v of VERSION_TABLE) {
    if (mode === "numeric" && text.length <= v.numericCapacity) return v;
    if (mode === "alphanumeric" && text.length <= v.alphanumericCapacity)
      return v;
    if (mode === "byte" && textBytes.length <= v.byteCapacity) return v;
  }
  return null;
}

// Character count indicator bit length for versions 1-9 vs 10+
function charCountBits(mode: QRMode, version: number): number {
  if (version <= 9) {
    if (mode === "numeric") return 10;
    if (mode === "alphanumeric") return 9;
    return 8; // byte
  }
  // versions 10-26
  if (mode === "numeric") return 12;
  if (mode === "alphanumeric") return 11;
  return 16; // byte
}

// ---------------------------------------------------------------------------
// Bit buffer for building data stream
// ---------------------------------------------------------------------------

class BitBuffer {
  private bits: number[] = [];

  get length(): number {
    return this.bits.length;
  }

  put(value: number, numBits: number): void {
    for (let i = numBits - 1; i >= 0; i--) {
      this.bits.push((value >> i) & 1);
    }
  }

  toBytes(): Uint8Array {
    const numBytes = Math.ceil(this.bits.length / 8);
    const bytes = new Uint8Array(numBytes);
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) {
        bytes[i >> 3] |= 0x80 >> (i & 7);
      }
    }
    return bytes;
  }
}

// ---------------------------------------------------------------------------
// QR Code — data encoding
// ---------------------------------------------------------------------------

function encodeData(
  text: string,
  mode: QRMode,
  vInfo: VersionInfo,
): Uint8Array {
  const buf = new BitBuffer();
  const textBytes = encoder.encode(text);

  // Mode indicator (4 bits)
  if (mode === "numeric") buf.put(0b0001, 4);
  else if (mode === "alphanumeric") buf.put(0b0010, 4);
  else buf.put(0b0100, 4); // byte

  // Character count
  const ccBits = charCountBits(mode, vInfo.version);
  if (mode === "byte") {
    buf.put(textBytes.length, ccBits);
  } else {
    buf.put(text.length, ccBits);
  }

  // Data encoding
  if (mode === "numeric") {
    // Groups of 3, 2, or 1 digits
    for (let i = 0; i < text.length; i += 3) {
      const group = text.slice(i, i + 3);
      if (group.length === 3) {
        buf.put(parseInt(group), 10);
      } else if (group.length === 2) {
        buf.put(parseInt(group), 7);
      } else {
        buf.put(parseInt(group), 4);
      }
    }
  } else if (mode === "alphanumeric") {
    // Pairs of characters
    for (let i = 0; i < text.length; i += 2) {
      const c1 = ALPHANUMERIC_CHARS.indexOf(text[i]);
      if (i + 1 < text.length) {
        const c2 = ALPHANUMERIC_CHARS.indexOf(text[i + 1]);
        buf.put(c1 * 45 + c2, 11);
      } else {
        buf.put(c1, 6);
      }
    }
  } else {
    // Byte mode
    for (let i = 0; i < textBytes.length; i++) {
      buf.put(textBytes[i], 8);
    }
  }

  // Total data codewords
  const totalDataCw =
    vInfo.group1Blocks * vInfo.group1DataCw +
    vInfo.group2Blocks * vInfo.group2DataCw;
  const totalDataBits = totalDataCw * 8;

  // Terminator (up to 4 zero bits)
  const terminatorLen = Math.min(4, totalDataBits - buf.length);
  if (terminatorLen > 0) {
    buf.put(0, terminatorLen);
  }

  // Pad to byte boundary
  while (buf.length % 8 !== 0) {
    buf.put(0, 1);
  }

  // Pad codewords (alternating 0xEC and 0x11)
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (buf.length < totalDataBits) {
    buf.put(padBytes[padIdx], 8);
    padIdx = (padIdx + 1) % 2;
  }

  return buf.toBytes();
}

// ---------------------------------------------------------------------------
// QR Code — error correction and interleaving
// ---------------------------------------------------------------------------

function addErrorCorrection(data: Uint8Array, vInfo: VersionInfo): Uint8Array {
  const blocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  // Group 1 blocks
  for (let i = 0; i < vInfo.group1Blocks; i++) {
    const blockData = data.slice(offset, offset + vInfo.group1DataCw);
    blocks.push(blockData);
    ecBlocks.push(rsEncode(blockData, vInfo.ecCwPerBlock));
    offset += vInfo.group1DataCw;
  }

  // Group 2 blocks
  for (let i = 0; i < vInfo.group2Blocks; i++) {
    const blockData = data.slice(offset, offset + vInfo.group2DataCw);
    blocks.push(blockData);
    ecBlocks.push(rsEncode(blockData, vInfo.ecCwPerBlock));
    offset += vInfo.group2DataCw;
  }

  // Interleave data codewords
  const result: number[] = [];
  const maxDataLen = Math.max(vInfo.group1DataCw, vInfo.group2DataCw);
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocks) {
      if (i < block.length) {
        result.push(block[i]);
      }
    }
  }

  // Interleave EC codewords
  for (let i = 0; i < vInfo.ecCwPerBlock; i++) {
    for (const ecBlock of ecBlocks) {
      if (i < ecBlock.length) {
        result.push(ecBlock[i]);
      }
    }
  }

  return new Uint8Array(result);
}

// ---------------------------------------------------------------------------
// QR Code — matrix construction
// ---------------------------------------------------------------------------

// Module values: -1 = unset, 0 = white, 1 = black
// Reservation layer: true = function pattern (don't overwrite)
type Matrix = number[][];
type Mask = boolean[][];

function createMatrix(size: number): { matrix: Matrix; reserved: Mask } {
  const matrix: Matrix = [];
  const reserved: Mask = [];
  for (let r = 0; r < size; r++) {
    matrix.push(new Array(size).fill(-1));
    reserved.push(new Array(size).fill(false));
  }
  return { matrix, reserved };
}

function placeFinderPattern(
  matrix: Matrix,
  reserved: Mask,
  row: number,
  col: number,
): void {
  // 7x7 finder pattern + 1-module white separator
  const pattern = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];

  const size = matrix.length;

  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const mr = row + r;
      const mc = col + c;
      if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
      if (r >= 0 && r < 7 && c >= 0 && c < 7) {
        matrix[mr][mc] = pattern[r][c];
      } else {
        matrix[mr][mc] = 0; // separator
      }
      reserved[mr][mc] = true;
    }
  }
}

// Alignment pattern positions per version
const ALIGNMENT_POSITIONS: number[][] = [
  [], // v1 — none
  [6, 18], // v2
  [6, 22], // v3
  [6, 26], // v4
  [6, 30], // v5
  [6, 34], // v6
  [6, 22, 38], // v7
  [6, 24, 42], // v8
  [6, 26, 46], // v9
  [6, 28, 52], // v10
];

function placeAlignmentPatterns(
  matrix: Matrix,
  reserved: Mask,
  version: number,
): void {
  if (version < 2) return;

  const positions = ALIGNMENT_POSITIONS[version - 1];
  const pattern = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ];

  for (const row of positions) {
    for (const col of positions) {
      // Skip if overlaps with finder patterns
      if (reserved[row][col]) continue;

      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const mr = row + r;
          const mc = col + c;
          matrix[mr][mc] = pattern[r + 2][c + 2];
          reserved[mr][mc] = true;
        }
      }
    }
  }
}

function placeTimingPatterns(matrix: Matrix, reserved: Mask): void {
  const size = matrix.length;
  // Horizontal timing pattern (row 6)
  for (let c = 8; c < size - 8; c++) {
    if (!reserved[6][c]) {
      matrix[6][c] = c % 2 === 0 ? 1 : 0;
      reserved[6][c] = true;
    }
  }
  // Vertical timing pattern (col 6)
  for (let r = 8; r < size - 8; r++) {
    if (!reserved[r][6]) {
      matrix[r][6] = r % 2 === 0 ? 1 : 0;
      reserved[r][6] = true;
    }
  }
}

function placeDarkModule(
  matrix: Matrix,
  reserved: Mask,
  version: number,
): void {
  // Dark module is always at (4*version + 9, 8)
  const row = 4 * version + 9;
  matrix[row][8] = 1;
  reserved[row][8] = true;
}

function reserveFormatArea(matrix: Matrix, reserved: Mask): void {
  const size = matrix.length;

  // Around top-left finder pattern
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }

  // Around top-right finder pattern
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) reserved[8][size - 1 - i] = true;
  }

  // Around bottom-left finder pattern
  for (let i = 0; i < 7; i++) {
    if (!reserved[size - 1 - i][8]) reserved[size - 1 - i][8] = true;
  }
}

// ---------------------------------------------------------------------------
// QR Code — data placement
// ---------------------------------------------------------------------------

function placeDataBits(matrix: Matrix, reserved: Mask, data: Uint8Array): void {
  const size = matrix.length;
  let bitIdx = 0;
  const totalBits = data.length * 8;

  // Traverse columns right-to-left in pairs, skipping column 6
  let col = size - 1;
  while (col >= 0) {
    // Skip vertical timing pattern column
    if (col === 6) {
      col--;
      continue;
    }

    // Direction alternates: first pair goes up, next goes down, etc.
    const goingUp = ((size - 1 - col) >> 1) % 2 === 0;

    for (let i = 0; i < size; i++) {
      const row = goingUp ? size - 1 - i : i;

      // Place in right column of pair, then left column
      for (let dx = 0; dx <= 1; dx++) {
        const c = col - dx;
        if (c < 0) continue;
        if (reserved[row][c]) continue;

        if (bitIdx < totalBits) {
          const byteIdx = bitIdx >> 3;
          const bitOffset = 7 - (bitIdx & 7);
          matrix[row][c] = (data[byteIdx] >> bitOffset) & 1;
          bitIdx++;
        } else {
          matrix[row][c] = 0;
        }
      }
    }

    col -= 2;
  }
}

// ---------------------------------------------------------------------------
// QR Code — masking
// ---------------------------------------------------------------------------

type MaskFn = (row: number, col: number) => boolean;

const MASK_FUNCTIONS: MaskFn[] = [
  (r, c) => (r + c) % 2 === 0,
  (r, _c) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(matrix: Matrix, reserved: Mask, maskIdx: number): Matrix {
  const size = matrix.length;
  const masked: Matrix = matrix.map((row) => [...row]);
  const fn = MASK_FUNCTIONS[maskIdx];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      if (fn(r, c)) {
        masked[r][c] ^= 1;
      }
    }
  }

  return masked;
}

// ---------------------------------------------------------------------------
// QR Code — format information
// ---------------------------------------------------------------------------

function computeFormatInfo(maskPattern: number): number {
  // EC level M = 00 binary
  const formatData = (0b00 << 3) | maskPattern; // 5 bits

  // BCH(15,5) encoding: generator 0x537
  let bch = formatData << 10;
  let gen = 0x537 << 4; // align generator with data
  for (let i = 4; i >= 0; i--) {
    if (bch & (1 << (i + 10))) {
      bch ^= gen;
    }
    gen >>= 1;
  }

  const formatBits = ((formatData << 10) | bch) ^ 0x5412;
  return formatBits;
}

function placeFormatInfo(matrix: Matrix, maskPattern: number): void {
  const size = matrix.length;
  const bits = computeFormatInfo(maskPattern);

  // 15 bits: bit 14 (MSB) to bit 0 (LSB)
  // Around top-left finder: row 8 (horizontal) and column 8 (vertical)

  // Horizontal strip (left part): bits 14..8 at columns 0-5,7, and bit 7 at column 8
  // Vertical strip (top part): bits 14..8 at rows 0-5,7, and bit 7 at row 8

  // Horizontal (row 8): columns 0,1,2,3,4,5 = bits 14,13,12,11,10,9
  //                      column 7 = bit 8, column 8 = bit 7
  // Vertical (col 8): rows 0,1,2,3,4,5 = bits 14,13,12,11,10,9
  //                    row 7 = bit 8, row 8 = bit 7

  const positions_h: number[] = [0, 1, 2, 3, 4, 5, 7, 8]; // columns for row 8
  const positions_v: number[] = [0, 1, 2, 3, 4, 5, 7, 8]; // rows for col 8

  // Place around top-left
  for (let i = 0; i < 8; i++) {
    const bit = (bits >> (14 - i)) & 1;
    matrix[8][positions_h[i]] = bit;
    matrix[positions_v[i]][8] = bit;
  }

  // Remaining 7 bits (bits 6..0)
  // Horizontal: row 8, columns size-8..size-1
  // Vertical: col 8, rows size-7..size-1

  for (let i = 0; i < 7; i++) {
    const bit = (bits >> (6 - i)) & 1;
    matrix[8][size - 7 + i] = bit;
    matrix[size - 7 + i][8] = bit;
  }
}

// ---------------------------------------------------------------------------
// QR Code — penalty scoring (for mask selection)
// ---------------------------------------------------------------------------

function penaltyScore(matrix: Matrix): number {
  const size = matrix.length;
  let score = 0;

  // Rule 1: Consecutive same-color modules in rows and columns
  for (let r = 0; r < size; r++) {
    let count = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) {
        count++;
      } else {
        if (count >= 5) score += count - 2;
        count = 1;
      }
    }
    if (count >= 5) score += count - 2;
  }

  for (let c = 0; c < size; c++) {
    let count = 1;
    for (let r = 1; r < size; r++) {
      if (matrix[r][c] === matrix[r - 1][c]) {
        count++;
      } else {
        if (count >= 5) score += count - 2;
        count = 1;
      }
    }
    if (count >= 5) score += count - 2;
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const val = matrix[r][c];
      if (
        val === matrix[r][c + 1] &&
        val === matrix[r + 1][c] &&
        val === matrix[r + 1][c + 1]
      ) {
        score += 3;
      }
    }
  }

  // Rule 3: Finder-like patterns (1,0,1,1,1,0,1,0,0,0,0 or reverse)
  const finderA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const finderB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let matchA = true;
      let matchB = true;
      for (let k = 0; k < 11; k++) {
        if (matrix[r][c + k] !== finderA[k]) matchA = false;
        if (matrix[r][c + k] !== finderB[k]) matchB = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
    }
  }

  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let matchA = true;
      let matchB = true;
      for (let k = 0; k < 11; k++) {
        if (matrix[r + k][c] !== finderA[k]) matchA = false;
        if (matrix[r + k][c] !== finderB[k]) matchB = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
    }
  }

  // Rule 4: Proportion of dark modules
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) darkCount++;
    }
  }
  const total = size * size;
  const pct = (darkCount / total) * 100;
  const prevMultiple = Math.floor(pct / 5) * 5;
  const nextMultiple = prevMultiple + 5;
  score +=
    Math.min(Math.abs(prevMultiple - 50) / 5, Math.abs(nextMultiple - 50) / 5) *
    10;

  return score;
}

// ---------------------------------------------------------------------------
// QR Code — main generation function
// ---------------------------------------------------------------------------

interface QRResult {
  matrix: Matrix;
  version: number;
  size: number;
  mode: QRMode;
  maskPattern: number;
}

function generateQR(text: string): QRResult {
  if (text.length === 0) {
    // Return a minimal "empty" QR for display purposes (version 1 with no data)
    // This won't be scannable but gives visual feedback
    const vInfo = VERSION_TABLE[0];
    const { matrix, reserved } = createMatrix(vInfo.size);
    placeFinderPattern(matrix, reserved, 0, 0);
    placeFinderPattern(matrix, reserved, 0, vInfo.size - 7);
    placeFinderPattern(matrix, reserved, vInfo.size - 7, 0);
    placeTimingPatterns(matrix, reserved);
    placeDarkModule(matrix, reserved, 1);
    reserveFormatArea(matrix, reserved);

    // Fill remaining with zeros
    for (let r = 0; r < vInfo.size; r++) {
      for (let c = 0; c < vInfo.size; c++) {
        if (matrix[r][c] === -1) matrix[r][c] = 0;
      }
    }
    placeFormatInfo(matrix, 0);

    return {
      matrix,
      version: 1,
      size: vInfo.size,
      mode: "byte",
      maskPattern: 0,
    };
  }

  // Detect mode and select version
  const mode = detectMode(text);
  const vInfo = selectVersion(text, mode);
  if (!vInfo) {
    throw new Error(
      `Text too long (${text.length} chars). Maximum for version 10 EC-M: ` +
        `byte=${VERSION_TABLE[9].byteCapacity}, alphanumeric=${VERSION_TABLE[9].alphanumericCapacity}, ` +
        `numeric=${VERSION_TABLE[9].numericCapacity}`,
    );
  }

  // Encode data
  const dataCodewords = encodeData(text, mode, vInfo);

  // Add error correction and interleave
  const finalData = addErrorCorrection(dataCodewords, vInfo);

  // Build matrix with function patterns
  const { matrix, reserved } = createMatrix(vInfo.size);

  // Finder patterns (3 corners)
  placeFinderPattern(matrix, reserved, 0, 0);
  placeFinderPattern(matrix, reserved, 0, vInfo.size - 7);
  placeFinderPattern(matrix, reserved, vInfo.size - 7, 0);

  // Alignment patterns
  placeAlignmentPatterns(matrix, reserved, vInfo.version);

  // Timing patterns
  placeTimingPatterns(matrix, reserved);

  // Dark module
  placeDarkModule(matrix, reserved, vInfo.version);

  // Reserve format info area
  reserveFormatArea(matrix, reserved);

  // Place data bits
  placeDataBits(matrix, reserved, finalData);

  // Try all 8 mask patterns, pick lowest penalty
  let bestMask = 0;
  let bestScore = Infinity;
  let bestMatrix: Matrix = matrix;

  for (let m = 0; m < 8; m++) {
    const masked = applyMask(matrix, reserved, m);
    placeFormatInfo(masked, m);
    const score = penaltyScore(masked);
    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
      bestMatrix = masked;
    }
  }

  return {
    matrix: bestMatrix,
    version: vInfo.version,
    size: vInfo.size,
    mode,
    maskPattern: bestMask,
  };
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 350;
const QUIET_ZONE = 4; // modules
const STATUS_BAR_HEIGHT = 40;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderQrSvg(qr: QRResult, inputText: string): string {
  const totalModules = qr.size + QUIET_ZONE * 2;
  const qrAreaSize = PANEL_WIDTH - 20; // 10px padding each side
  const moduleSize = qrAreaSize / totalModules;
  const qrOffsetX = 10;
  const qrOffsetY = 10;

  // Build module rects
  let moduleRects = "";
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.matrix[r][c] === 1) {
        const x = qrOffsetX + (c + QUIET_ZONE) * moduleSize;
        const y = qrOffsetY + (r + QUIET_ZONE) * moduleSize;
        moduleRects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(moduleSize + 0.5).toFixed(2)}" height="${(moduleSize + 0.5).toFixed(2)}" fill="${C.text}"/>`;
      }
    }
  }

  // Quiet zone background
  const qrBgX = qrOffsetX;
  const qrBgY = qrOffsetY;
  const qrBgSize = totalModules * moduleSize;

  // Status bar info
  const charCount = inputText.length;
  const modeLabel =
    qr.mode === "byte"
      ? "Byte"
      : qr.mode === "alphanumeric"
        ? "Alnum"
        : "Numeric";
  const statusLine = `${charCount} char${charCount !== 1 ? "s" : ""} | V${qr.version} | ${modeLabel} | EC-M | Mask ${qr.maskPattern}`;

  // Truncate display text for status
  const displayText =
    inputText.length > 30 ? inputText.slice(0, 27) + "..." : inputText;

  const svgHeight = qrBgSize + qrOffsetY * 2 + STATUS_BAR_HEIGHT;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_WIDTH}" height="${svgHeight}" viewBox="0 0 ${PANEL_WIDTH} ${svgHeight}">
  <defs>
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', 'Fira Code', monospace; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="${PANEL_WIDTH}" height="${svgHeight}" rx="8" fill="${C.base}"/>

  <!-- QR quiet zone -->
  <rect x="${qrBgX.toFixed(2)}" y="${qrBgY.toFixed(2)}" width="${qrBgSize.toFixed(2)}" height="${qrBgSize.toFixed(2)}" rx="4" fill="${C.surface0}"/>

  <!-- QR modules -->
  ${moduleRects}

  <!-- Status bar separator -->
  <line x1="10" y1="${(qrBgY + qrBgSize + 8).toFixed(2)}" x2="${PANEL_WIDTH - 10}" y2="${(qrBgY + qrBgSize + 8).toFixed(2)}" stroke="${C.surface1}" stroke-width="1"/>

  <!-- Status text -->
  <text x="${PANEL_WIDTH / 2}" y="${(qrBgY + qrBgSize + 22).toFixed(2)}" fill="${C.subtext0}" font-size="10" text-anchor="middle">${escapeXml(statusLine)}</text>
  <text x="${PANEL_WIDTH / 2}" y="${(qrBgY + qrBgSize + 36).toFixed(2)}" fill="${C.overlay0}" font-size="9" text-anchor="middle">${escapeXml(displayText)}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Panel rendering
// ---------------------------------------------------------------------------

let firstRender = true;
let currentText = "";

function renderPanel(): void {
  let qr: QRResult;
  try {
    qr = generateQR(currentText);
  } catch (err) {
    console.error(
      `QR generation error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const svg = renderQrSvg(qr, currentText);
  const bytes = encoder.encode(svg);

  if (firstRender) {
    writeMeta({
      id: PANEL_ID,
      type: "svg",
      position: "float",
      x: 50,
      y: 30,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      draggable: true,
      resizable: true,
      byteLength: bytes.byteLength,
    });
    firstRender = false;
  } else {
    writeMeta({
      id: PANEL_ID,
      type: "update",
      byteLength: bytes.byteLength,
    });
  }

  writeData(svg);
}

// ---------------------------------------------------------------------------
// Event loop (for panel close/resize events)
// ---------------------------------------------------------------------------

async function readEvents(): Promise<void> {
  if (EVENT_FD === null) return;

  try {
    const stream = Bun.file(EVENT_FD).stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          // Protocol errors from the terminal (data-timeout, meta-validate, etc.)
          if (event.id === "__system__" && event.event === "error") {
            const code = event.code ?? "unknown";
            const message = event.message ?? "";
            const ref = event.ref ?? "";
            console.error(
              `[demo_qrcode] protocol error ${code}: ${message}${ref ? ` (ref=${ref})` : ""}`,
            );
            continue;
          }
          if (event.id === PANEL_ID && event.event === "close") {
            // Tear the panel down immediately rather than waiting for SIGINT.
            writeMeta({ id: PANEL_ID, type: "clear" });
            console.log("Panel closed.");
            process.exit(0);
          }
        } catch {
          // invalid JSON
        }
      }
    }
  } catch {
    // fd closed
  }
}

// ---------------------------------------------------------------------------
// Input modes
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = Bun.stdin.stream().getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch {
    // stream ended
  }
  const decoder = new TextDecoder();
  return chunks
    .map((c) => decoder.decode(c, { stream: true }))
    .join("")
    .trim();
}

function isStdinPiped(): boolean {
  try {
    return !Bun.stdin.stream().locked && !process.stdin.isTTY;
  } catch {
    return false;
  }
}

async function runInteractiveMode(): Promise<void> {
  console.log("Interactive mode: type text and the QR code updates live.");
  console.log("Press Enter to confirm, Ctrl+C to exit.\n");

  let inputBuffer = "";

  // 50ms coalescing throttle: burst typing re-renders at most once every
  // ~50ms instead of once per keystroke.
  let renderScheduled = false;
  const scheduleRender = (): void => {
    if (renderScheduled) return;
    renderScheduled = true;
    setTimeout(() => {
      renderScheduled = false;
      renderPanel();
    }, 50);
  };

  // Show initial empty QR
  currentText = "";
  renderPanel();

  // Read raw stdin bytes
  process.stdin.setRawMode(true);
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const str = decoder.decode(value, { stream: true });
      for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);

        // Ctrl+C
        if (ch === 3) {
          process.stdin.setRawMode(false);
          writeMeta({ id: PANEL_ID, type: "clear" });
          console.log("\n\nQR Code generator closed.");
          process.exit(0);
          return;
        }

        // Backspace / Delete
        if (ch === 127 || ch === 8) {
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            // Clear line and rewrite
            process.stdout.write("\r\x1b[K> " + inputBuffer);
            currentText = inputBuffer;
            scheduleRender();
          }
          continue;
        }

        // Enter — just confirm (keep going)
        if (ch === 13 || ch === 10) {
          process.stdout.write("\n");
          if (inputBuffer.length > 0) {
            console.log(
              `Encoded: "${inputBuffer}" (${inputBuffer.length} chars)`,
            );
          }
          process.stdout.write("> " + inputBuffer);
          continue;
        }

        // Escape sequences (arrow keys, etc.) — ignore
        if (ch === 27) {
          // Skip the rest of the escape sequence
          i += 2; // skip [X
          continue;
        }

        // Regular character
        if (ch >= 32) {
          inputBuffer += str[i];
          process.stdout.write(str[i]);
          currentText = inputBuffer;
          scheduleRender();
        }
      }
    }
  } catch {
    // stdin closed
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

console.log("HyperTerm QR Code Generator");
console.log("---------------------------");

// Start event loop in background
readEvents();

if (args.length > 0) {
  // CLI argument mode
  const text = args.join(" ");
  console.log(`Encoding: "${text}" (${text.length} chars)`);

  currentText = text;

  try {
    renderPanel();
    const qr = generateQR(text);
    console.log(
      `Version: ${qr.version} | Mode: ${qr.mode} | EC: M | Mask: ${qr.maskPattern}`,
    );
    console.log(`Matrix: ${qr.size}x${qr.size} modules`);
    console.log("\nQR code displayed. Press Ctrl+C to exit.");
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
} else if (isStdinPiped()) {
  // Piped input mode
  console.log("Reading from stdin...");

  const text = await readStdin();
  if (text.length === 0) {
    console.error("Error: no input received from stdin.");
    process.exit(1);
  }

  console.log(
    `Encoding: "${text.length > 60 ? text.slice(0, 57) + "..." : text}" (${text.length} chars)`,
  );
  currentText = text;

  try {
    renderPanel();
    const qr = generateQR(text);
    console.log(
      `Version: ${qr.version} | Mode: ${qr.mode} | EC: M | Mask: ${qr.maskPattern}`,
    );
    console.log(`Matrix: ${qr.size}x${qr.size} modules`);
    console.log("\nQR code displayed. Press Ctrl+C to exit.");
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
} else {
  // Interactive mode
  await runInteractiveMode();
}

// Cleanup on SIGINT
process.on("SIGINT", () => {
  try {
    process.stdin.setRawMode(false);
  } catch {
    // not in raw mode
  }
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\nQR Code generator closed.");
  process.exit(0);
});
