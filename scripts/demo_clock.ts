#!/usr/bin/env bun
/**
 * HyperTerm Canvas — Fixed Clock Widget
 *
 * A minimal clock rendered at the top-right corner using position: "fixed".
 * No title bar, no drag handle, no resize — just the raw time display.
 * Repositions on terminal resize.
 *
 * Usage:
 *   bun scripts/demo_clock.ts
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
// Layout constants
// ---------------------------------------------------------------------------

const PANEL_ID = "clock";
const PANEL_W = 160;
const PANEL_H = 58;
const MARGIN = 12;

let termCols = 120;

function topRightX(): number {
  const pxW = termCols * 8;
  return Math.max(MARGIN, pxW - PANEL_W - MARGIN);
}

// ---------------------------------------------------------------------------
// Clock renderer
// ---------------------------------------------------------------------------

function renderClock(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const date = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return `<div style="
    font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
    color: rgba(205, 214, 244, 0.85);
    text-align: right;
    padding: 6px 12px;
    background: rgba(17, 17, 27, 0.6);
    backdrop-filter: blur(12px);
    border-radius: 8px;
    border: 1px solid rgba(180, 190, 254, 0.1);
  ">
    <div style="
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 2px;
      color: rgba(180, 190, 254, 0.95);
      text-shadow: 0 0 14px rgba(180, 190, 254, 0.3);
    ">${hours}:${minutes}<span style="
      color: rgba(180, 190, 254, 0.4);
      font-size: 16px;
    ">:${seconds}</span></div>
    <div style="
      font-size: 10px;
      color: rgba(166, 173, 200, 0.6);
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-top: 2px;
    ">${date}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Initial panel creation
// ---------------------------------------------------------------------------

const html = renderClock();
const bytes = encoder.encode(html);

writeMeta({
  id: PANEL_ID,
  type: "html",
  position: "fixed",
  x: topRightX(),
  y: 8,
  width: PANEL_W,
  height: PANEL_H,
  byteLength: bytes.length,
  opacity: 1,
  zIndex: 100,
});
writeData(html);

console.log("Clock widget active. Press Ctrl+C to dismiss.");

// ---------------------------------------------------------------------------
// Update loop — refresh every second via "update" type
// ---------------------------------------------------------------------------

const timer = setInterval(() => {
  writeMeta({
    id: PANEL_ID,
    type: "update",
    data: renderClock(),
  });
}, 1000);

// ---------------------------------------------------------------------------
// Event handling — reposition on terminal resize
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
          if (event.id === "__terminal__" && event.event === "resize") {
            termCols = event.cols ?? termCols;
            writeMeta({
              id: PANEL_ID,
              type: "update",
              x: topRightX(),
            });
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

readEvents();

// ---------------------------------------------------------------------------
// Graceful cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  clearInterval(timer);
  writeMeta({ id: PANEL_ID, type: "clear" });
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
