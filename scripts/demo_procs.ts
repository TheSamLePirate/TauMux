#!/usr/bin/env bun
/**
 * τ-mux — Process Manager
 *
 * An interactive process list with sortable columns, color-coded CPU/MEM bars,
 * kill-on-click, wheel scrolling, and keyboard filtering. Renders as a
 * floating HTML panel via the sideband protocol.
 *
 * Usage:
 *   bun scripts/demo_procs.ts
 */

import { userInfo } from "os";

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

const PANEL_ID = "procs";

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
  mantle: "#181825",
  crust: "#11111b",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay0: "#6c7086",
  overlay1: "#7f849c",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  subtext1: "#bac2de",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  lavender: "#b4befe",
  teal: "#94e2d5",
  peach: "#fab387",
  mauve: "#cba6f7",
} as const;

// ---------------------------------------------------------------------------
// Layout constants (px)
// ---------------------------------------------------------------------------

const PANEL_W = 700;
const PANEL_H = 500;

const HEADER_H = 36;
const COL_HEADER_H = 28;
const ROW_H = 24;
const STATS_H = 30;

// Column definitions: key, label, x-offset, width
const COLS: { key: SortCol; label: string; x: number; w: number }[] = [
  { key: "pid", label: "PID", x: 0, w: 70 },
  { key: "name", label: "Name", x: 70, w: 220 },
  { key: "cpu", label: "CPU%", x: 290, w: 130 },
  { key: "mem", label: "MEM%", x: 420, w: 130 },
  { key: "user", label: "User", x: 550, w: 150 },
];

const CONTENT_Y = HEADER_H + COL_HEADER_H;
const VISIBLE_ROWS = Math.floor(
  (PANEL_H - HEADER_H - COL_HEADER_H - STATS_H) / ROW_H,
);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type SortCol = "pid" | "name" | "cpu" | "mem" | "user";

interface ProcInfo {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  user: string;
}

let processes: ProcInfo[] = [];
let sortCol: SortCol = "cpu";
let sortAsc = false;
let scrollOffset = 0;
let filterText = "";
let confirmKillPid: number | null = null;

const currentUser = userInfo().username;

// Throttle
let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 32;
let renderQueued = false;

// ---------------------------------------------------------------------------
// Data collection — ps command
// ---------------------------------------------------------------------------

const PS_TIMEOUT_MS = 5000;
const MAX_PROCESS_ROWS = 2000;
let fetchInFlight = false;

async function fetchProcesses(): Promise<void> {
  if (fetchInFlight) return;
  fetchInFlight = true;
  try {
    const proc = Bun.spawn(["ps", "-eo", "pid,pcpu,pmem,user,comm"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: PS_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });

    // Fallback manual timeout guard in case the Bun-level timeout ever
    // misbehaves on a stuck subprocess — kill it unconditionally after 5s.
    const killTimer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, PS_TIMEOUT_MS + 250);

    const text = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(killTimer);

    const lines = text.trim().split("\n").slice(1); // skip header
    const result: ProcInfo[] = [];

    for (const line of lines) {
      if (result.length >= MAX_PROCESS_ROWS) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Format: PID %CPU %MEM USER COMMAND
      const match = trimmed.match(
        /^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.+)$/,
      );
      if (match) {
        const fullPath = match[5].trim();
        const name = fullPath.split("/").pop() ?? fullPath;
        result.push({
          pid: parseInt(match[1]),
          cpu: parseFloat(match[2]),
          mem: parseFloat(match[3]),
          user: match[4],
          name: name.slice(0, 30),
        });
      }
    }

    processes = result;
  } catch {
    /* command failed */
  } finally {
    fetchInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Process list helpers
// ---------------------------------------------------------------------------

function filteredProcesses(): ProcInfo[] {
  let list = processes;

  if (filterText.length > 0) {
    const lower = filterText.toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(lower));
  }

  list.sort((a, b) => {
    let cmp = 0;
    switch (sortCol) {
      case "pid":
        cmp = a.pid - b.pid;
        break;
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "cpu":
        cmp = a.cpu - b.cpu;
        break;
      case "mem":
        cmp = a.mem - b.mem;
        break;
      case "user":
        cmp = a.user.localeCompare(b.user);
        break;
    }
    return sortAsc ? cmp : -cmp;
  });

  return list;
}

function clampScroll(listLen: number): void {
  const maxOffset = Math.max(0, listLen - VISIBLE_ROWS);
  scrollOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
}

// ---------------------------------------------------------------------------
// Usage bar color
// ---------------------------------------------------------------------------

function barColor(pct: number): string {
  if (pct >= 70) return C.red;
  if (pct >= 30) return C.yellow;
  return C.green;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function renderHtml(): string {
  const list = filteredProcesses();
  clampScroll(list.length);

  const visible = list.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);

  // Stats
  const totalProcs = processes.length;
  const totalCpu = processes.reduce((s, p) => s + p.cpu, 0);
  const totalMem = processes.reduce((s, p) => s + p.mem, 0);

  // Sort indicator
  const arrow = sortAsc ? "\u25B2" : "\u25BC";

  // Header bar
  const filterDisplay =
    filterText.length > 0
      ? `<span style="color:${C.subtext0};font-size:11px;">Filter: </span><span style="color:${C.blue};font-size:12px;font-weight:600;background:${C.surface0};padding:1px 8px;border-radius:3px;">${escapeHtml(filterText)}<span style="opacity:0.5;">|</span></span>`
      : `<span style="color:${C.overlay0};font-size:11px;">type to filter</span>`;

  const header = `<div style="height:${HEADER_H}px;background:${C.surface0};display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-bottom:1px solid ${C.surface1};">
    <span style="color:${C.text};font-size:13px;font-weight:700;">Process Manager</span>
    <div style="display:flex;align-items:center;gap:8px;">
      ${filterDisplay}
      <div style="width:8px;height:8px;border-radius:50%;background:${C.green};opacity:0.8;"></div>
    </div>
  </div>`;

  // Column headers
  const colHeaders = COLS.map((col) => {
    const isActive = col.key === sortCol;
    const bg = isActive ? C.surface1 : "transparent";
    const fg = isActive ? C.blue : C.subtext0;
    const indicator = isActive ? ` ${arrow}` : "";
    return `<div style="position:absolute;left:${col.x}px;top:0;width:${col.w}px;height:${COL_HEADER_H}px;display:flex;align-items:center;padding:0 8px;background:${bg};color:${fg};font-size:11px;font-weight:600;cursor:pointer;user-select:none;box-sizing:border-box;">${escapeHtml(col.label)}${indicator}</div>`;
  }).join("");

  const colHeaderRow = `<div style="position:relative;height:${COL_HEADER_H}px;background:${C.mantle};border-bottom:1px solid ${C.surface1};">
    ${colHeaders}
  </div>`;

  // Process rows
  const rows = visible
    .map((proc, i) => {
      const rowIdx = scrollOffset + i;
      const isCurrentUser = proc.user === currentUser;
      const isConfirm = confirmKillPid === proc.pid;

      let rowBg: string;
      let rowFg: string;
      if (isConfirm) {
        rowBg = "rgba(243,139,168,0.25)";
        rowFg = C.red;
      } else if (rowIdx % 2 === 0) {
        rowBg = "transparent";
        rowFg = isCurrentUser ? C.text : C.subtext0;
      } else {
        rowBg = "rgba(49,50,68,0.3)";
        rowFg = isCurrentUser ? C.text : C.subtext0;
      }

      // CPU bar
      const cpuPct = Math.min(100, proc.cpu);
      const cpuBarW = Math.round((cpuPct / 100) * 80);
      const cpuColor = barColor(cpuPct);
      const cpuBar = `<div style="display:flex;align-items:center;gap:4px;">
        <div style="width:80px;height:10px;background:${C.surface0};border-radius:2px;overflow:hidden;flex-shrink:0;">
          <div style="width:${cpuBarW}px;height:10px;background:${cpuColor};border-radius:2px;"></div>
        </div>
        <span style="font-size:10px;min-width:32px;">${proc.cpu.toFixed(1)}</span>
      </div>`;

      // MEM bar
      const memPct = Math.min(100, proc.mem);
      const memBarW = Math.round((memPct / 100) * 80);
      const memColor = barColor(memPct);
      const memBar = `<div style="display:flex;align-items:center;gap:4px;">
        <div style="width:80px;height:10px;background:${C.surface0};border-radius:2px;overflow:hidden;flex-shrink:0;">
          <div style="width:${memBarW}px;height:10px;background:${memColor};border-radius:2px;"></div>
        </div>
        <span style="font-size:10px;min-width:32px;">${proc.mem.toFixed(1)}</span>
      </div>`;

      const confirmLabel = isConfirm
        ? `<span style="color:${C.red};font-weight:600;font-size:10px;margin-left:4px;">Kill?</span>`
        : "";

      return `<div style="position:relative;height:${ROW_H}px;display:flex;align-items:center;background:${rowBg};color:${rowFg};font-size:11px;cursor:pointer;user-select:none;">
        <div style="position:absolute;left:${COLS[0].x}px;width:${COLS[0].w}px;padding:0 8px;box-sizing:border-box;overflow:hidden;white-space:nowrap;">${proc.pid}</div>
        <div style="position:absolute;left:${COLS[1].x}px;width:${COLS[1].w}px;padding:0 8px;box-sizing:border-box;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${escapeHtml(proc.name)}${confirmLabel}</div>
        <div style="position:absolute;left:${COLS[2].x}px;width:${COLS[2].w}px;padding:0 8px;box-sizing:border-box;">${cpuBar}</div>
        <div style="position:absolute;left:${COLS[3].x}px;width:${COLS[3].w}px;padding:0 8px;box-sizing:border-box;">${memBar}</div>
        <div style="position:absolute;left:${COLS[4].x}px;width:${COLS[4].w}px;padding:0 8px;box-sizing:border-box;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${escapeHtml(proc.user)}</div>
      </div>`;
    })
    .join("");

  // Scroll indicator
  const totalRows = list.length;
  const scrollInfo =
    totalRows > VISIBLE_ROWS
      ? `<span style="color:${C.overlay0};font-size:10px;">${scrollOffset + 1}-${Math.min(scrollOffset + VISIBLE_ROWS, totalRows)} of ${totalRows}</span>`
      : `<span style="color:${C.overlay0};font-size:10px;">${totalRows} shown</span>`;

  // Stats bar
  const stats = `<div style="height:${STATS_H}px;background:${C.surface0};display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-top:1px solid ${C.surface1};font-size:11px;color:${C.subtext0};">
    <span>${totalProcs} processes | CPU: ${totalCpu.toFixed(1)}% | MEM: ${totalMem.toFixed(1)}%</span>
    ${scrollInfo}
  </div>`;

  // Content area (scrollable region)
  const contentH = PANEL_H - HEADER_H - COL_HEADER_H - STATS_H;

  return `<div style="width:${PANEL_W}px;height:${PANEL_H}px;background:${C.base};font-family:'SF Mono',Monaco,Consolas,'Liberation Mono',monospace;overflow:hidden;display:flex;flex-direction:column;user-select:none;">
  ${header}
  ${colHeaderRow}
  <div style="flex:1;height:${contentH}px;overflow:hidden;">
    ${rows}
  </div>
  ${stats}
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
      x: 50,
      y: 20,
      width: PANEL_W,
      height: PANEL_H,
      interactive: true,
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

  writeData(html);
}

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

type HitArea =
  | { area: "header" }
  | { area: "colheader"; col: SortCol }
  | { area: "row"; index: number }
  | { area: "stats" }
  | { area: "none" };

function hitTest(x: number, y: number): HitArea {
  // Header bar
  if (y < HEADER_H) {
    return { area: "header" };
  }

  // Column headers
  if (y < HEADER_H + COL_HEADER_H) {
    for (const col of COLS) {
      if (x >= col.x && x < col.x + col.w) {
        return { area: "colheader", col: col.key };
      }
    }
    return { area: "header" };
  }

  // Stats bar
  if (y >= PANEL_H - STATS_H) {
    return { area: "stats" };
  }

  // Process rows
  const rowY = y - CONTENT_Y;
  if (rowY >= 0) {
    const rowIndex = Math.floor(rowY / ROW_H);
    if (rowIndex < VISIBLE_ROWS) {
      return { area: "row", index: scrollOffset + rowIndex };
    }
  }

  return { area: "none" };
}

// ---------------------------------------------------------------------------
// Event handling — sideband events
// ---------------------------------------------------------------------------

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  if (evtId === "__system__" && evtType === "error") {
    const code = (event["code"] as string) ?? "unknown";
    const message = (event["message"] as string) ?? "";
    const panelId = (event["panelId"] as string) ?? "";
    process.stderr.write(
      `[procs] sideband error: ${code}${panelId ? ` (${panelId})` : ""}${
        message ? ` — ${message}` : ""
      }\n`,
    );
    return;
  }

  if (evtId !== PANEL_ID) return;

  const ex = (event["x"] as number) ?? 0;
  const ey = (event["y"] as number) ?? 0;

  switch (evtType) {
    case "close": {
      cleanup();
      break;
    }

    case "click": {
      const hit = hitTest(ex, ey);

      // Column header click -> toggle sort
      if (hit.area === "colheader") {
        if (sortCol === hit.col) {
          sortAsc = !sortAsc;
        } else {
          sortCol = hit.col;
          // Default descending for numeric, ascending for text
          sortAsc = hit.col === "name" || hit.col === "user";
        }
        confirmKillPid = null;
        render(true);
        return;
      }

      // Row click -> kill confirm / execute
      if (hit.area === "row") {
        const list = filteredProcesses();
        if (hit.index >= 0 && hit.index < list.length) {
          const proc = list[hit.index];

          if (confirmKillPid === proc.pid) {
            // Second click — send SIGTERM
            try {
              process.kill(proc.pid, "SIGTERM");
              console.log(`Sent SIGTERM to PID ${proc.pid} (${proc.name})`);
            } catch (err) {
              console.log(
                `Failed to kill PID ${proc.pid}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
            confirmKillPid = null;
          } else {
            // First click — enter confirm state
            confirmKillPid = proc.pid;
          }
          render(true);
          return;
        }
      }

      // Click anywhere else -> cancel kill confirm
      if (confirmKillPid !== null) {
        confirmKillPid = null;
        render(true);
      }
      break;
    }

    case "wheel": {
      const deltaY = (event["deltaY"] as number) ?? 0;
      const list = filteredProcesses();
      const step = deltaY > 0 ? 3 : -3;
      scrollOffset = Math.max(
        0,
        Math.min(scrollOffset + step, Math.max(0, list.length - VISIBLE_ROWS)),
      );
      confirmKillPid = null;
      render(true);
      break;
    }

    case "resize": {
      // Panel was resized by the user
      render(true);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Event loop — fd5
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
// Stdin reading — filter input (raw mode)
// ---------------------------------------------------------------------------

function startStdinReader(): void {
  if (!process.stdin.isTTY) return;

  try {
    process.stdin.setRawMode(true);
  } catch {
    // raw mode not available
    return;
  }

  process.stdin.on("data", (data: Buffer) => {
    for (const byte of data) {
      // Ctrl+C
      if (byte === 0x03) {
        cleanup();
        return;
      }

      // Backspace / Delete
      if (byte === 0x7f || byte === 0x08) {
        if (filterText.length > 0) {
          filterText = filterText.slice(0, -1);
          scrollOffset = 0;
          confirmKillPid = null;
          render(true);
        }
        continue;
      }

      // Escape — clear filter
      if (byte === 0x1b) {
        if (filterText.length > 0) {
          filterText = "";
          scrollOffset = 0;
          confirmKillPid = null;
          render(true);
        }
        continue;
      }

      // Printable ASCII
      if (byte >= 0x20 && byte <= 0x7e) {
        filterText += String.fromCharCode(byte);
        scrollOffset = 0;
        confirmKillPid = null;
        render(true);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Refresh loop
// ---------------------------------------------------------------------------

async function refreshLoop(): Promise<void> {
  await fetchProcesses();
  render(true);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  clearInterval(refreshTimer);
  writeMeta({ id: PANEL_ID, type: "clear" });
  try {
    process.stdin.setRawMode(false);
  } catch {
    /* ignore */
  }
  console.log("\nProcess manager closed.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log("Process Manager started.");
console.log(
  "Type to filter processes by name. Backspace to delete, Escape to clear.",
);
console.log(
  "Click column headers to sort. Click a row to kill (confirm with second click).",
);
console.log("Scroll with mouse wheel. Press Ctrl+C to exit.\n");

// Initial data fetch + render
await fetchProcesses();
render(true);

// Start refresh loop (every 2 seconds)
const refreshTimer = setInterval(() => {
  refreshLoop();
}, 2000);

// Start event loop
readEvents();

// Start stdin reader for filtering
startStdinReader();

// Cleanup on signals
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
