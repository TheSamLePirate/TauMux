#!/usr/bin/env bun
/**
 * τ-mux — Color Picker
 *
 * A full HSL color picker with a sat/light gradient square, hue bar,
 * live preview, saved palette, and Catppuccin Mocha presets.
 * Renders as an interactive HTML panel via the sideband protocol.
 *
 * Usage:
 *   bun scripts/demo_colorpick.ts
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
    "This script requires τ-mux.\n" +
      "Run it inside the τ-mux terminal emulator.",
  );
  process.exit(0);
}

const PANEL_ID = "colorpick";

// ---------------------------------------------------------------------------
// Low-level fd helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

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
} as const;

// ---------------------------------------------------------------------------
// Catppuccin preset row
// ---------------------------------------------------------------------------

const CATPPUCCIN_PRESETS = [
  { name: "Red", hex: "#f38ba8" },
  { name: "Green", hex: "#a6e3a1" },
  { name: "Blue", hex: "#89b4fa" },
  { name: "Yellow", hex: "#f9e2af" },
  { name: "Pink", hex: "#f5c2e7" },
  { name: "Teal", hex: "#94e2d5" },
  { name: "Peach", hex: "#fab387" },
  { name: "Mauve", hex: "#cba6f7" },
  { name: "Text", hex: "#cdd6f4" },
  { name: "Surface", hex: "#313244" },
  { name: "Overlay", hex: "#45475a" },
  { name: "Base", hex: "#1e1e2e" },
];

// ---------------------------------------------------------------------------
// Layout constants (px) — used for hit-testing
// ---------------------------------------------------------------------------

const PANEL_W = 320;
const PANEL_H = 420;

const TITLE_H = 32;
const PAD = 16; // horizontal padding

const SQUARE_SIZE = 200;
const SQUARE_X = (PANEL_W - SQUARE_SIZE) / 2; // centered
const SQUARE_Y = TITLE_H + 12;

const HUE_BAR_H = 20;
const HUE_BAR_X = PAD;
const HUE_BAR_W = PANEL_W - PAD * 2;
const HUE_BAR_Y = SQUARE_Y + SQUARE_SIZE + 12;

const PREVIEW_SIZE = 50;
const PREVIEW_X = PAD;
const PREVIEW_Y = HUE_BAR_Y + HUE_BAR_H + 14;

const VALUES_X = PREVIEW_X + PREVIEW_SIZE + 12;
const VALUES_Y = PREVIEW_Y;

const PALETTE_Y = PREVIEW_Y + PREVIEW_SIZE + 14;
const SWATCH_SIZE = 20;
const SWATCH_GAP = 4;
const PALETTE_X = PAD;

const CATPPUCCIN_Y = PALETTE_Y + SWATCH_SIZE + SWATCH_GAP + 2;

// ---------------------------------------------------------------------------
// Color conversion helpers
// ---------------------------------------------------------------------------

function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;

  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) * 60;
  } else {
    h = ((rn - gn) / d + 4) * 60;
  }

  return {
    h: Math.round(h) % 360,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let h = 217; // hue 0-360
let s = 92; // saturation 0-100
let l = 76; // lightness 0-100

const savedColors: string[] = [];
const MAX_SAVED = 12;

let dragging: "square" | "hue" | null = null;

// Panel position (x is right-aligned to the terminal viewport on resize).
let panelX = 50;
const PANEL_Y = 30;
const PANEL_RIGHT_MARGIN = 50;

// Throttle
let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 16;
let renderQueued = false;

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

function currentRgb(): { r: number; g: number; b: number } {
  return hslToRgb(h, s, l);
}

function currentHex(): string {
  const { r, g, b } = currentRgb();
  return rgbToHex(r, g, b);
}

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

type HitArea =
  | { area: "square"; normX: number; normY: number }
  | { area: "hue"; normX: number }
  | { area: "preview" }
  | { area: "hex" }
  | { area: "saved"; index: number }
  | { area: "catppuccin"; index: number }
  | { area: "none" };

function hitTest(x: number, y: number): HitArea {
  // Sat/Light square
  if (
    x >= SQUARE_X &&
    x < SQUARE_X + SQUARE_SIZE &&
    y >= SQUARE_Y &&
    y < SQUARE_Y + SQUARE_SIZE
  ) {
    const normX = Math.max(0, Math.min(1, (x - SQUARE_X) / SQUARE_SIZE));
    const normY = Math.max(0, Math.min(1, (y - SQUARE_Y) / SQUARE_SIZE));
    return { area: "square", normX, normY };
  }

  // Hue bar
  if (
    x >= HUE_BAR_X &&
    x < HUE_BAR_X + HUE_BAR_W &&
    y >= HUE_BAR_Y &&
    y < HUE_BAR_Y + HUE_BAR_H
  ) {
    const normX = Math.max(0, Math.min(1, (x - HUE_BAR_X) / HUE_BAR_W));
    return { area: "hue", normX };
  }

  // Preview swatch (click to save)
  if (
    x >= PREVIEW_X &&
    x < PREVIEW_X + PREVIEW_SIZE &&
    y >= PREVIEW_Y &&
    y < PREVIEW_Y + PREVIEW_SIZE
  ) {
    return { area: "preview" };
  }

  // HEX value text (click to print to stdout)
  if (
    x >= VALUES_X &&
    x < PANEL_W - PAD &&
    y >= VALUES_Y &&
    y < VALUES_Y + 16
  ) {
    return { area: "hex" };
  }

  // Saved palette slots
  for (let i = 0; i < MAX_SAVED; i++) {
    const sx = PALETTE_X + i * (SWATCH_SIZE + SWATCH_GAP);
    const sy = PALETTE_Y;
    if (x >= sx && x < sx + SWATCH_SIZE && y >= sy && y < sy + SWATCH_SIZE) {
      return { area: "saved", index: i };
    }
  }

  // Catppuccin preset row
  for (let i = 0; i < CATPPUCCIN_PRESETS.length; i++) {
    const sx = PALETTE_X + i * (SWATCH_SIZE + SWATCH_GAP);
    const sy = CATPPUCCIN_Y;
    if (x >= sx && x < sx + SWATCH_SIZE && y >= sy && y < sy + SWATCH_SIZE) {
      return { area: "catppuccin", index: i };
    }
  }

  return { area: "none" };
}

// ---------------------------------------------------------------------------
// SVG rendering — sat/light square
// ---------------------------------------------------------------------------

function renderSquareSvg(): string {
  // Render as a 20x20 grid of rects with computed HSL colors.
  // X axis = saturation 0..100, Y axis = lightness 100..0.
  const gridCols = 20;
  const gridRows = 20;
  const cellW = SQUARE_SIZE / gridCols;
  const cellH = SQUARE_SIZE / gridRows;

  const rects: string[] = [];
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const satVal = Math.round((col / (gridCols - 1)) * 100);
      const lightVal = Math.round((1 - row / (gridRows - 1)) * 100);
      const { r, g, b } = hslToRgb(h, satVal, lightVal);
      const hex = rgbToHex(r, g, b);
      rects.push(
        `<rect x="${col * cellW}" y="${row * cellH}" width="${cellW + 0.5}" height="${cellH + 0.5}" fill="${hex}"/>`,
      );
    }
  }

  // Crosshair indicator at current s/l position
  const cx = (s / 100) * SQUARE_SIZE;
  const cy = (1 - l / 100) * SQUARE_SIZE;

  const crosshair = [
    `<circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="#ffffff" stroke-width="2"/>`,
    `<circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="#000000" stroke-width="1"/>`,
    `<circle cx="${cx}" cy="${cy}" r="4" fill="${currentHex()}"/>`,
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SQUARE_SIZE}" height="${SQUARE_SIZE}" viewBox="0 0 ${SQUARE_SIZE} ${SQUARE_SIZE}" style="display:block;border-radius:4px;">
    ${rects.join("\n    ")}
    ${crosshair}
  </svg>`;
}

// ---------------------------------------------------------------------------
// SVG rendering — hue bar
// ---------------------------------------------------------------------------

function renderHueBarSvg(): string {
  // Thin vertical rects spanning the hue range 0..360
  const slices = 36;
  const sliceW = HUE_BAR_W / slices;

  const rects: string[] = [];
  for (let i = 0; i < slices; i++) {
    const hueVal = Math.round((i / (slices - 1)) * 360);
    const { r, g, b } = hslToRgb(hueVal, 100, 50);
    const hex = rgbToHex(r, g, b);
    rects.push(
      `<rect x="${i * sliceW}" y="0" width="${sliceW + 0.5}" height="${HUE_BAR_H}" fill="${hex}"/>`,
    );
  }

  // Vertical marker at current hue
  const mx = (h / 360) * HUE_BAR_W;
  const marker = [
    `<rect x="${mx - 3}" y="0" width="6" height="${HUE_BAR_H}" fill="none" stroke="#ffffff" stroke-width="2" rx="2"/>`,
    `<rect x="${mx - 4}" y="-1" width="8" height="${HUE_BAR_H + 2}" fill="none" stroke="#000000" stroke-width="1" rx="3"/>`,
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HUE_BAR_W}" height="${HUE_BAR_H}" viewBox="0 0 ${HUE_BAR_W} ${HUE_BAR_H}" style="display:block;border-radius:3px;">
    ${rects.join("\n    ")}
    ${marker}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Full HTML rendering
// ---------------------------------------------------------------------------

function renderHtml(): string {
  const { r, g, b } = currentRgb();
  const hex = currentHex();

  const squareSvg = renderSquareSvg();
  const hueBarSvg = renderHueBarSvg();

  // Preview swatch
  const previewSwatch = `<div style="width:${PREVIEW_SIZE}px;height:${PREVIEW_SIZE}px;background:${hex};border-radius:6px;border:2px solid ${C.surface1};cursor:pointer;flex-shrink:0;"></div>`;

  // Color values
  const valuesHtml = `<div style="display:flex;flex-direction:column;gap:3px;font-size:12px;font-family:'SF Mono',Monaco,Consolas,monospace;">
    <div style="color:${C.text};cursor:pointer;font-weight:600;" title="Click to print to terminal">${hex}</div>
    <div style="color:${C.subtext0};">rgb(${r},${g},${b})</div>
    <div style="color:${C.subtext0};">hsl(${h},${s}%,${l}%)</div>
  </div>`;

  // Saved colors row
  const savedSwatches: string[] = [];
  for (let i = 0; i < MAX_SAVED; i++) {
    const color = savedColors[i];
    if (color) {
      savedSwatches.push(
        `<div style="width:${SWATCH_SIZE}px;height:${SWATCH_SIZE}px;background:${color};border-radius:3px;cursor:pointer;border:1px solid ${C.surface1};flex-shrink:0;" title="${color}"></div>`,
      );
    } else {
      savedSwatches.push(
        `<div style="width:${SWATCH_SIZE}px;height:${SWATCH_SIZE}px;background:${C.surface0};border-radius:3px;border:1px dashed ${C.overlay0};flex-shrink:0;"></div>`,
      );
    }
  }

  // Catppuccin preset row
  const catppuccinSwatches = CATPPUCCIN_PRESETS.map(
    (preset) =>
      `<div style="width:${SWATCH_SIZE}px;height:${SWATCH_SIZE}px;background:${preset.hex};border-radius:3px;cursor:pointer;border:1px solid ${C.surface1};flex-shrink:0;" title="${preset.name}: ${preset.hex}"></div>`,
  ).join("");

  return `<div style="width:${PANEL_W}px;height:${PANEL_H}px;background:${C.base};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;display:flex;flex-direction:column;user-select:none;">
  <!-- Title bar -->
  <div style="height:${TITLE_H}px;background:${C.surface0};display:flex;align-items:center;padding:0 12px;flex-shrink:0;border-bottom:1px solid ${C.surface1};">
    <span style="font-size:13px;font-weight:600;color:${C.text};">Color Picker</span>
    <div style="flex:1;"></div>
    <div style="width:16px;height:16px;background:${hex};border-radius:50%;border:1px solid ${C.surface1};"></div>
  </div>

  <!-- Content -->
  <div style="flex:1;padding:0;overflow:hidden;">
    <!-- Sat/Light square -->
    <div style="margin:12px auto 0;width:${SQUARE_SIZE}px;">
      ${squareSvg}
    </div>

    <!-- Hue bar -->
    <div style="margin:12px ${PAD}px 0;">
      ${hueBarSvg}
    </div>

    <!-- Preview + values -->
    <div style="display:flex;align-items:center;gap:12px;margin:14px ${PAD}px 0;">
      ${previewSwatch}
      ${valuesHtml}
    </div>

    <!-- Saved colors -->
    <div style="display:flex;gap:${SWATCH_GAP}px;margin:14px ${PAD}px 0;">
      ${savedSwatches.join("")}
    </div>

    <!-- Catppuccin presets -->
    <div style="display:flex;gap:${SWATCH_GAP}px;margin:${SWATCH_GAP + 2}px ${PAD}px 0;">
      ${catppuccinSwatches}
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Rendering / update
// ---------------------------------------------------------------------------

let firstRender = true;

function render(force = false): void {
  const now = Date.now();
  if (!force && now - lastRenderTime < MIN_RENDER_INTERVAL) {
    if (!renderQueued) {
      renderQueued = true;
      setTimeout(
        () => {
          renderQueued = false;
          render(true);
        },
        MIN_RENDER_INTERVAL - (now - lastRenderTime),
      );
    }
    return;
  }

  lastRenderTime = now;
  const html = renderHtml();
  const bytes = encoder.encode(html);

  if (firstRender) {
    writeMeta({
      id: PANEL_ID,
      type: "html",
      position: "float",
      x: panelX,
      y: PANEL_Y,
      width: PANEL_W,
      height: PANEL_H,
      interactive: true,
      draggable: true,
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

  writeData(html);
}

// ---------------------------------------------------------------------------
// Apply color from hex
// ---------------------------------------------------------------------------

function loadColor(hex: string): void {
  const hsl = hexToHsl(hex);
  h = hsl.h;
  s = hsl.s;
  l = hsl.l;
  render(true);
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  // Protocol errors from the terminal (data-timeout, meta-validate, etc.)
  if (evtId === "__system__" && evtType === "error") {
    const code = (event["code"] as string) ?? "unknown";
    const message = (event["message"] as string) ?? "";
    const ref = (event["ref"] as string) ?? "";
    console.error(
      `[demo_colorpick] protocol error ${code}: ${message}${ref ? ` (ref=${ref})` : ""}`,
    );
    return;
  }

  // Terminal resize → keep the picker right-aligned in the viewport.
  if (evtId === "__terminal__" && evtType === "resize") {
    const cols = (event["cols"] as number) ?? 0;
    const pxWidth = (event["pxWidth"] as number) ?? 0;
    // Prefer pxWidth when provided; fall back to a char-cell estimate.
    const viewportW = pxWidth > 0 ? pxWidth : Math.round(cols * 8);
    if (viewportW > 0) {
      const newX = Math.max(10, viewportW - PANEL_W - PANEL_RIGHT_MARGIN);
      if (newX !== panelX) {
        panelX = newX;
        writeMeta({ id: PANEL_ID, type: "update", x: panelX });
      }
    }
    return;
  }

  if (evtId !== PANEL_ID) return;

  const ex = (event["x"] as number) ?? 0;
  const ey = (event["y"] as number) ?? 0;
  const buttons = (event["buttons"] as number) ?? 0;

  switch (evtType) {
    case "close": {
      console.log("Color picker closed.");
      process.exit(0);
      break;
    }

    case "mousedown": {
      const hit = hitTest(ex, ey);

      if (hit.area === "square") {
        dragging = "square";
        s = Math.round(hit.normX * 100);
        l = Math.round((1 - hit.normY) * 100);
        render(true);
        return;
      }

      if (hit.area === "hue") {
        dragging = "hue";
        h = Math.round(hit.normX * 360);
        render(true);
        return;
      }

      if (hit.area === "preview") {
        // Save current color to the next slot
        const hex = currentHex();
        if (savedColors.length < MAX_SAVED) {
          savedColors.push(hex);
        } else {
          // Rotate: remove oldest, add new
          savedColors.shift();
          savedColors.push(hex);
        }
        console.log(`Saved: ${hex}`);
        render(true);
        return;
      }

      if (hit.area === "hex") {
        const hex = currentHex();
        console.log(hex);
        return;
      }

      if (hit.area === "saved") {
        if (hit.index < savedColors.length) {
          loadColor(savedColors[hit.index]);
        }
        return;
      }

      if (hit.area === "catppuccin") {
        loadColor(CATPPUCCIN_PRESETS[hit.index].hex);
        return;
      }
      break;
    }

    case "mousemove": {
      if (dragging === null) return;
      if (buttons !== 1) {
        // Button released outside — stop dragging
        dragging = null;
        return;
      }

      if (dragging === "square") {
        const hit = hitTest(
          Math.max(SQUARE_X, Math.min(SQUARE_X + SQUARE_SIZE - 1, ex)),
          Math.max(SQUARE_Y, Math.min(SQUARE_Y + SQUARE_SIZE - 1, ey)),
        );
        if (hit.area === "square") {
          s = Math.round(hit.normX * 100);
          l = Math.round((1 - hit.normY) * 100);
          render();
        }
        return;
      }

      if (dragging === "hue") {
        const clampedX = Math.max(
          HUE_BAR_X,
          Math.min(HUE_BAR_X + HUE_BAR_W - 1, ex),
        );
        const normX = (clampedX - HUE_BAR_X) / HUE_BAR_W;
        h = Math.round(normX * 360);
        render();
        return;
      }
      break;
    }

    case "mouseup": {
      if (dragging !== null) {
        dragging = null;
        render(true);
      }
      break;
    }

    case "mouseleave": {
      if (dragging !== null) {
        dragging = null;
        render(true);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Event loop
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
          handleEvent(JSON.parse(line));
        } catch {
          // invalid JSON — skip
        }
      }
    }
  } catch {
    // fd closed or unavailable
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log("τ-mux Color Picker started.");
console.log("Click the gradient square to pick saturation/lightness.");
console.log("Click the hue bar to change hue.");
console.log("Click the preview swatch to save the current color.");
console.log("Click a HEX value to print it to the terminal.");
console.log("Press Ctrl+C to exit.\n");

// Initial render
render(true);

// Start event loop
readEvents();

// Cleanup on exit
process.on("SIGINT", () => {
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\nColor picker closed.");
  process.exit(0);
});
