#!/usr/bin/env bun
/**
 * τ-mux — Fixed Clock Widget
 *
 * A minimal clock rendered at the top-right corner using position: "fixed".
 * No title bar, no drag handle, no resize — just the raw time display.
 * Repositions on terminal resize.
 *
 * Usage:
 *   bun scripts/demo_clock.ts
 */

import { TauMux } from "./hyperterm";

const ht = new TauMux();
if (!ht.available) {
  console.log(
    "This script requires τ-mux.\n" +
      "Run it inside the τ-mux terminal emulator.",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

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
// Initial panel + update loop
// ---------------------------------------------------------------------------

const panelId = ht.showHtml(renderClock(), {
  position: "fixed",
  x: topRightX(),
  y: 8,
  width: PANEL_W,
  height: PANEL_H,
  opacity: 1,
  zIndex: 100,
});

const timer = setInterval(() => {
  // `update` with a string payload now goes inline under 2 KB (lib takes
  // care of byteLength + fd4 routing), so the panel actually refreshes.
  // The pre-upgrade version omitted byteLength and the clock face stayed
  // frozen forever.
  ht.update(panelId, { data: renderClock() });
}, 1000);

// ---------------------------------------------------------------------------
// Events — reposition on terminal resize, surface any protocol errors,
// tear down cleanly when the user clicks the X.
// ---------------------------------------------------------------------------

ht.onTerminalResize(({ cols }) => {
  if (cols !== termCols) {
    termCols = cols;
    ht.update(panelId, { x: topRightX() });
  }
});

ht.onError((code, message) => {
  console.error(`[demo_clock] ${code}: ${message}`);
});

ht.onClose(panelId, () => {
  cleanup();
});

console.log("Clock widget active. Press Ctrl+C or close the panel to dismiss.");

function cleanup(): void {
  clearInterval(timer);
  ht.clear(panelId);
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
