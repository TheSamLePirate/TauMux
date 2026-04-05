#!/usr/bin/env bun
/**
 * HyperTerm Canvas — Image Gallery
 *
 * Browse images in a directory with a navigation bar and full-size preview.
 * Supports PNG, JPEG, WebP, and GIF files.
 *
 * Usage:
 *   bun scripts/demo_gallery.ts [directory]   — defaults to current directory
 */

import { readdirSync, statSync } from "fs";
import { resolve, basename, extname } from "path";

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

function writeDataStr(str: string): void {
  try {
    Bun.write(Bun.file(DATA_FD!), encoder.encode(str));
  } catch {
    /* fd write failed */
  }
}

function writeDataBin(data: Uint8Array): void {
  try {
    Bun.write(Bun.file(DATA_FD!), data);
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
  yellow: "#f9e2af",
  red: "#f38ba8",
  mauve: "#cba6f7",
  teal: "#94e2d5",
} as const;

// ---------------------------------------------------------------------------
// Image format helpers
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const FORMAT_MAP: Record<string, string> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".webp": "webp",
  ".gif": "gif",
};

function detectFormat(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return FORMAT_MAP[ext] ?? "png";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + " KB";
  return bytes + " B";
}

// ---------------------------------------------------------------------------
// Scan directory for images
// ---------------------------------------------------------------------------

const targetDir = resolve(process.argv[2] ?? ".");

let files: string[] = [];

try {
  const entries = readdirSync(targetDir);
  files = entries
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((name) => resolve(targetDir, name));
} catch {
  console.error(`Failed to read directory: ${targetDir}`);
  process.exit(1);
}

if (files.length === 0) {
  console.log(`No image files found in ${targetDir}`);
  console.log("Supported formats: PNG, JPEG, WebP, GIF");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Panel IDs and layout
// ---------------------------------------------------------------------------

const NAV_ID = "gallery-nav";
const IMG_ID = "gallery-img";

let panelW = 700;
let panelH = 500;
const NAV_H = 50;
const NAV_X = 50;
const NAV_Y = 30;
const IMG_X = 50;
const IMG_Y = NAV_Y + NAV_H + 4;

// ---------------------------------------------------------------------------
// Hit-testing regions for the nav bar
// ---------------------------------------------------------------------------

// Button regions (x ranges within the nav panel)
const PREV_BTN = { x1: 10, x2: 80, y1: 8, y2: 42 };
const NEXT_BTN = { x1: 350, x2: 420, y1: 8, y2: 42 };
const GRID_BTN = { x1: 600, x2: 660, y1: 8, y2: 42 };

type NavHit = "prev" | "next" | "grid" | "none";

function navHitTest(x: number, y: number): NavHit {
  if (
    x >= PREV_BTN.x1 &&
    x <= PREV_BTN.x2 &&
    y >= PREV_BTN.y1 &&
    y <= PREV_BTN.y2
  )
    return "prev";
  if (
    x >= NEXT_BTN.x1 &&
    x <= NEXT_BTN.x2 &&
    y >= NEXT_BTN.y1 &&
    y <= NEXT_BTN.y2
  )
    return "next";
  if (
    x >= GRID_BTN.x1 &&
    x <= GRID_BTN.x2 &&
    y >= GRID_BTN.y1 &&
    y <= GRID_BTN.y2
  )
    return "grid";
  return "none";
}

// ---------------------------------------------------------------------------
// Grid mode hit-testing
// ---------------------------------------------------------------------------

const GRID_COLS = 3;
const GRID_ITEM_H = 32;
const GRID_PAD = 12;
const GRID_TOP = 10;

function gridHitTest(x: number, y: number): number {
  // Returns file index or -1
  if (x < GRID_PAD || x > panelW - GRID_PAD) return -1;
  if (y < GRID_TOP) return -1;

  const colW = (panelW - GRID_PAD * 2) / GRID_COLS;
  const col = Math.floor((x - GRID_PAD) / colW);
  const row = Math.floor((y - GRID_TOP) / GRID_ITEM_H);

  if (col < 0 || col >= GRID_COLS) return -1;

  const idx = row * GRID_COLS + col;
  if (idx < 0 || idx >= files.length) return -1;
  return idx;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentIndex = 0;
let gridMode = false;

// ---------------------------------------------------------------------------
// Escape HTML
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Render navigation bar (HTML panel)
// ---------------------------------------------------------------------------

let navFirstRender = true;

function renderNav(): void {
  const file = files[currentIndex];
  const name = basename(file);
  const idx = currentIndex + 1;
  const total = files.length;

  let fileInfo = `${escapeHtml(name)} (${idx}/${total})`;

  // Try to get file size
  try {
    const stat = statSync(file);
    fileInfo += ` - ${formatBytes(stat.size)}`;
  } catch {
    /* stat failed */
  }

  const modeLabel = gridMode ? "View" : "Grid";
  const modeIcon = gridMode ? "\u{1F5BC}" : "\u{25A3}";

  const html = `<div style="
    width:${panelW}px;height:${NAV_H}px;background:${C.base};
    font-family:-apple-system,BlinkMacSystemFont,'SF Mono',Monaco,Consolas,monospace;
    display:flex;align-items:center;padding:0 10px;gap:8px;
    border:1px solid ${C.surface1};border-radius:6px;user-select:none;
    box-sizing:border-box;overflow:hidden;
  ">
    <div style="
      padding:6px 14px;background:${C.surface0};color:${C.blue};
      border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;
      white-space:nowrap;
    ">\u25C0 Prev</div>

    <div style="
      flex:1;text-align:center;color:${C.text};font-size:12px;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      padding:0 8px;
    ">${fileInfo}</div>

    <div style="
      padding:6px 14px;background:${C.surface0};color:${C.blue};
      border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;
      white-space:nowrap;
    ">Next \u25B6</div>

    <div style="
      padding:6px 12px;background:${C.surface0};color:${C.mauve};
      border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;
      white-space:nowrap;margin-left:4px;
    ">${modeIcon} ${modeLabel}</div>
  </div>`;

  const bytes = encoder.encode(html);

  if (navFirstRender) {
    writeMeta({
      id: NAV_ID,
      type: "html",
      position: "float",
      x: NAV_X,
      y: NAV_Y,
      width: panelW,
      height: NAV_H,
      interactive: true,
      draggable: true,
      resizable: false,
      byteLength: bytes.byteLength,
    });
    navFirstRender = false;
  } else {
    writeMeta({
      id: NAV_ID,
      type: "update",
      byteLength: bytes.byteLength,
    });
  }

  writeDataStr(html);
}

// ---------------------------------------------------------------------------
// Render image viewer (image panel)
// ---------------------------------------------------------------------------

let imgFirstRender = true;

async function renderImage(): Promise<void> {
  const file = files[currentIndex];
  const format = detectFormat(file);

  try {
    const data = new Uint8Array(await Bun.file(file).arrayBuffer());

    if (imgFirstRender) {
      writeMeta({
        id: IMG_ID,
        type: "image",
        format,
        position: "float",
        x: IMG_X,
        y: IMG_Y,
        width: panelW,
        height: panelH,
        interactive: true,
        draggable: true,
        resizable: true,
        byteLength: data.byteLength,
      });
      imgFirstRender = false;
    } else {
      writeMeta({
        id: IMG_ID,
        type: "update",
        byteLength: data.byteLength,
      });
    }

    writeDataBin(data);
  } catch {
    console.error(`Failed to load image: ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Render grid view (HTML panel replacing the image panel)
// ---------------------------------------------------------------------------

let gridFirstRender = true;

function renderGrid(): void {
  const rows = Math.ceil(files.length / GRID_COLS);
  const colW = Math.floor((panelW - GRID_PAD * 2) / GRID_COLS);
  const gridH = Math.max(panelH, GRID_TOP + rows * GRID_ITEM_H + GRID_PAD);

  const items: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const name = basename(files[i]);
    const ext = extname(name).toLowerCase();
    const isCurrentStr =
      i === currentIndex
        ? `border-left:3px solid ${C.blue};padding-left:8px;`
        : "padding-left:11px;";
    const textColor = i === currentIndex ? C.blue : C.text;

    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = GRID_PAD + col * colW;
    const y = GRID_TOP + row * GRID_ITEM_H;

    items.push(`<div style="
      position:absolute;left:${x}px;top:${y}px;width:${colW - 4}px;height:${GRID_ITEM_H - 4}px;
      display:flex;align-items:center;cursor:pointer;
      border-radius:4px;${isCurrentStr}
      font-size:11px;color:${textColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    ">
      <span style="color:${C.overlay0};font-size:9px;margin-right:6px;">${ext}</span>
      ${escapeHtml(name)}
    </div>`);
  }

  const html = `<div style="
    width:${panelW}px;height:${gridH}px;background:${C.base};
    font-family:-apple-system,BlinkMacSystemFont,'SF Mono',Monaco,Consolas,monospace;
    position:relative;overflow:hidden;
    border:1px solid ${C.surface1};border-radius:6px;
    box-sizing:border-box;
  ">${items.join("")}</div>`;

  const bytes = encoder.encode(html);

  if (gridFirstRender) {
    writeMeta({
      id: IMG_ID,
      type: "html",
      position: "float",
      x: IMG_X,
      y: IMG_Y,
      width: panelW,
      height: gridH,
      interactive: true,
      draggable: true,
      resizable: true,
      byteLength: bytes.byteLength,
    });
    gridFirstRender = false;
  } else {
    writeMeta({
      id: IMG_ID,
      type: "update",
      byteLength: bytes.byteLength,
    });
  }

  writeDataStr(html);
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

function navigateTo(index: number): void {
  if (files.length === 0) return;
  currentIndex = ((index % files.length) + files.length) % files.length;
  printCurrentInfo();
  renderNav();
  if (gridMode) {
    renderGrid();
  } else {
    renderImage();
  }
}

function navigatePrev(): void {
  navigateTo(currentIndex - 1);
}

function navigateNext(): void {
  navigateTo(currentIndex + 1);
}

function toggleGrid(): void {
  gridMode = !gridMode;

  if (gridMode) {
    // Clear the image panel and create a fresh HTML grid panel
    writeMeta({ id: IMG_ID, type: "clear" });
    imgFirstRender = true;
    gridFirstRender = true;
    renderGrid();
  } else {
    // Clear the grid panel and create a fresh image panel
    writeMeta({ id: IMG_ID, type: "clear" });
    imgFirstRender = true;
    gridFirstRender = true;
    renderImage();
  }

  renderNav();
}

function printCurrentInfo(): void {
  const file = files[currentIndex];
  const name = basename(file);
  try {
    const stat = statSync(file);
    console.log(
      `[${currentIndex + 1}/${files.length}] ${name} (${formatBytes(stat.size)})`,
    );
  } catch {
    console.log(`[${currentIndex + 1}/${files.length}] ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Event handling (fd5)
// ---------------------------------------------------------------------------

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  // Handle close on either panel
  if (evtType === "close" && (evtId === NAV_ID || evtId === IMG_ID)) {
    cleanup();
    process.exit(0);
  }

  // Nav bar clicks
  if (evtId === NAV_ID && evtType === "click") {
    const ex = (event["x"] as number) ?? 0;
    const ey = (event["y"] as number) ?? 0;
    const hit = navHitTest(ex, ey);

    switch (hit) {
      case "prev":
        navigatePrev();
        return;
      case "next":
        navigateNext();
        return;
      case "grid":
        toggleGrid();
        return;
    }
  }

  // Wheel scroll on image panel to navigate
  if (evtId === IMG_ID && evtType === "wheel") {
    const deltaY = (event["deltaY"] as number) ?? 0;
    if (deltaY > 0) {
      navigateNext();
    } else if (deltaY < 0) {
      navigatePrev();
    }
    return;
  }

  // Click on grid items
  if (evtId === IMG_ID && evtType === "click" && gridMode) {
    const ex = (event["x"] as number) ?? 0;
    const ey = (event["y"] as number) ?? 0;
    const idx = gridHitTest(ex, ey);
    if (idx >= 0 && idx < files.length) {
      currentIndex = idx;
      gridMode = false;
      // Switch back to image view
      writeMeta({ id: IMG_ID, type: "clear" });
      imgFirstRender = true;
      gridFirstRender = true;
      renderNav();
      renderImage();
      printCurrentInfo();
    }
    return;
  }

  // Handle resize events on the image panel
  if (evtId === IMG_ID && evtType === "resize") {
    const newW = event["width"] as number | undefined;
    const newH = event["height"] as number | undefined;
    if (newW) panelW = newW;
    if (newH) panelH = newH;
    return;
  }
}

// ---------------------------------------------------------------------------
// Event loop (fd5)
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
// Keyboard input (stdin raw mode for arrow keys)
// ---------------------------------------------------------------------------

async function readStdin(): Promise<void> {
  try {
    // Enable raw mode so we get individual keystrokes
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    const reader = Bun.stdin.stream().getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      for (let i = 0; i < value.length; i++) {
        const byte = value[i];

        // Ctrl+C
        if (byte === 0x03) {
          cleanup();
          process.exit(0);
        }

        // ESC sequence: arrow keys are ESC [ A/B/C/D
        if (byte === 0x1b && i + 2 < value.length && value[i + 1] === 0x5b) {
          const arrow = value[i + 2];
          i += 2; // skip the [ and direction byte

          switch (arrow) {
            case 0x44: // Left arrow
              navigatePrev();
              break;
            case 0x43: // Right arrow
              navigateNext();
              break;
            case 0x41: // Up arrow — toggle grid
              toggleGrid();
              break;
            case 0x42: // Down arrow — toggle grid
              toggleGrid();
              break;
          }
        }

        // 'q' to quit
        if (byte === 0x71) {
          cleanup();
          process.exit(0);
        }

        // 'g' to toggle grid
        if (byte === 0x67) {
          toggleGrid();
        }
      }
    }
  } catch {
    // stdin closed
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  writeMeta({ id: NAV_ID, type: "clear" });
  writeMeta({ id: IMG_ID, type: "clear" });
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* already restored */
    }
  }
  console.log("\nGallery closed.");
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log(`HyperTerm Image Gallery`);
console.log(`Directory: ${targetDir}`);
console.log(`Found ${files.length} image(s):\n`);

for (let i = 0; i < files.length; i++) {
  const name = basename(files[i]);
  try {
    const stat = statSync(files[i]);
    console.log(
      `  ${(i + 1).toString().padStart(3)}. ${name} (${formatBytes(stat.size)})`,
    );
  } catch {
    console.log(`  ${(i + 1).toString().padStart(3)}. ${name}`);
  }
}

console.log(`\nControls:`);
console.log(`  Left/Right arrows — navigate`);
console.log(`  Up/Down arrows    — toggle grid`);
console.log(`  g                 — toggle grid`);
console.log(`  q or Ctrl+C       — quit\n`);

// Initial render: nav bar + first image
renderNav();
await renderImage();
printCurrentInfo();

// Start event loop and keyboard input
readEvents();
readStdin();

// Cleanup on SIGINT
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
