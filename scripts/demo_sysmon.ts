#!/usr/bin/env bun
/**
 * HyperTerm Canvas — System Monitor Widget
 *
 * A compact, always-on system health display with CPU arc gauge, RAM/disk
 * bars, load averages, and a CPU sparkline. Click to toggle expanded view
 * with per-core bars, top processes, network rates, and uptime.
 *
 * Usage:
 *   bun scripts/demo_sysmon.ts
 */

import { cpus, totalmem, freemem, loadavg, uptime as osUptime } from "os";
import { readFileSync } from "fs";

const SUBPROCESS_TIMEOUT_MS = 3000;

// macOS: en0-en7, wlan (rare), lo*
// Linux: eth*, wlan*, enp*/eno*/ens*, wl*, docker*, lo*
const NET_IFACE_RE = /^(en|wlan|eth|wl|docker|lo|enp|eno|ens|br-|veth)/;

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
// Constants
// ---------------------------------------------------------------------------

const PANEL_ID = "sysmon";
const COMPACT_W = 240;
const COMPACT_H = 200;
const EXPANDED_W = 400;
const EXPANDED_H = 350;
const UPDATE_INTERVAL = 1000;
const SPARKLINE_MAX = 60;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let expanded = false;
let panelX = -1; // calculated on first render from terminal size
let panelY = 10;
let termCols = 120;
let termRows = 40;

// CPU tracking
const prevIdleTotals: number[] = [];
const prevTotalTotals: number[] = [];
const cpuHistory: number[] = [];

// Network tracking
let prevNetRx = 0;
let prevNetTx = 0;
let netRxRate = 0;
let netTxRate = 0;
let netInitialized = false;

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

interface SystemData {
  cpuPct: number;
  corePcts: number[];
  ramUsed: number;
  ramTotal: number;
  diskUsed: number;
  diskTotal: number;
  load: [number, number, number];
  topProcs: { cpu: number; name: string }[];
  netRxRate: number;
  netTxRate: number;
  uptimeStr: string;
}

function getCpuUsage(): { total: number; perCore: number[] } {
  const cores = cpus();
  const corePcts: number[] = [];
  let totalIdle = 0;
  let totalAll = 0;

  for (let i = 0; i < cores.length; i++) {
    const t = cores[i].times;
    const idle = t.idle;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;

    const prevIdle = prevIdleTotals[i] ?? idle;
    const prevTotal = prevTotalTotals[i] ?? total;

    const dIdle = idle - prevIdle;
    const dTotal = total - prevTotal;

    prevIdleTotals[i] = idle;
    prevTotalTotals[i] = total;

    totalIdle += dIdle;
    totalAll += dTotal;

    if (dTotal === 0) {
      corePcts.push(0);
    } else {
      corePcts.push(Math.round((1 - dIdle / dTotal) * 100));
    }
  }

  const totalPct =
    totalAll === 0 ? 0 : Math.round((1 - totalIdle / totalAll) * 100);
  return { total: totalPct, perCore: corePcts };
}

async function getDiskUsage(): Promise<{ used: number; total: number }> {
  try {
    const proc = Bun.spawn(["df", "-k", "/"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: SUBPROCESS_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
    const killTimer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, SUBPROCESS_TIMEOUT_MS + 250);
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(killTimer);
    const lines = text.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      // df -k columns: Filesystem 1K-blocks Used Available Capacity ...
      const totalKb = parseInt(parts[1]) || 0;
      const usedKb = parseInt(parts[2]) || 0;
      return { used: usedKb * 1024, total: totalKb * 1024 };
    }
  } catch {
    /* command failed */
  }
  return { used: 0, total: 1 };
}

async function getTopProcesses(): Promise<{ cpu: number; name: string }[]> {
  try {
    const proc = Bun.spawn(["ps", "-eo", "pcpu,comm", "-r"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: SUBPROCESS_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
    const killTimer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, SUBPROCESS_TIMEOUT_MS + 250);
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(killTimer);
    const lines = text.trim().split("\n").slice(1); // skip header
    const results: { cpu: number; name: string }[] = [];
    for (const line of lines) {
      if (results.length >= 5) break;
      const trimmed = line.trim();
      const match = trimmed.match(/^([\d.]+)\s+(.+)$/);
      if (match) {
        const cpu = parseFloat(match[1]);
        // Get just the binary name (last path component)
        const fullPath = match[2].trim();
        const name = fullPath.split("/").pop() ?? fullPath;
        if (cpu > 0) {
          results.push({ cpu, name: name.slice(0, 20) });
        }
      }
    }
    return results;
  } catch {
    /* command failed */
  }
  return [];
}

function parseProcNetDev(text: string): { rx: number; tx: number } | null {
  // Format (Linux):
  //   Inter-|   Receive                                                |  Transmit
  //    face |bytes    packets errs drop fifo frame compressed multicast|bytes    ...
  //   eth0:  12345    67      0    0    0    0     0          0        67890    ...
  const lines = text.split("\n");
  if (lines.length < 3) return null;
  let rx = 0;
  let tx = 0;
  let matched = false;
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const iface = line.slice(0, colonIdx).trim();
    if (!NET_IFACE_RE.test(iface)) continue;
    const parts = line
      .slice(colonIdx + 1)
      .trim()
      .split(/\s+/);
    if (parts.length < 16) continue;
    const ibytes = parseInt(parts[0]);
    const obytes = parseInt(parts[8]);
    if (!isNaN(ibytes) && !isNaN(obytes)) {
      rx += ibytes;
      tx += obytes;
      matched = true;
    }
  }
  return matched ? { rx, tx } : null;
}

async function getNetworkStatsViaNetstat(): Promise<{
  rx: number;
  tx: number;
} | null> {
  try {
    const proc = Bun.spawn(["/usr/sbin/netstat", "-ib"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: SUBPROCESS_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
    const killTimer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, SUBPROCESS_TIMEOUT_MS + 250);
    const text = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    clearTimeout(killTimer);
    if (exitCode !== 0) return null;

    const lines = text.trim().split("\n");
    let totalRx = 0;
    let totalTx = 0;
    let matched = false;
    // Parse netstat -ib: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes ...
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/\s+/);
      if (parts[0] && NET_IFACE_RE.test(parts[0]) && parts.length >= 10) {
        const ibytes = parseInt(parts[6]);
        const obytes = parseInt(parts[9]);
        if (!isNaN(ibytes) && !isNaN(obytes)) {
          totalRx += ibytes;
          totalTx += obytes;
          matched = true;
        }
      }
    }
    return matched ? { rx: totalRx, tx: totalTx } : null;
  } catch {
    return null;
  }
}

function getNetworkStatsViaProc(): { rx: number; tx: number } | null {
  try {
    const text = readFileSync("/proc/net/dev", "utf8");
    return parseProcNetDev(text);
  } catch {
    return null;
  }
}

async function getNetworkStats(): Promise<void> {
  let stats = await getNetworkStatsViaNetstat();
  if (!stats) stats = getNetworkStatsViaProc();
  if (!stats) return;

  if (netInitialized) {
    netRxRate = Math.max(0, stats.rx - prevNetRx);
    netTxRate = Math.max(0, stats.tx - prevNetTx);
  }
  prevNetRx = stats.rx;
  prevNetTx = stats.tx;
  netInitialized = true;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + " TB";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + " KB";
  return bytes + " B";
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1e6) return (bytesPerSec / 1e6).toFixed(1) + " MB/s";
  if (bytesPerSec >= 1e3) return (bytesPerSec / 1e3).toFixed(1) + " KB/s";
  return bytesPerSec + " B/s";
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function usageColor(pct: number): string {
  if (pct >= 80) return C.red;
  if (pct >= 50) return C.yellow;
  return C.green;
}

// ---------------------------------------------------------------------------
// SVG rendering helpers
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build an SVG arc path for a gauge from 0 to `pct` percent.
 * The arc spans from -225 deg to +45 deg (270 deg sweep total).
 */
function arcPath(cx: number, cy: number, r: number, pct: number): string {
  const startAngle = -225;
  const totalSweep = 270;
  const endAngle =
    startAngle + (totalSweep * Math.min(100, Math.max(0, pct))) / 100;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startAngle));
  const y1 = cy + r * Math.sin(toRad(startAngle));
  const x2 = cx + r * Math.cos(toRad(endAngle));
  const y2 = cy + r * Math.sin(toRad(endAngle));

  const sweep = (totalSweep * pct) / 100;
  const largeArc = sweep > 180 ? 1 : 0;

  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** Background track for the arc gauge. */
function arcTrackPath(cx: number, cy: number, r: number): string {
  return arcPath(cx, cy, r, 99.9);
}

function sparklineSvg(
  data: number[],
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  if (data.length < 2) return "";
  const points = data
    .map((val, i) => {
      const px = x + (i / (SPARKLINE_MAX - 1)) * w;
      const py = y + h - (val / 100) * h;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");

  // Fill area
  const first = `${x.toFixed(1)},${(y + h).toFixed(1)}`;
  const last = `${(x + ((data.length - 1) / (SPARKLINE_MAX - 1)) * w).toFixed(1)},${(y + h).toFixed(1)}`;

  const current = data.length > 0 ? data[data.length - 1] : 0;
  const color = usageColor(current);

  return `<polygon points="${first} ${points} ${last}" fill="${color}" opacity="0.12"/>
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function horizontalBar(
  x: number,
  y: number,
  w: number,
  h: number,
  pct: number,
  color: string,
  label: string,
  valueText: string,
): string {
  const fillW = (Math.min(100, Math.max(0, pct)) / 100) * w;
  return `<text x="${x}" y="${y - 3}" fill="${C.subtext0}" font-size="9" font-family="monospace">${escapeXml(label)}</text>
    <text x="${x + w}" y="${y - 3}" text-anchor="end" fill="${C.text}" font-size="9" font-family="monospace">${escapeXml(valueText)}</text>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${C.surface0}"/>
    <rect x="${x}" y="${y}" width="${fillW.toFixed(1)}" height="${h}" rx="2" fill="${color}"/>`;
}

// ---------------------------------------------------------------------------
// Compact view SVG
// ---------------------------------------------------------------------------

function renderCompact(data: SystemData): string {
  const w = COMPACT_W;
  const h = COMPACT_H;
  const pad = 10;

  // Arc gauge dimensions
  const gaugeCx = w / 2;
  const gaugeCy = 52;
  const gaugeR = 32;
  const cpuColor = usageColor(data.cpuPct);

  // RAM bar
  const ramPct = data.ramTotal > 0 ? (data.ramUsed / data.ramTotal) * 100 : 0;
  const ramColor = usageColor(ramPct);

  // Disk bar
  const diskPct =
    data.diskTotal > 0 ? (data.diskUsed / data.diskTotal) * 100 : 0;
  const diskColor = usageColor(diskPct);

  const barW = w - pad * 2;
  const barH = 6;

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${h}" rx="8" fill="${C.base}"/>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="none" stroke="${C.surface1}" stroke-width="1"/>

  <!-- Title -->
  <text x="${pad}" y="16" fill="${C.text}" font-size="10" font-family="monospace" font-weight="600">System Monitor</text>
  <circle cx="${w - pad - 4}" cy="12" r="3" fill="${C.green}" opacity="0.8">
    <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite"/>
  </circle>

  <!-- CPU Arc Gauge -->
  <path d="${arcTrackPath(gaugeCx, gaugeCy, gaugeR)}" fill="none" stroke="${C.surface0}" stroke-width="6" stroke-linecap="round"/>
  <path d="${arcPath(gaugeCx, gaugeCy, gaugeR, data.cpuPct)}" fill="none" stroke="${cpuColor}" stroke-width="6" stroke-linecap="round"/>
  <text x="${gaugeCx}" y="${gaugeCy + 2}" text-anchor="middle" fill="${cpuColor}" font-size="16" font-family="monospace" font-weight="700">${data.cpuPct}%</text>
  <text x="${gaugeCx}" y="${gaugeCy + 14}" text-anchor="middle" fill="${C.overlay0}" font-size="8" font-family="monospace">CPU</text>

  <!-- RAM bar -->
  ${horizontalBar(pad, 92, barW, barH, ramPct, ramColor, "RAM", `${formatBytes(data.ramUsed)} / ${formatBytes(data.ramTotal)}`)}

  <!-- Disk bar -->
  ${horizontalBar(pad, 114, barW, barH, diskPct, diskColor, "DISK", `${formatBytes(data.diskUsed)} / ${formatBytes(data.diskTotal)}`)}

  <!-- Load average -->
  <text x="${pad}" y="140" fill="${C.subtext0}" font-size="9" font-family="monospace">LOAD</text>
  <text x="${w - pad}" y="140" text-anchor="end" fill="${C.text}" font-size="9" font-family="monospace">${data.load[0].toFixed(2)}  ${data.load[1].toFixed(2)}  ${data.load[2].toFixed(2)}</text>

  <!-- CPU Sparkline -->
  <text x="${pad}" y="156" fill="${C.overlay0}" font-size="8" font-family="monospace">CPU HISTORY</text>
  ${sparklineSvg(cpuHistory, pad, 160, barW, 30)}
</svg>`;
}

// ---------------------------------------------------------------------------
// Expanded view SVG
// ---------------------------------------------------------------------------

function renderExpanded(data: SystemData): string {
  const w = EXPANDED_W;
  const h = EXPANDED_H;
  const pad = 12;

  // Arc gauge dimensions
  const gaugeCx = 52;
  const gaugeCy = 52;
  const gaugeR = 30;
  const cpuColor = usageColor(data.cpuPct);

  // RAM + Disk
  const ramPct = data.ramTotal > 0 ? (data.ramUsed / data.ramTotal) * 100 : 0;
  const ramColor = usageColor(ramPct);
  const diskPct =
    data.diskTotal > 0 ? (data.diskUsed / data.diskTotal) * 100 : 0;
  const diskColor = usageColor(diskPct);

  // Summary bars to the right of the gauge
  const summaryX = 100;
  const summaryW = w - summaryX - pad;
  const barH = 5;

  // Per-core bars
  const coreBarW = w - pad * 2;
  const coreBarH = 4;
  const coreY0 = 102;
  const coreBars = data.corePcts
    .map((pct, i) => {
      const y = coreY0 + i * 12;
      const color = usageColor(pct);
      return `<text x="${pad}" y="${y + 3}" fill="${C.overlay0}" font-size="7" font-family="monospace">${i}</text>
        <rect x="${pad + 12}" y="${y - 2}" width="${coreBarW - 12}" height="${coreBarH}" rx="1" fill="${C.surface0}"/>
        <rect x="${pad + 12}" y="${y - 2}" width="${((pct / 100) * (coreBarW - 12)).toFixed(1)}" height="${coreBarH}" rx="1" fill="${color}"/>
        <text x="${w - pad}" y="${y + 3}" text-anchor="end" fill="${C.subtext0}" font-size="7" font-family="monospace">${pct}%</text>`;
    })
    .join("\n  ");

  const coresHeight = data.corePcts.length * 12 + 4;

  // Top processes
  const procY0 = coreY0 + coresHeight + 14;
  const procs = data.topProcs
    .map((p, i) => {
      const y = procY0 + 12 + i * 13;
      const barFillW = Math.min((p.cpu / 100) * 60, 60);
      return `<rect x="${pad}" y="${y - 7}" width="${barFillW.toFixed(1)}" height="8" rx="1" fill="${C.blue}" opacity="0.3"/>
        <text x="${pad + 2}" y="${y}" fill="${C.text}" font-size="8" font-family="monospace">${p.cpu.toFixed(1)}%</text>
        <text x="${pad + 66}" y="${y}" fill="${C.subtext0}" font-size="8" font-family="monospace">${escapeXml(p.name)}</text>`;
    })
    .join("\n  ");

  // Network + Uptime
  const netY = procY0 + 12 + data.topProcs.length * 13 + 10;

  // Sparkline
  const sparkY = netY + 24;
  const sparkH = Math.max(20, h - sparkY - 8);

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${h}" rx="8" fill="${C.base}"/>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="none" stroke="${C.surface1}" stroke-width="1"/>

  <!-- Title -->
  <text x="${pad}" y="16" fill="${C.text}" font-size="10" font-family="monospace" font-weight="600">System Monitor</text>
  <text x="${w - pad}" y="16" text-anchor="end" fill="${C.overlay0}" font-size="8" font-family="monospace">expanded</text>
  <circle cx="${w - pad - 50}" cy="12" r="3" fill="${C.green}" opacity="0.8">
    <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite"/>
  </circle>

  <!-- CPU Arc Gauge -->
  <path d="${arcTrackPath(gaugeCx, gaugeCy, gaugeR)}" fill="none" stroke="${C.surface0}" stroke-width="5" stroke-linecap="round"/>
  <path d="${arcPath(gaugeCx, gaugeCy, gaugeR, data.cpuPct)}" fill="none" stroke="${cpuColor}" stroke-width="5" stroke-linecap="round"/>
  <text x="${gaugeCx}" y="${gaugeCy + 2}" text-anchor="middle" fill="${cpuColor}" font-size="14" font-family="monospace" font-weight="700">${data.cpuPct}%</text>
  <text x="${gaugeCx}" y="${gaugeCy + 12}" text-anchor="middle" fill="${C.overlay0}" font-size="7" font-family="monospace">CPU</text>

  <!-- Summary bars next to gauge -->
  ${horizontalBar(summaryX, 32, summaryW, barH, ramPct, ramColor, "RAM", `${formatBytes(data.ramUsed)} / ${formatBytes(data.ramTotal)}`)}
  ${horizontalBar(summaryX, 52, summaryW, barH, diskPct, diskColor, "DISK", `${formatBytes(data.diskUsed)} / ${formatBytes(data.diskTotal)}`)}

  <!-- Load average -->
  <text x="${summaryX}" y="76" fill="${C.subtext0}" font-size="8" font-family="monospace">LOAD</text>
  <text x="${w - pad}" y="76" text-anchor="end" fill="${C.text}" font-size="8" font-family="monospace">${data.load[0].toFixed(2)}  ${data.load[1].toFixed(2)}  ${data.load[2].toFixed(2)}</text>

  <!-- Separator -->
  <line x1="${pad}" y1="86" x2="${w - pad}" y2="86" stroke="${C.surface1}" stroke-width="0.5"/>

  <!-- Per-core CPU -->
  <text x="${pad}" y="96" fill="${C.subtext0}" font-size="8" font-family="monospace">CPU CORES</text>
  ${coreBars}

  <!-- Separator -->
  <line x1="${pad}" y1="${procY0 - 4}" x2="${w - pad}" y2="${procY0 - 4}" stroke="${C.surface1}" stroke-width="0.5"/>

  <!-- Top processes -->
  <text x="${pad}" y="${procY0 + 4}" fill="${C.subtext0}" font-size="8" font-family="monospace">TOP PROCESSES</text>
  ${procs}

  <!-- Separator -->
  <line x1="${pad}" y1="${netY - 6}" x2="${w - pad}" y2="${netY - 6}" stroke="${C.surface1}" stroke-width="0.5"/>

  <!-- Network -->
  <text x="${pad}" y="${netY + 4}" fill="${C.subtext0}" font-size="8" font-family="monospace">NET</text>
  <text x="${pad + 28}" y="${netY + 4}" fill="${C.teal}" font-size="8" font-family="monospace">\u2193 ${formatRate(data.netRxRate)}</text>
  <text x="${pad + 130}" y="${netY + 4}" fill="${C.peach}" font-size="8" font-family="monospace">\u2191 ${formatRate(data.netTxRate)}</text>

  <!-- Uptime -->
  <text x="${w - pad}" y="${netY + 4}" text-anchor="end" fill="${C.overlay0}" font-size="8" font-family="monospace">up ${escapeXml(data.uptimeStr)}</text>

  <!-- CPU Sparkline -->
  <text x="${pad}" y="${sparkY - 2}" fill="${C.overlay0}" font-size="7" font-family="monospace">CPU HISTORY</text>
  ${sparklineSvg(cpuHistory, pad, sparkY + 2, w - pad * 2, sparkH - 6)}
</svg>`;
}

// ---------------------------------------------------------------------------
// Panel rendering
// ---------------------------------------------------------------------------

let firstRender = true;

function computeTopRight(): { x: number; y: number } {
  // Estimate pixel width from terminal columns (approx 8px per col)
  const pxW = termCols * 8;
  const currentW = expanded ? EXPANDED_W : COMPACT_W;
  return { x: Math.max(10, pxW - currentW - 16), y: 10 };
}

async function render(): Promise<void> {
  // Collect data
  const cpu = getCpuUsage();
  cpuHistory.push(cpu.total);
  if (cpuHistory.length > SPARKLINE_MAX) cpuHistory.shift();

  const ramTotal = totalmem();
  const ramFree = freemem();
  const ramUsed = ramTotal - ramFree;

  const disk = await getDiskUsage();
  const load = loadavg() as [number, number, number];
  const topProcs = expanded ? await getTopProcesses() : [];
  if (expanded) await getNetworkStats();

  const data: SystemData = {
    cpuPct: cpu.total,
    corePcts: cpu.perCore,
    ramUsed,
    ramTotal,
    diskUsed: disk.used,
    diskTotal: disk.total,
    load,
    topProcs,
    netRxRate: netRxRate,
    netTxRate: netTxRate,
    uptimeStr: formatUptime(osUptime()),
  };

  const svg = expanded ? renderExpanded(data) : renderCompact(data);
  const svgBytes = encoder.encode(svg);

  const currentW = expanded ? EXPANDED_W : COMPACT_W;
  const currentH = expanded ? EXPANDED_H : COMPACT_H;

  if (firstRender) {
    // Position top-right
    if (panelX < 0) {
      const pos = computeTopRight();
      panelX = pos.x;
      panelY = pos.y;
    }

    writeMeta({
      id: PANEL_ID,
      type: "svg",
      position: "float",
      x: panelX,
      y: panelY,
      width: currentW,
      height: currentH,
      draggable: true,
      resizable: false,
      interactive: true,
      byteLength: svgBytes.byteLength,
    });
    firstRender = false;
  } else {
    writeMeta({
      id: PANEL_ID,
      type: "update",
      width: currentW,
      height: currentH,
      byteLength: svgBytes.byteLength,
    });
  }

  writeData(svg);
}

// ---------------------------------------------------------------------------
// Event handling
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
          // invalid JSON
        }
      }
    }
  } catch {
    // fd closed
  }
}

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  if (evtId === "__system__" && evtType === "error") {
    const code = (event["code"] as string) ?? "unknown";
    const message = (event["message"] as string) ?? "";
    const panelId = (event["panelId"] as string) ?? "";
    process.stderr.write(
      `[sysmon] sideband error: ${code}${panelId ? ` (${panelId})` : ""}${
        message ? ` — ${message}` : ""
      }\n`,
    );
    return;
  }

  // Terminal resize -> reposition to top-right
  if (evtId === "__terminal__" && evtType === "resize") {
    termCols = (event["cols"] as number) ?? termCols;
    termRows = (event["rows"] as number) ?? termRows;
    const pos = computeTopRight();
    panelX = pos.x;
    panelY = pos.y;
    const currentW = expanded ? EXPANDED_W : COMPACT_W;
    const currentH = expanded ? EXPANDED_H : COMPACT_H;
    writeMeta({
      id: PANEL_ID,
      type: "update",
      x: panelX,
      y: panelY,
      width: currentW,
      height: currentH,
    });
    return;
  }

  if (evtId !== PANEL_ID) return;

  switch (evtType) {
    case "close": {
      clearInterval(timer);
      console.log("\nSystem monitor closed.");
      process.exit(0);
      break;
    }

    case "dragend": {
      panelX = (event["x"] as number) ?? panelX;
      panelY = (event["y"] as number) ?? panelY;
      break;
    }

    case "click": {
      // Toggle expanded/compact
      expanded = !expanded;
      const currentW = expanded ? EXPANDED_W : COMPACT_W;
      const currentH = expanded ? EXPANDED_H : COMPACT_H;
      writeMeta({
        id: PANEL_ID,
        type: "update",
        width: currentW,
        height: currentH,
      });
      // Immediate re-render in new mode
      render();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log("System Monitor started.");
console.log("Click the widget to toggle expanded/compact view.");
console.log("Press Ctrl+C to exit.\n");

// Prime CPU deltas with an initial sample
getCpuUsage();

// Initial render
await render();

// Start update loop
const timer = setInterval(() => {
  render();
}, UPDATE_INTERVAL);

// Start event loop
readEvents();

// Cleanup on exit
process.on("SIGINT", () => {
  clearInterval(timer);
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\nSystem monitor stopped.");
  process.exit(0);
});
