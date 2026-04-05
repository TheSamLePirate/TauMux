#!/usr/bin/env bun
/**
 * Real-time CPU usage graph rendered as a floating SVG panel.
 * Run inside HyperTerm Canvas: bun scripts/test_cpu.ts
 */

import { cpus } from "os";

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

const PANEL_ID = "cpu-graph";

// Track current position (updated by drag events from terminal)

let panelX = 50;
let panelY = 50;
let panelW = 0;
let panelH = 0;

const WIDTH = 480;
const HEIGHT = 200;
const MAX_POINTS = 120;
const INTERVAL_MS = 100;

// Colors (Catppuccin Mocha)
const BG = "rgba(30,30,46,0.5)";
const SURFACE = "#313244";
const TEXT = "#cdd6f4";
const GREEN = "#a6e3a1";
const RED = "#f38ba8";
const BLUE = "#89b4fa";
const YELLOW = "#f9e2af";
const OVERLAY = "#6c7086";

const history: number[] = [];
let prevIdle = 0;
let prevTotal = 0;

function getCpuUsage(): number {
  const cores = cpus();
  let idle = 0;
  let total = 0;
  for (const core of cores) {
    const t = core.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }

  const dIdle = idle - prevIdle;
  const dTotal = total - prevTotal;
  prevIdle = idle;
  prevTotal = total;

  if (dTotal === 0) return 0;
  return Math.round((1 - dIdle / dTotal) * 100);
}

function buildSvg(data: number[], w: number, h: number): string {
  const padL = 35;
  const padR = 10;
  const padT = 30;
  const padB = 25;
  const graphW = w - padL - padR;
  const graphH = h - padT - padB;

  const current = data.length > 0 ? data[data.length - 1] : 0;
  const avg =
    data.length > 0
      ? Math.round(data.reduce((a, b) => a + b, 0) / data.length)
      : 0;

  // Color based on load
  let lineColor = GREEN;
  if (current > 80) lineColor = RED;
  else if (current > 50) lineColor = YELLOW;
  else if (current > 30) lineColor = BLUE;

  // Build polyline points
  const points = data
    .map((val, i) => {
      const x = padL + (i / (MAX_POINTS - 1)) * graphW;
      const y = padT + graphH - (val / 100) * graphH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Fill area under the line
  const fillPoints =
    data.length > 0
      ? `${padL},${padT + graphH} ${points} ${padL + ((data.length - 1) / (MAX_POINTS - 1)) * graphW},${padT + graphH}`
      : "";

  // Grid lines
  const gridLines = [0, 25, 50, 75, 100]
    .map((pct) => {
      const y = padT + graphH - (pct / 100) * graphH;
      return `<line x1="${padL}" y1="${y}" x2="${padL + graphW}" y2="${y}" stroke="${SURFACE}" stroke-width="0.5"/>
      <text x="${padL - 5}" y="${y + 4}" text-anchor="end" fill="${OVERLAY}" font-size="9" font-family="monospace">${pct}%</text>`;
    })
    .join("\n");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${h}" rx="0" fill="${BG}"/>

  <!-- Title -->
  <text x="${padL}" y="20" fill="${TEXT}" font-size="13" font-family="sans-serif" font-weight="600">CPU Usage</text>
  <text x="${w - padR}" y="20" text-anchor="end" fill="${lineColor}" font-size="13" font-family="monospace" font-weight="700">${current}%</text>
  <text x="${w - padR - 60}" y="20" text-anchor="end" fill="${OVERLAY}" font-size="11" font-family="monospace">avg ${avg}%</text>

  <!-- Grid -->
  ${gridLines}

  <!-- Graph area border -->
  <rect x="${padL}" y="${padT}" width="${graphW}" height="${graphH}" fill="none" stroke="${SURFACE}" stroke-width="0.5"/>

  <!-- Fill -->
  ${fillPoints ? `<polygon points="${fillPoints}" fill="${lineColor}" opacity="0.15"/>` : ""}

  <!-- Line -->
  ${points ? `<polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ""}

  <!-- Current value dot -->
  ${
    data.length > 0
      ? `<circle cx="${padL + ((data.length - 1) / (MAX_POINTS - 1)) * graphW}" cy="${padT + graphH - (current / 100) * graphH}" r="3" fill="${lineColor}"/>`
      : ""
  }
</svg>`;
}

function writeMeta(meta: Record<string, unknown>) {
  if (!hasHyperTerm) return;
  try {
    const line = JSON.stringify(meta) + "\n";
    Bun.write(Bun.file(META_FD!), new TextEncoder().encode(line));
  } catch {
    // fd write failed
  }
}

function writeData(str: string) {
  if (!hasHyperTerm) return;
  try {
    Bun.write(Bun.file(DATA_FD!), new TextEncoder().encode(str));
  } catch {
    // fd write failed
  }
}

// Listen for events from the terminal (drag, resize, close)
async function readEvents() {
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
          if (event.id !== PANEL_ID) continue;
          if (event.event === "dragend") {
            panelX = event.x ?? panelX;
            panelY = event.y ?? panelY;
          } else if (event.event === "resize") {
            panelW = event.width ?? panelW;
            panelH = event.height ?? panelH;
          } else if (event.event === "close") {
            clearInterval(timer);
            console.log("\nPanel closed.");
            process.exit(0);
          }
        } catch {
          // invalid JSON
        }
      }
    }
  } catch {
    // fd closed or unavailable
  }
}

// Print ASCII bar when not in HyperTerm
function printAsciiBar(usage: number) {
  const barLen = 40;
  const filled = Math.round((usage / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);
  const color = usage > 80 ? "\x1b[31m" : usage > 50 ? "\x1b[33m" : "\x1b[32m";
  process.stdout.write(
    `\r${color}CPU [${bar}] ${String(usage).padStart(3)}%\x1b[0m`,
  );
}

// Initial sample to prime deltas
getCpuUsage();
panelW = WIDTH;
panelH = HEIGHT + 20;

if (hasHyperTerm) {
  console.log("CPU monitor started — updating every 100ms (Ctrl+C to stop)");
} else {
  console.log("CPU monitor (no HyperTerm — ASCII fallback, Ctrl+C to stop)");
}

// Start reading events in background
readEvents();

let first = true;

const timer = setInterval(() => {
  const usage = getCpuUsage();
  history.push(usage);
  if (history.length > MAX_POINTS) history.shift();

  if (!hasHyperTerm) {
    printAsciiBar(usage);
    return;
  }

  const svgW = Math.max(200, panelW);
  const svgH = Math.max(100, panelH - 20);
  const svg = buildSvg(history, svgW, svgH);
  const svgBytes = new TextEncoder().encode(svg);

  if (first) {
    writeMeta({
      id: PANEL_ID,
      type: "svg",
      position: "float",
      x: panelX,
      y: panelY,
      width: panelW,
      height: panelH,
      draggable: true,
      resizable: true,
      byteLength: svgBytes.byteLength,
    });
    first = false;
  } else {
    writeMeta({
      id: PANEL_ID,
      type: "update",
      x: panelX,
      y: panelY,
      width: panelW,
      height: panelH,
      byteLength: svgBytes.byteLength,
    });
  }

  writeData(svg);
}, INTERVAL_MS);

// Cleanup on exit
process.on("SIGINT", () => {
  clearInterval(timer);
  if (hasHyperTerm) {
    writeMeta({ id: PANEL_ID, type: "clear" });
  }
  console.log("\nCPU monitor stopped.");
  process.exit(0);
});
