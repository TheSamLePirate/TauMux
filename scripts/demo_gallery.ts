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
import { HyperTerm } from "./hyperterm";

// ---------------------------------------------------------------------------
// HyperTerm client setup
// ---------------------------------------------------------------------------

const ht = new HyperTerm();

if (!ht.available) {
  console.log(
    "This script requires HyperTerm Canvas.\n" +
      "Run it inside the HyperTerm terminal emulator.",
  );
  process.exit(0);
}

ht.onError((code, message, ref) => {
  console.error(
    `[hyperterm error] ${code}: ${message}${ref ? ` (ref=${ref})` : ""}`,
  );
});

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

let NAV_ID = "";
let IMG_ID = "";

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
let shuttingDown = false;

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

function buildNavHtml(): string {
  const file = files[currentIndex];
  const name = basename(file);
  const idx = currentIndex + 1;
  const total = files.length;

  let fileInfo = `${escapeHtml(name)} (${idx}/${total})`;

  try {
    const stat = statSync(file);
    fileInfo += ` - ${formatBytes(stat.size)}`;
  } catch {
    /* stat failed */
  }

  const modeLabel = gridMode ? "View" : "Grid";
  const modeIcon = gridMode ? "\u{1F5BC}" : "\u{25A3}";

  return `<div style="
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
}

function renderNav(): void {
  const html = buildNavHtml();
  if (NAV_ID === "") {
    NAV_ID = ht.showHtml(html, {
      position: "float",
      x: NAV_X,
      y: NAV_Y,
      width: panelW,
      height: NAV_H,
      interactive: true,
      draggable: true,
      resizable: false,
    });
  } else {
    ht.update(NAV_ID, { data: html });
  }
}

// ---------------------------------------------------------------------------
// Render image viewer (image panel)
// ---------------------------------------------------------------------------

type ImgKind = "image" | "html" | null;
let imgKind: ImgKind = null;

async function renderImage(): Promise<void> {
  const file = files[currentIndex];

  try {
    if (IMG_ID === "" || imgKind !== "image") {
      if (IMG_ID !== "" && imgKind === "html") {
        ht.clear(IMG_ID);
        IMG_ID = "";
      }
      IMG_ID = await ht.showImage(file, {
        position: "float",
        x: IMG_X,
        y: IMG_Y,
        width: panelW,
        height: panelH,
        interactive: true,
        draggable: true,
        resizable: true,
        timeout: 15000,
      });
      imgKind = "image";
    } else {
      const data = new Uint8Array(await Bun.file(file).arrayBuffer());
      ht.update(IMG_ID, { data });
    }
  } catch {
    console.error(`Failed to load image: ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Render grid view (HTML panel replacing the image panel)
// ---------------------------------------------------------------------------

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

  if (IMG_ID === "" || imgKind !== "html") {
    if (IMG_ID !== "" && imgKind === "image") {
      ht.clear(IMG_ID);
      IMG_ID = "";
    }
    IMG_ID = ht.showHtml(html, {
      position: "float",
      x: IMG_X,
      y: IMG_Y,
      width: panelW,
      height: gridH,
      interactive: true,
      draggable: true,
      resizable: true,
    });
    imgKind = "html";
  } else {
    ht.update(IMG_ID, { data: html, height: gridH });
  }
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
    renderGrid();
  } else {
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
// Event handling (fd5 via HyperTerm dispatcher)
// ---------------------------------------------------------------------------

ht.onEvent((event) => {
  if (shuttingDown) return;
  const evtId = event.id;
  const evtType = event.event;

  if (evtType === "close" && (evtId === NAV_ID || evtId === IMG_ID)) {
    cleanup();
    process.exit(0);
  }

  if (evtId === NAV_ID && evtType === "click") {
    const ex = event.x ?? 0;
    const ey = event.y ?? 0;
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

  if (evtId === IMG_ID && evtType === "wheel") {
    const deltaY = event.deltaY ?? 0;
    if (deltaY > 0) {
      navigateNext();
    } else if (deltaY < 0) {
      navigatePrev();
    }
    return;
  }

  if (evtId === IMG_ID && evtType === "click" && gridMode) {
    const ex = event.x ?? 0;
    const ey = event.y ?? 0;
    const idx = gridHitTest(ex, ey);
    if (idx >= 0 && idx < files.length) {
      currentIndex = idx;
      gridMode = false;
      renderNav();
      renderImage();
      printCurrentInfo();
    }
    return;
  }

  if (evtId === IMG_ID && evtType === "resize") {
    const newW = event.width;
    const newH = event.height;
    if (newW) panelW = newW;
    if (newH) panelH = newH;
    return;
  }
});

// ---------------------------------------------------------------------------
// Keyboard input (stdin raw mode for arrow keys)
// ---------------------------------------------------------------------------

let stdinReader: ReturnType<ReadableStream<Uint8Array>["getReader"]> | null =
  null;

async function readStdin(): Promise<void> {
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    stdinReader = Bun.stdin.stream().getReader();

    while (!shuttingDown) {
      const { value, done } = await stdinReader.read();
      if (done) break;

      for (let i = 0; i < value.length; i++) {
        const byte = value[i];

        if (byte === 0x03) {
          cleanup();
          process.exit(0);
        }

        if (byte === 0x1b && i + 2 < value.length && value[i + 1] === 0x5b) {
          const arrow = value[i + 2];
          i += 2;

          switch (arrow) {
            case 0x44:
              navigatePrev();
              break;
            case 0x43:
              navigateNext();
              break;
            case 0x41:
              toggleGrid();
              break;
            case 0x42:
              toggleGrid();
              break;
          }
        }

        if (byte === 0x71) {
          cleanup();
          process.exit(0);
        }

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
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    stdinReader?.cancel();
  } catch {
    /* reader already closed */
  }
  if (NAV_ID !== "") ht.clear(NAV_ID);
  if (IMG_ID !== "") ht.clear(IMG_ID);
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

renderNav();
await renderImage();
printCurrentInfo();

readStdin();

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
