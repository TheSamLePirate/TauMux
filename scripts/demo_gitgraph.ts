#!/usr/bin/env bun
/**
 * HyperTerm Canvas — Git Branch Graph
 *
 * Fullscreen interactive git commit graph with:
 * - colored branch rail visualization with merge edges
 * - commit list with hash, author, time, message, branch/tag badges
 * - keyboard and mouse navigation
 * - click-to-inspect commit detail panel
 * - live auto-refresh, close button
 *
 * Usage:
 *   bun scripts/demo_gitgraph.ts
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
// Constants
// ---------------------------------------------------------------------------

const PANEL_ID = "gitgraph";
const POLL_INTERVAL = 5000;
const HEADER_H = 44;
const SUMMARY_H = 34;
const FOOTER_H = 30;
const DETAIL_H = 68;
const ROW_H = 30;
const RAIL_W = 18;
const GRAPH_PAD = 10;
const NODE_R = 5;
const REFRESH_BTN_W = 88;
const REFRESH_BTN_H = 28;
const MAX_COMMITS = 200;
const ESTIMATED_CELL_W = 8.4;
const ESTIMATED_CELL_H = 17;

let viewportW = 1180;
let viewportH = 760;
let panelW = 1180;
let panelH = 760;

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
// Palette — Catppuccin Mocha
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
  pink: "#f5c2e7",
  sky: "#89dceb",
} as const;

const RAIL_COLORS = [
  C.blue,
  C.green,
  C.mauve,
  C.peach,
  C.pink,
  C.teal,
  C.yellow,
  C.red,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  message: string;
  decorations: string[];
  relTime: string;
  rail: number;
}

type HoveredControl = "close" | "refresh" | null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let commits: Commit[] = [];
let branchName = "";
let maxRail = 0;

let firstRender = true;
let scrollOffset = 0;
let selectedCommit: number | null = null;
let hoveredRowIndex: number | null = null;
let hoveredControl: HoveredControl = null;
let lastSignature = "";
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight = false;
let stdinHandler: ((data: Buffer) => void) | null = null;
let hasRealPixelSize = false;

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function graphW(): number {
  return GRAPH_PAD + (maxRail + 1) * RAIL_W + GRAPH_PAD;
}

function bodyH(): number {
  return Math.max(120, panelH - HEADER_H - SUMMARY_H - DETAIL_H - FOOTER_H);
}

function visibleCount(): number {
  return Math.max(1, Math.floor(bodyH() / ROW_H));
}

function railX(rail: number): number {
  return GRAPH_PAD + rail * RAIL_W + RAIL_W / 2;
}

function railColor(rail: number): string {
  return RAIL_COLORS[rail % RAIL_COLORS.length];
}

function clampScroll(): void {
  const max = Math.max(0, commits.length - visibleCount());
  scrollOffset = clamp(scrollOffset, 0, max);
}

// ---------------------------------------------------------------------------
// Viewport management (pixel-perfect, same pattern as gitdiff)
// ---------------------------------------------------------------------------

function applyViewportSize(nextW: number, nextH: number): boolean {
  const safeW = Math.max(360, Math.round(nextW));
  const safeH = Math.max(220, Math.round(nextH));
  const changed =
    safeW !== viewportW ||
    safeH !== viewportH ||
    safeW !== panelW ||
    safeH !== panelH;
  viewportW = safeW;
  viewportH = safeH;
  panelW = safeW;
  panelH = safeH;
  clampScroll();
  return changed;
}

function syncPanelSizeFromTerminal(): boolean {
  if (hasRealPixelSize) return false;
  const cols = process.stdout.isTTY ? (process.stdout.columns ?? 0) : 0;
  const rows = process.stdout.isTTY ? (process.stdout.rows ?? 0) : 0;
  const nextW = cols > 0 ? cols * ESTIMATED_CELL_W : 1180;
  const nextH = rows > 0 ? rows * ESTIMATED_CELL_H : 760;
  return applyViewportSize(nextW, nextH);
}

function syncPanelSizeFromEvent(event: Record<string, unknown>): boolean {
  const pxW = event["pxWidth"];
  const pxH = event["pxHeight"];
  const hasPx = typeof pxW === "number" && typeof pxH === "number";
  if (!hasPx && hasRealPixelSize) return false;
  if (hasPx) hasRealPixelSize = true;
  const cols = event["cols"];
  const rows = event["rows"];
  const nextW = hasPx
    ? (pxW as number)
    : typeof cols === "number"
      ? cols * ESTIMATED_CELL_W
      : viewportW;
  const nextH = hasPx
    ? (pxH as number)
    : typeof rows === "number"
      ? rows * ESTIMATED_CELL_H
      : viewportH;
  return applyViewportSize(nextW, nextH);
}

const RESIZE_DEBOUNCE_MS = 100;
let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResizeEvent: Record<string, unknown> | null = null;

function scheduleDebouncedResize(event: Record<string, unknown>): void {
  pendingResizeEvent = event;
  if (resizeDebounceTimer !== null) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    resizeDebounceTimer = null;
    const evt = pendingResizeEvent;
    pendingResizeEvent = null;
    if (evt && syncPanelSizeFromEvent(evt)) {
      render(true);
    }
  }, RESIZE_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function runGit(
  args: string[],
): Promise<{ stdout: string; code: number }> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, code };
  } catch {
    return { stdout: "", code: 1 };
  }
}

async function isGitRepo(): Promise<boolean> {
  const r = await runGit(["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

async function getCurrentBranch(): Promise<string> {
  const r = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : "unknown";
}

async function fetchCommits(): Promise<string> {
  const SEP = "\x1f"; // unit separator, safe delimiter
  const fmt = `%H${SEP}%h${SEP}%P${SEP}%an${SEP}%s${SEP}%d${SEP}%ar`;
  const r = await runGit([
    "log",
    "--all",
    `--format=${fmt}`,
    `-${MAX_COMMITS}`,
  ]);

  const lines = r.stdout
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
  const list: Commit[] = [];

  for (const line of lines) {
    const parts = line.split(SEP);
    if (parts.length < 7) continue;

    const parents = parts[2].length > 0 ? parts[2].split(" ") : [];
    const decoRaw = parts[5].trim();
    const decorations: string[] = [];
    if (decoRaw.length > 0) {
      const inner = decoRaw.replace(/^\s*\(\s*/, "").replace(/\s*\)\s*$/, "");
      if (inner.length > 0) {
        for (const d of inner.split(",")) {
          const t = d.trim();
          if (t.length > 0) decorations.push(t);
        }
      }
    }

    list.push({
      hash: parts[0],
      shortHash: parts[1],
      parents,
      author: parts[3],
      message: parts[4],
      decorations,
      relTime: parts[6],
      rail: 0,
    });
  }

  assignRails(list);
  commits = list;

  const sig = hashString(lines.join("\n"));
  return sig;
}

// ---------------------------------------------------------------------------
// Rail assignment (lane allocation algorithm)
// ---------------------------------------------------------------------------

function assignRails(list: Commit[]): void {
  const hashToRail = new Map<string, number>();
  const activeRails = new Set<number>();
  maxRail = 0;

  function nextFreeRail(): number {
    let r = 0;
    while (activeRails.has(r)) r++;
    return r;
  }

  for (const commit of list) {
    if (hashToRail.has(commit.hash)) {
      commit.rail = hashToRail.get(commit.hash)!;
    } else {
      commit.rail = nextFreeRail();
      activeRails.add(commit.rail);
    }
    if (commit.rail > maxRail) maxRail = commit.rail;

    if (commit.parents.length === 0) {
      activeRails.delete(commit.rail);
    } else if (commit.parents.length === 1) {
      const ph = commit.parents[0];
      if (hashToRail.has(ph)) {
        if (hashToRail.get(ph) !== commit.rail) activeRails.delete(commit.rail);
      } else {
        hashToRail.set(ph, commit.rail);
      }
    } else {
      const [first, second] = commit.parents;
      if (!hashToRail.has(first)) {
        hashToRail.set(first, commit.rail);
      } else if (hashToRail.get(first) !== commit.rail) {
        activeRails.delete(commit.rail);
      }
      if (second && !hashToRail.has(second)) {
        const nr = nextFreeRail();
        hashToRail.set(second, nr);
        activeRails.add(nr);
        if (nr > maxRail) maxRail = nr;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function computeStats(): { branches: number; tags: number; merges: number } {
  const branchSet = new Set<string>();
  let tags = 0;
  let merges = 0;
  for (const c of commits) {
    if (c.parents.length > 1) merges++;
    for (const d of c.decorations) {
      if (d.startsWith("tag: ")) tags++;
      else if (d !== "HEAD" && !d.startsWith("HEAD ->")) {
        branchSet.add(d.replace("HEAD -> ", "").replace(/^origin\//, ""));
      }
    }
  }
  return { branches: branchSet.size, tags, merges };
}

// ---------------------------------------------------------------------------
// Decoration styling
// ---------------------------------------------------------------------------

function decoStyle(deco: string): { label: string; color: string } {
  if (deco.startsWith("HEAD -> "))
    return { label: deco.replace("HEAD -> ", ""), color: C.yellow };
  if (deco === "HEAD") return { label: "HEAD", color: C.yellow };
  if (deco.startsWith("tag: "))
    return { label: deco.replace("tag: ", ""), color: C.peach };
  if (deco.startsWith("origin/")) return { label: deco, color: C.teal };
  return { label: deco, color: C.green };
}

// ---------------------------------------------------------------------------
// Rendering — buttons
// ---------------------------------------------------------------------------

function renderButton(label: string, accent: string, hovered: boolean): string {
  const bg = hovered ? `${accent}26` : "rgba(49,50,68,0.88)";
  const border = hovered ? `${accent}88` : C.surface1;
  const color = hovered ? accent : C.text;
  const shadow = hovered
    ? `0 0 0 1px ${accent}22 inset, 0 8px 24px ${accent}18`
    : "none";
  return `<div style="width:${REFRESH_BTN_W}px;height:${REFRESH_BTN_H}px;background:${bg};border:1px solid ${border};border-radius:9px;display:flex;align-items:center;justify-content:center;color:${color};font-size:11px;font-weight:700;letter-spacing:0.02em;box-shadow:${shadow};cursor:pointer;">${label}</div>`;
}

function renderCloseButton(hovered: boolean): string {
  const size = REFRESH_BTN_H;
  const bg = hovered ? `${C.red}26` : "rgba(49,50,68,0.88)";
  const border = hovered ? `${C.red}88` : C.surface1;
  const color = hovered ? C.red : C.overlay0;
  const shadow = hovered
    ? `0 0 0 1px ${C.red}22 inset, 0 8px 24px ${C.red}18`
    : "none";
  return `<div style="width:${size}px;height:${size}px;background:${bg};border:1px solid ${border};border-radius:9px;display:flex;align-items:center;justify-content:center;color:${color};font-size:14px;font-weight:700;box-shadow:${shadow};cursor:pointer;line-height:1;">&times;</div>`;
}

// ---------------------------------------------------------------------------
// Rendering — graph SVG
// ---------------------------------------------------------------------------

function renderGraphSvg(): string {
  const count = visibleCount();
  const visible = commits.slice(scrollOffset, scrollOffset + count);
  const gW = graphW();
  const gH = count * ROW_H;

  const hashToGlobalIdx = new Map<string, number>();
  for (let i = 0; i < commits.length; i++)
    hashToGlobalIdx.set(commits[i].hash, i);

  // Rail guides
  const guides: string[] = [];
  for (let r = 0; r <= maxRail; r++) {
    const rx = railX(r);
    guides.push(
      `<line x1="${rx}" y1="0" x2="${rx}" y2="${gH}" stroke="${railColor(r)}" stroke-width="1" stroke-opacity="0.1"/>`,
    );
  }

  // Edges
  const edges: string[] = [];
  for (let vi = 0; vi < visible.length; vi++) {
    const commit = visible[vi];
    const cy = vi * ROW_H + ROW_H / 2;
    const cx = railX(commit.rail);
    const color = railColor(commit.rail);

    for (const parentHash of commit.parents) {
      const pIdx = hashToGlobalIdx.get(parentHash);
      if (pIdx === undefined) continue;
      const parent = commits[pIdx];
      const pvi = pIdx - scrollOffset;
      if (pvi < -1 || pvi > count + 1) continue;

      const pcy =
        pvi >= 0 && pvi < count
          ? pvi * ROW_H + ROW_H / 2
          : pvi < 0
            ? -ROW_H / 2
            : gH + ROW_H / 2;
      const pcx = railX(parent.rail);
      const eColor =
        commit.parents.indexOf(parentHash) === 0
          ? color
          : railColor(parent.rail);

      if (commit.rail === parent.rail) {
        edges.push(
          `<line x1="${cx}" y1="${cy}" x2="${pcx}" y2="${pcy}" stroke="${eColor}" stroke-width="2" stroke-opacity="0.5"/>`,
        );
      } else {
        const midY = (cy + pcy) / 2;
        edges.push(
          `<path d="M${cx},${cy} C${cx},${midY} ${pcx},${midY} ${pcx},${pcy}" fill="none" stroke="${eColor}" stroke-width="2" stroke-opacity="0.4"/>`,
        );
      }
    }
  }

  // Nodes
  const nodes: string[] = [];
  for (let vi = 0; vi < visible.length; vi++) {
    const commit = visible[vi];
    const globalIdx = scrollOffset + vi;
    const cy = vi * ROW_H + ROW_H / 2;
    const cx = railX(commit.rail);
    const color = railColor(commit.rail);
    const isSel = selectedCommit === globalIdx;
    const isHov = hoveredRowIndex === globalIdx;
    const isMerge = commit.parents.length > 1;
    const isHead = commit.decorations.some((d) => d.startsWith("HEAD"));

    const nr = isMerge ? NODE_R + 1.5 : NODE_R;
    const sw = isSel ? 2.5 : isHov ? 2 : 1.5;
    const fill = isSel ? color : C.base;

    if (isHead) {
      nodes.push(
        `<circle cx="${cx}" cy="${cy}" r="${nr + 4}" fill="none" stroke="${C.yellow}" stroke-width="1.5" stroke-dasharray="3,2" stroke-opacity="0.7"/>`,
      );
    }
    nodes.push(
      `<circle cx="${cx}" cy="${cy}" r="${nr}" fill="${fill}" stroke="${color}" stroke-width="${sw}"/>`,
    );
  }

  return `<svg width="${gW}" height="${gH}" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
    <defs><clipPath id="gc"><rect x="0" y="0" width="${gW}" height="${gH}"/></clipPath></defs>
    <g clip-path="url(#gc)">${guides.join("")}${edges.join("")}${nodes.join("")}</g>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Rendering — commit rows
// ---------------------------------------------------------------------------

function renderCommitRows(): string {
  const count = visibleCount();
  const visible = commits.slice(scrollOffset, scrollOffset + count);
  const textW = panelW - graphW() - 12;

  if (visible.length === 0) {
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;opacity:0.6;">
      <div style="font-size:28px;">&#x2B2C;</div>
      <div style="font-size:13px;color:${C.subtext0};font-weight:600;">No commits to display</div>
    </div>`;
  }

  return visible
    .map((commit, vi) => {
      const globalIdx = scrollOffset + vi;
      const isSel = selectedCommit === globalIdx;
      const isHov = hoveredRowIndex === globalIdx;
      const color = railColor(commit.rail);

      const bg = isSel
        ? `linear-gradient(90deg, ${color}22, ${color}08)`
        : isHov
          ? "rgba(137,180,250,0.08)"
          : globalIdx % 2 === 0
            ? "transparent"
            : "rgba(17,17,27,0.3)";
      const leftBorder = isSel
        ? `box-shadow:inset 3px 0 0 ${color};`
        : isHov
          ? `box-shadow:inset 2px 0 0 ${C.mauve};`
          : "";

      const hashColor = isSel ? C.blue : C.lavender;
      const authorMax = Math.max(8, Math.floor((textW * 0.15) / 7));
      const msgMax = Math.max(12, Math.floor((textW - 300) / 7));

      // Decoration badges
      let badges = "";
      if (commit.decorations.length > 0) {
        badges = commit.decorations
          .map((d) => {
            const s = decoStyle(d);
            return `<span style="font-size:9px;color:${s.color};background:${s.color}18;border:1px solid ${s.color}44;border-radius:999px;padding:1px 6px;white-space:nowrap;">${escapeHtml(s.label)}</span>`;
          })
          .join("");
      }

      return `<div style="height:${ROW_H}px;display:flex;align-items:center;gap:10px;padding:0 10px;background:${bg};${leftBorder}cursor:pointer;overflow:hidden;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:11px;">
      <span style="color:${hashColor};font-weight:600;flex-shrink:0;width:62px;">${escapeHtml(commit.shortHash)}</span>
      <span style="color:${C.subtext0};flex-shrink:0;width:${Math.max(60, authorMax * 7)}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncate(commit.author, authorMax))}</span>
      <span style="color:${C.overlay0};flex-shrink:0;width:70px;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(commit.relTime)}</span>
      <span style="color:${C.text};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncate(commit.message, msgMax))}</span>
      <span style="display:flex;gap:4px;flex-shrink:0;align-items:center;">${badges}</span>
    </div>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Rendering — scrollbar
// ---------------------------------------------------------------------------

function renderScrollbar(): string {
  if (commits.length <= visibleCount()) return "";
  const trackH = bodyH() - 16;
  const ratio = visibleCount() / commits.length;
  const thumbH = Math.max(20, Math.round(trackH * ratio));
  const scrollRange = Math.max(1, commits.length - visibleCount());
  const thumbY = Math.round((scrollOffset / scrollRange) * (trackH - thumbH));

  return `<div style="position:absolute;right:4px;top:8px;width:5px;height:${trackH}px;background:${C.surface0};border-radius:999px;opacity:0.5;">
    <div style="position:absolute;left:0;right:0;top:${thumbY}px;height:${thumbH}px;background:${C.blue};border-radius:999px;opacity:0.7;"></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Rendering — detail panel
// ---------------------------------------------------------------------------

function renderDetail(): string {
  if (
    selectedCommit !== null &&
    selectedCommit >= 0 &&
    selectedCommit < commits.length
  ) {
    const c = commits[selectedCommit];
    const color = railColor(c.rail);
    const isMerge = c.parents.length > 1;
    const parentStr = c.parents.map((p) => p.slice(0, 7)).join(", ");
    const decoStr = c.decorations
      .map((d) => {
        const s = decoStyle(d);
        return `<span style="color:${s.color};font-weight:600;">${escapeHtml(s.label)}</span>`;
      })
      .join(`<span style="color:${C.surface2};"> · </span>`);

    return `<div style="height:${DETAIL_H}px;background:linear-gradient(180deg, rgba(24,24,37,0.98), rgba(17,17,27,0.96));border-top:1px solid ${C.surface1};padding:10px 16px;overflow:hidden;display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:8px;height:8px;border-radius:999px;background:${color};flex-shrink:0;"></div>
        <span style="font-family:monospace;font-size:12px;color:${C.blue};font-weight:700;">${escapeHtml(c.hash)}</span>
        ${isMerge ? `<span style="font-size:10px;color:${C.mauve};background:${C.mauve}18;border:1px solid ${C.mauve}44;border-radius:999px;padding:1px 6px;">merge</span>` : ""}
        <span style="font-size:10px;color:${C.overlay0};margin-left:auto;">${escapeHtml(c.relTime)}</span>
      </div>
      <div style="font-size:12px;color:${C.text};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.message)}</div>
      <div style="display:flex;align-items:center;gap:12px;font-size:10px;color:${C.overlay0};overflow:hidden;">
        <span>${escapeHtml(c.author)}</span>
        <span style="color:${C.surface2};">|</span>
        <span>parents: <span style="color:${C.lavender};">${parentStr || "none (root)"}</span></span>
        ${decoStr ? `<span style="color:${C.surface2};">|</span>${decoStr}` : ""}
      </div>
    </div>`;
  }

  return `<div style="height:${DETAIL_H}px;background:linear-gradient(180deg, rgba(24,24,37,0.98), rgba(17,17,27,0.96));border-top:1px solid ${C.surface1};display:flex;align-items:center;justify-content:center;">
    <span style="font-size:11px;color:${C.overlay0};">Click a commit or press Enter to inspect</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// Rendering — footer
// ---------------------------------------------------------------------------

function footerStatusText(): string {
  if (hoveredControl === "close") return "Close Git Graph";
  if (hoveredControl === "refresh") return "Refresh commit history";

  if (
    hoveredRowIndex !== null &&
    hoveredRowIndex >= 0 &&
    hoveredRowIndex < commits.length
  ) {
    const c = commits[hoveredRowIndex];
    const decos =
      c.decorations.length > 0 ? ` · ${c.decorations.join(", ")}` : "";
    return `${c.shortHash} · ${c.author} · ${c.relTime}${decos}`;
  }

  if (commits.length > 0) {
    const total = commits.length;
    const pos = `${scrollOffset + 1}–${Math.min(scrollOffset + visibleCount(), total)} of ${total}`;
    const pct = `${Math.round(((scrollOffset + visibleCount()) / total) * 100)}%`;
    return `${pos} (${pct})`;
  }

  return "j/k navigate · Enter inspect · space/b page · g/G top/bottom · r refresh · q quit";
}

// ---------------------------------------------------------------------------
// Rendering — main page
// ---------------------------------------------------------------------------

function buildPage(): string {
  clampScroll();
  const stats = computeStats();

  const summaryParts = [
    `${commits.length} commits`,
    stats.branches > 0 ? `${stats.branches} branches` : "",
    stats.tags > 0 ? `${stats.tags} tags` : "",
    stats.merges > 0 ? `${stats.merges} merges` : "",
  ]
    .filter(Boolean)
    .join(` <span style="color:${C.surface2};">·</span> `);

  return `<div style="width:${panelW}px;height:${panelH}px;background:${C.base};color:${C.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;overflow:hidden;display:flex;flex-direction:column;user-select:none;">
    <style>* { box-sizing: border-box; }</style>

    <div style="height:${HEADER_H}px;background:linear-gradient(180deg, rgba(49,50,68,0.98), rgba(30,30,46,0.98));border-bottom:1px solid ${C.surface1};display:flex;align-items:center;justify-content:space-between;padding:0 16px;flex-shrink:0;box-shadow:0 10px 30px rgba(0,0,0,0.16);">
      <div style="display:flex;align-items:center;gap:12px;min-width:0;">
        <div style="width:12px;height:12px;border-radius:999px;background:${C.mauve};box-shadow:0 0 18px ${C.mauve}88;"></div>
        <div style="display:flex;flex-direction:column;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:15px;font-weight:800;color:${C.text};">Git Graph</span>
            <span style="font-size:11px;color:${C.blue};background:${C.blue}18;border:1px solid ${C.blue}44;border-radius:999px;padding:2px 8px;flex-shrink:0;">${escapeHtml(branchName)}</span>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        ${renderButton("Refresh", C.blue, hoveredControl === "refresh")}
        ${renderCloseButton(hoveredControl === "close")}
      </div>
    </div>

    <div style="height:${SUMMARY_H}px;background:linear-gradient(90deg, rgba(203,166,247,0.12), rgba(137,180,250,0.06));border-bottom:1px solid ${C.surface1};display:flex;align-items:center;padding:0 16px;flex-shrink:0;font-size:11px;">
      <span>${summaryParts}</span>
    </div>

    <div style="position:relative;height:${bodyH()}px;display:flex;overflow:hidden;background:linear-gradient(180deg, rgba(30,30,46,0.98), rgba(17,17,27,0.98));">
      <div style="flex-shrink:0;overflow:hidden;">${renderGraphSvg()}</div>
      <div style="flex:1;overflow:hidden;">${renderCommitRows()}</div>
      ${renderScrollbar()}
    </div>

    ${renderDetail()}

    <div style="height:${FOOTER_H}px;background:linear-gradient(180deg, rgba(49,50,68,0.96), rgba(49,50,68,1));border-top:1px solid ${C.surface1};display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:10px;color:${C.overlay0};flex-shrink:0;gap:16px;">
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(footerStatusText())}</span>
      <span style="flex-shrink:0;">updated ${formatTime(new Date())}</span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Rendering — panel output
// ---------------------------------------------------------------------------

function render(force = false): void {
  syncPanelSizeFromTerminal();
  const html = buildPage();
  const bytes = encoder.encode(html);
  const panelX = Math.max(0, Math.round((viewportW - panelW) / 2));

  if (firstRender) {
    writeMeta({
      id: PANEL_ID,
      type: "html",
      position: "fixed",
      x: panelX,
      y: 0,
      width: panelW,
      height: panelH,
      interactive: true,
      draggable: false,
      resizable: false,
      borderRadius: 0,
      byteLength: bytes.byteLength,
    });
    firstRender = false;
  } else {
    writeMeta({
      id: PANEL_ID,
      type: "update",
      byteLength: bytes.byteLength,
      ...(force ? { x: panelX, y: 0, width: panelW, height: panelH } : {}),
    });
  }

  writeData(html);
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

type HitResult =
  | { area: "close" }
  | { area: "refresh" }
  | { area: "commit-row"; index: number }
  | { area: "graph" }
  | { area: "none" };

function hitTest(x: number, y: number): HitResult {
  // Header buttons
  if (y < HEADER_H) {
    const closeSize = REFRESH_BTN_H;
    const closeX = panelW - 16 - closeSize;
    const closeY = Math.round((HEADER_H - closeSize) / 2);
    if (
      y >= closeY &&
      y < closeY + closeSize &&
      x >= closeX &&
      x < closeX + closeSize
    ) {
      return { area: "close" };
    }
    const refreshX = closeX - 8 - REFRESH_BTN_W;
    const refreshY = Math.round((HEADER_H - REFRESH_BTN_H) / 2);
    if (
      y >= refreshY &&
      y < refreshY + REFRESH_BTN_H &&
      x >= refreshX &&
      x < refreshX + REFRESH_BTN_W
    ) {
      return { area: "refresh" };
    }
    return { area: "none" };
  }

  // Body area (after header + summary)
  const bodyTop = HEADER_H + SUMMARY_H;
  const bodyBottom = bodyTop + bodyH();
  if (y >= bodyTop && y < bodyBottom) {
    const localY = y - bodyTop;
    const rowIdx = scrollOffset + Math.floor(localY / ROW_H);
    if (rowIdx >= 0 && rowIdx < commits.length) {
      return { area: "commit-row", index: rowIdx };
    }
    return { area: "graph" };
  }

  return { area: "none" };
}

function updateHoverState(hit: HitResult): boolean {
  const before = `${hoveredRowIndex ?? ""}|${hoveredControl ?? ""}`;
  hoveredRowIndex = null;
  hoveredControl = null;

  switch (hit.area) {
    case "close":
    case "refresh":
      hoveredControl = hit.area;
      break;
    case "commit-row":
      if (hit.index >= 0 && hit.index < commits.length)
        hoveredRowIndex = hit.index;
      break;
  }

  return before !== `${hoveredRowIndex ?? ""}|${hoveredControl ?? ""}`;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function selectCommit(index: number | null): void {
  selectedCommit = index;
  render(true);
}

function moveSelection(delta: number): void {
  if (commits.length === 0) return;

  if (selectedCommit === null) {
    selectedCommit = scrollOffset;
  } else {
    selectedCommit = clamp(selectedCommit + delta, 0, commits.length - 1);
  }

  // Ensure visible
  if (selectedCommit < scrollOffset) scrollOffset = selectedCommit;
  else if (selectedCommit >= scrollOffset + visibleCount())
    scrollOffset = selectedCommit - visibleCount() + 1;
  clampScroll();
  render(true);
}

function scrollBy(delta: number): void {
  scrollOffset += delta;
  clampScroll();
  render(true);
}

function pageScroll(direction: 1 | -1): void {
  scrollBy(direction * Math.max(1, visibleCount() - 2));
}

function jumpToDecorated(direction: 1 | -1): void {
  const start = selectedCommit ?? scrollOffset;
  let i = start + direction;
  while (i >= 0 && i < commits.length) {
    if (commits[i].decorations.length > 0) {
      selectedCommit = i;
      if (i < scrollOffset) scrollOffset = i;
      else if (i >= scrollOffset + visibleCount())
        scrollOffset = i - visibleCount() + 1;
      clampScroll();
      render(true);
      return;
    }
    i += direction;
  }
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

async function refreshModel(forceRender = false): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;

  try {
    const sizeChanged = syncPanelSizeFromTerminal();
    const previousHash =
      selectedCommit !== null ? commits[selectedCommit]?.hash : null;
    branchName = await getCurrentBranch();
    const sig = await fetchCommits();

    if (previousHash) {
      const newIdx = commits.findIndex((c) => c.hash === previousHash);
      selectedCommit = newIdx >= 0 ? newIdx : null;
    }
    clampScroll();

    if (forceRender || sizeChanged || sig !== lastSignature) {
      lastSignature = sig;
      render(true);
    }
  } catch {
    /* refresh failed */
  } finally {
    refreshInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (resizeDebounceTimer !== null) {
    clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = null;
  }
  if (stdinHandler) {
    process.stdin.off("data", stdinHandler);
    stdinHandler = null;
  }
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    /* ignore */
  }
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\nGit Graph closed.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

function handleKeyByte(byte: number): boolean {
  switch (byte) {
    case 0x03: // Ctrl+C
    case 0x71: // q
      cleanup();
      return true;
    case 0x6a: // j
      moveSelection(1);
      return true;
    case 0x6b: // k
      moveSelection(-1);
      return true;
    case 0x0d: // Enter — toggle selection
      if (selectedCommit !== null) selectCommit(null);
      else if (commits.length > 0) selectCommit(scrollOffset);
      return true;
    case 0x6e: // n
      jumpToDecorated(1);
      return true;
    case 0x70: // p
      jumpToDecorated(-1);
      return true;
    case 0x72: // r
      refreshModel(true);
      return true;
    case 0x20: // space
      pageScroll(1);
      return true;
    case 0x62: // b
      pageScroll(-1);
      return true;
    case 0x67: // g
      scrollOffset = 0;
      clampScroll();
      render(true);
      return true;
    case 0x47: // G
      scrollOffset = Number.MAX_SAFE_INTEGER;
      clampScroll();
      render(true);
      return true;
    case 0x1b:
      return true; // Esc
  }
  return false;
}

function startStdinReader(): void {
  if (!process.stdin.isTTY) return;
  try {
    process.stdin.setRawMode(true);
  } catch {
    return;
  }

  stdinHandler = (data: Buffer) => {
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];

      // Arrow keys: ESC [ A/B
      if (byte === 0x1b && i + 2 < data.length && data[i + 1] === 0x5b) {
        const arrow = data[i + 2];
        i += 2;
        if (arrow === 0x41) {
          moveSelection(-1);
          continue;
        } // Up
        if (arrow === 0x42) {
          moveSelection(1);
          continue;
        } // Down
        continue;
      }

      handleKeyByte(byte);
    }
  };

  process.stdin.resume();
  process.stdin.on("data", stdinHandler);
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  if (evtId === "__system__" && evtType === "error") {
    const code = (event["code"] as string) ?? "unknown";
    const message = (event["message"] as string) ?? "";
    const panelId = (event["panelId"] as string) ?? "";
    process.stderr.write(
      `[gitgraph] sideband error: ${code}${panelId ? ` (${panelId})` : ""}${
        message ? ` — ${message}` : ""
      }\n`,
    );
    return;
  }

  if (evtId === "__terminal__" && evtType === "resize") {
    scheduleDebouncedResize(event);
    return;
  }

  if (evtId !== PANEL_ID) return;

  const x = (event["x"] as number) ?? 0;
  const y = (event["y"] as number) ?? 0;

  switch (evtType) {
    case "click": {
      const hit = hitTest(x, y);
      updateHoverState(hit);
      if (hit.area === "close") {
        cleanup();
        return;
      }
      if (hit.area === "refresh") {
        refreshModel(true);
        return;
      }
      if (hit.area === "commit-row") {
        selectedCommit = selectedCommit === hit.index ? null : hit.index;
        render(true);
        return;
      }
      break;
    }

    case "mousemove":
    case "mouseenter": {
      const hit = hitTest(x, y);
      if (updateHoverState(hit)) render();
      break;
    }

    case "mouseleave": {
      hoveredRowIndex = null;
      hoveredControl = null;
      render();
      break;
    }

    case "wheel": {
      const deltaY = (event["deltaY"] as number) ?? 0;
      const step = deltaY > 0 ? 3 : -3;
      scrollBy(step);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Event reader
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
          /* invalid */
        }
      }
    }
  } catch {
    /* fd closed */
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

if (!(await isGitRepo())) {
  console.error("Error: not inside a git repository.");
  process.exit(1);
}

syncPanelSizeFromTerminal();
void readEvents();

branchName = await getCurrentBranch();
const sig = await fetchCommits();
lastSignature = sig;

if (commits.length === 0) {
  console.error("No commits found.");
  process.exit(1);
}

const initStats = computeStats();
console.log("Git Graph");
console.log(
  `${commits.length} commits · ${initStats.branches} branches · ${initStats.tags} tags`,
);
console.log(
  "j/k or arrows navigate · Enter inspect · n/p jump branches · space/b page · q quit\n",
);

render(true);
startStdinReader();
refreshTimer = setInterval(() => {
  refreshModel();
}, POLL_INTERVAL);

process.on("SIGWINCH", () => {
  if (syncPanelSizeFromTerminal()) render(true);
});
if (process.stdout.isTTY) {
  process.stdout.on("resize", () => {
    if (syncPanelSizeFromTerminal()) render(true);
  });
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
