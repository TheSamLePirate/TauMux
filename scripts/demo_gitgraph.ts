#!/usr/bin/env bun
/**
 * HyperTerm Canvas — Git Branch Graph Visualizer
 *
 * Renders the commit history of the current git repository as a colored
 * branch graph in a floating SVG panel. Commits are laid out on rails
 * (columns), with merge edges curving between rails. Supports wheel
 * scrolling, click-to-inspect, and resize.
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
  pink: "#f5c2e7",
} as const;

// Branch colors — assigned round-robin per rail
const RAIL_COLORS = [
  C.blue,
  C.green,
  C.yellow,
  C.red,
  C.pink,
  C.teal,
  C.peach,
  C.mauve,
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PANEL_ID = "gitgraph";
const ROW_H = 30;
const HEADER_H = 36;
const DETAIL_H = 50;
const RAIL_W = 20;
const GRAPH_LEFT = 12;
const NODE_R = 5;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  message: string;
  decorations: string[];
  rail: number;
}

let commits: Commit[] = [];
let branchName = "";
let scrollOffset = 0;
let selectedCommit: number | null = null;
let panelW = 750;
let panelH = 550;
let maxRail = 0;

// ---------------------------------------------------------------------------
// Git data collection
// ---------------------------------------------------------------------------

async function isGitRepo(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text.trim() === "true";
  } catch {
    return false;
  }
}

async function getCurrentBranch(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text.trim();
  } catch {
    return "unknown";
  }
}

async function fetchCommits(): Promise<void> {
  try {
    const proc = Bun.spawn(
      ["git", "log", "--all", "--format=%H|%h|%P|%an|%s|%d", "-50"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited;

    const lines = text
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    const rawCommits: Commit[] = [];

    for (const line of lines) {
      // Format: fullHash|shortHash|parentHashes|author|message|decorations
      const parts = line.split("|");
      if (parts.length < 6) continue;

      const hash = parts[0];
      const shortHash = parts[1];
      const parentStr = parts[2];
      const author = parts[3];
      const message = parts[4];
      // Decorations might contain | in branch names, rejoin the rest
      const decoRaw = parts.slice(5).join("|").trim();

      const parents = parentStr.length > 0 ? parentStr.split(" ") : [];

      // Parse decorations: " (HEAD -> main, origin/main)"
      const decorations: string[] = [];
      if (decoRaw.length > 0) {
        const inner = decoRaw.replace(/^\s*\(\s*/, "").replace(/\s*\)\s*$/, "");
        if (inner.length > 0) {
          for (const d of inner.split(",")) {
            const trimmed = d.trim();
            if (trimmed.length > 0) {
              decorations.push(trimmed);
            }
          }
        }
      }

      rawCommits.push({
        hash,
        shortHash,
        parents,
        author,
        message,
        decorations,
        rail: 0,
      });
    }

    // Assign rails using a lane allocation algorithm
    assignRails(rawCommits);
    commits = rawCommits;
  } catch {
    commits = [];
  }
}

/**
 * Assign each commit to a rail (column) in the graph.
 *
 * We process commits top-to-bottom (newest first, as git log outputs them).
 * Each commit occupies a rail. When a commit has multiple parents (merge),
 * the second parent gets assigned to a new or reused rail. Rails are freed
 * when a commit's last child has been processed.
 */
function assignRails(list: Commit[]): void {
  // Build lookup: hash -> index
  const hashToIdx = new Map<string, number>();
  for (let i = 0; i < list.length; i++) {
    hashToIdx.set(list[i].hash, i);
  }

  // Track which rail each hash is expected to appear on
  const hashToRail = new Map<string, number>();
  // Track which rails are currently active (occupied)
  const activeRails = new Set<number>();
  maxRail = 0;

  function nextFreeRail(): number {
    let r = 0;
    while (activeRails.has(r)) r++;
    return r;
  }

  for (let i = 0; i < list.length; i++) {
    const commit = list[i];

    // If this commit was already assigned a rail (by a child), use it
    if (hashToRail.has(commit.hash)) {
      commit.rail = hashToRail.get(commit.hash)!;
    } else {
      // First commit or unreferenced: assign next free rail
      commit.rail = nextFreeRail();
      activeRails.add(commit.rail);
    }

    if (commit.rail > maxRail) maxRail = commit.rail;

    // Process parents
    if (commit.parents.length === 0) {
      // Root commit: free the rail
      activeRails.delete(commit.rail);
    } else if (commit.parents.length === 1) {
      const parentHash = commit.parents[0];
      if (hashToRail.has(parentHash)) {
        // Parent already assigned by another child — free our rail if different
        const parentRail = hashToRail.get(parentHash)!;
        if (parentRail !== commit.rail) {
          activeRails.delete(commit.rail);
        }
      } else {
        // Pass our rail to the parent
        hashToRail.set(parentHash, commit.rail);
      }
    } else {
      // Merge commit: first parent inherits our rail, second parent gets a new rail
      const firstParent = commit.parents[0];
      const secondParent = commit.parents[1];

      if (!hashToRail.has(firstParent)) {
        hashToRail.set(firstParent, commit.rail);
      } else {
        // First parent already has a rail from another child
        const existingRail = hashToRail.get(firstParent)!;
        if (existingRail !== commit.rail) {
          activeRails.delete(commit.rail);
        }
      }

      if (!hashToRail.has(secondParent)) {
        const newRail = nextFreeRail();
        hashToRail.set(secondParent, newRail);
        activeRails.add(newRail);
        if (newRail > maxRail) maxRail = newRail;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function railColor(rail: number): string {
  return RAIL_COLORS[rail % RAIL_COLORS.length];
}

function railX(rail: number): number {
  return GRAPH_LEFT + rail * RAIL_W + RAIL_W / 2;
}

// ---------------------------------------------------------------------------
// Visible range
// ---------------------------------------------------------------------------

function graphAreaH(): number {
  return panelH - HEADER_H - DETAIL_H;
}

function visibleCount(): number {
  return Math.floor(graphAreaH() / ROW_H);
}

function clampScroll(): void {
  const maxOffset = Math.max(0, commits.length - visibleCount());
  scrollOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
}

function commitY(visibleIdx: number): number {
  return HEADER_H + visibleIdx * ROW_H + ROW_H / 2;
}

// ---------------------------------------------------------------------------
// Text area start (after the graph rails)
// ---------------------------------------------------------------------------

function textStartX(): number {
  return GRAPH_LEFT + (maxRail + 1) * RAIL_W + 14;
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

function renderSvg(): string {
  clampScroll();
  const count = visibleCount();
  const visible = commits.slice(scrollOffset, scrollOffset + count);

  // Build a hash->row map for the full commit list for edge drawing
  const hashToGlobalIdx = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashToGlobalIdx.set(commits[i].hash, i);
  }

  // --- Header ---
  const decorations =
    commits.length > 0 ? commits.flatMap((c) => c.decorations) : [];
  const branchCount = new Set(
    decorations
      .filter((d) => !d.startsWith("tag:") && d !== "HEAD")
      .map((d) => d.replace("HEAD -> ", "").replace(/^origin\//, "")),
  ).size;

  const headerSvg = `
    <rect x="0" y="0" width="${panelW}" height="${HEADER_H}" fill="${C.surface0}"/>
    <line x1="0" y1="${HEADER_H}" x2="${panelW}" y2="${HEADER_H}" stroke="${C.surface1}" stroke-width="1"/>
    <text x="12" y="${HEADER_H / 2 + 4}" fill="${C.text}" font-size="13" font-family="monospace" font-weight="700">Git Graph</text>
    <text x="100" y="${HEADER_H / 2 + 4}" fill="${C.blue}" font-size="12" font-family="monospace">${escapeXml(branchName)}</text>
    <text x="${panelW - 12}" y="${HEADER_H / 2 + 4}" text-anchor="end" fill="${C.overlay0}" font-size="11" font-family="monospace">${commits.length} commits${branchCount > 0 ? ` \u00b7 ${branchCount} branches` : ""}</text>
  `;

  // --- Edges ---
  // Draw lines from each visible commit to its parents (if also visible or
  // just off-screen). We draw edges before nodes so nodes are on top.
  const edgesSvg: string[] = [];

  for (let vi = 0; vi < visible.length; vi++) {
    const commit = visible[vi];
    const cy = commitY(vi);
    const cx = railX(commit.rail);
    const color = railColor(commit.rail);

    for (const parentHash of commit.parents) {
      const parentGlobalIdx = hashToGlobalIdx.get(parentHash);
      if (parentGlobalIdx === undefined) continue;

      const parentCommit = commits[parentGlobalIdx];
      const parentVi = parentGlobalIdx - scrollOffset;

      // Only draw if parent is in or near the visible window
      if (parentVi < -1 || parentVi > count + 1) continue;

      const parentCy =
        parentVi >= 0 && parentVi < count
          ? commitY(parentVi)
          : parentVi < 0
            ? HEADER_H - ROW_H / 2
            : HEADER_H + graphAreaH() + ROW_H / 2;

      const parentCx = railX(parentCommit.rail);
      const edgeColor =
        commit.parents.indexOf(parentHash) === 0
          ? color
          : railColor(parentCommit.rail);

      if (commit.rail === parentCommit.rail) {
        // Straight vertical line
        edgesSvg.push(
          `<line x1="${cx}" y1="${cy}" x2="${parentCx}" y2="${parentCy}" stroke="${edgeColor}" stroke-width="2" stroke-opacity="0.6"/>`,
        );
      } else {
        // Curved edge between rails
        const midY = (cy + parentCy) / 2;
        edgesSvg.push(
          `<path d="M${cx},${cy} C${cx},${midY} ${parentCx},${midY} ${parentCx},${parentCy}" fill="none" stroke="${edgeColor}" stroke-width="2" stroke-opacity="0.5"/>`,
        );
      }
    }
  }

  // --- Active rail lines (faint vertical guides) ---
  const railGuides: string[] = [];
  for (let r = 0; r <= maxRail; r++) {
    const rx = railX(r);
    railGuides.push(
      `<line x1="${rx}" y1="${HEADER_H}" x2="${rx}" y2="${HEADER_H + graphAreaH()}" stroke="${railColor(r)}" stroke-width="1" stroke-opacity="0.1"/>`,
    );
  }

  // --- Nodes + text ---
  const nodesSvg: string[] = [];
  const tX = textStartX();

  for (let vi = 0; vi < visible.length; vi++) {
    const commit = visible[vi];
    const globalIdx = scrollOffset + vi;
    const cy = commitY(vi);
    const cx = railX(commit.rail);
    const color = railColor(commit.rail);
    const isSelected = selectedCommit === globalIdx;
    const isMerge = commit.parents.length > 1;

    // Row highlight on selection
    if (isSelected) {
      nodesSvg.push(
        `<rect x="0" y="${cy - ROW_H / 2}" width="${panelW}" height="${ROW_H}" fill="${C.surface0}" opacity="0.6"/>`,
      );
    }

    // Node circle
    const nodeR = isMerge ? NODE_R + 1 : NODE_R;
    const strokeW = isSelected ? 2.5 : 1.5;
    const fillColor = isSelected ? color : C.base;
    nodesSvg.push(
      `<circle cx="${cx}" cy="${cy}" r="${nodeR}" fill="${fillColor}" stroke="${color}" stroke-width="${strokeW}"/>`,
    );

    // HEAD indicator
    const isHead = commit.decorations.some((d) => d.startsWith("HEAD"));
    if (isHead) {
      nodesSvg.push(
        `<circle cx="${cx}" cy="${cy}" r="${nodeR + 4}" fill="none" stroke="${C.yellow}" stroke-width="1.5" stroke-dasharray="3,2"/>`,
      );
    }

    // Text: short hash
    const hashColor = isSelected ? C.blue : C.lavender;
    nodesSvg.push(
      `<text x="${tX}" y="${cy + 4}" fill="${hashColor}" font-size="11" font-family="monospace" font-weight="600">${escapeXml(commit.shortHash)}</text>`,
    );

    // Text: author (truncated)
    const authorTrunc =
      commit.author.length > 12
        ? commit.author.slice(0, 11) + "\u2026"
        : commit.author;
    nodesSvg.push(
      `<text x="${tX + 68}" y="${cy + 4}" fill="${C.subtext0}" font-size="10" font-family="monospace">${escapeXml(authorTrunc)}</text>`,
    );

    // Text: message (truncated to fit)
    const msgX = tX + 170;
    const decoWidth =
      commit.decorations.length > 0
        ? estimateDecoWidth(commit.decorations) + 8
        : 0;
    const availMsgW = panelW - msgX - 12 - decoWidth;
    const maxMsgChars = Math.max(8, Math.floor(availMsgW / 7));
    const msgTrunc =
      commit.message.length > maxMsgChars
        ? commit.message.slice(0, maxMsgChars - 1) + "\u2026"
        : commit.message;
    nodesSvg.push(
      `<text x="${msgX}" y="${cy + 4}" fill="${C.text}" font-size="10" font-family="monospace">${escapeXml(msgTrunc)}</text>`,
    );

    // Decoration badges (branches, tags)
    if (commit.decorations.length > 0) {
      let badgeX = panelW - 12;
      for (let di = commit.decorations.length - 1; di >= 0; di--) {
        const deco = commit.decorations[di];
        const { label, badgeColor } = decoStyle(deco);
        const labelW = label.length * 6.5 + 10;
        badgeX -= labelW + 4;
        nodesSvg.push(
          `<rect x="${badgeX}" y="${cy - 8}" width="${labelW}" height="16" rx="4" fill="${badgeColor}" opacity="0.2"/>`,
        );
        nodesSvg.push(
          `<text x="${badgeX + 5}" y="${cy + 3}" fill="${badgeColor}" font-size="9" font-family="monospace">${escapeXml(label)}</text>`,
        );
      }
    }
  }

  // --- Scroll indicator ---
  const scrollBarSvg = renderScrollBar();

  // --- Detail area ---
  const detailSvg = renderDetail();

  return `<svg width="${panelW}" height="${panelH}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${panelW}" height="${panelH}" rx="8" fill="${C.base}"/>
  <rect x="0.5" y="0.5" width="${panelW - 1}" height="${panelH - 1}" rx="8" fill="none" stroke="${C.surface1}" stroke-width="1"/>
  <!-- Clip graph area -->
  <defs>
    <clipPath id="graphClip">
      <rect x="0" y="${HEADER_H}" width="${panelW}" height="${graphAreaH()}"/>
    </clipPath>
  </defs>
  ${headerSvg}
  <g clip-path="url(#graphClip)">
    ${railGuides.join("\n    ")}
    ${edgesSvg.join("\n    ")}
    ${nodesSvg.join("\n    ")}
  </g>
  ${scrollBarSvg}
  ${detailSvg}
</svg>`;
}

function estimateDecoWidth(decorations: string[]): number {
  let w = 0;
  for (const d of decorations) {
    const { label } = decoStyle(d);
    w += label.length * 6.5 + 14;
  }
  return w;
}

function decoStyle(deco: string): { label: string; badgeColor: string } {
  if (deco.startsWith("HEAD -> ")) {
    return { label: deco.replace("HEAD -> ", ""), badgeColor: C.yellow };
  }
  if (deco === "HEAD") {
    return { label: "HEAD", badgeColor: C.yellow };
  }
  if (deco.startsWith("tag: ")) {
    return { label: deco.replace("tag: ", ""), badgeColor: C.peach };
  }
  if (deco.startsWith("origin/")) {
    return { label: deco, badgeColor: C.teal };
  }
  // Local branch
  return { label: deco, badgeColor: C.green };
}

function renderScrollBar(): string {
  if (commits.length <= visibleCount()) return "";

  const barX = panelW - 6;
  const trackY = HEADER_H + 2;
  const trackH = graphAreaH() - 4;

  const ratio = visibleCount() / commits.length;
  const thumbH = Math.max(16, Math.round(trackH * ratio));
  const scrollRange = commits.length - visibleCount();
  const thumbY =
    trackY + Math.round((scrollOffset / scrollRange) * (trackH - thumbH));

  return `
    <rect x="${barX}" y="${trackY}" width="4" height="${trackH}" rx="2" fill="${C.surface0}" opacity="0.5"/>
    <rect x="${barX}" y="${thumbY}" width="4" height="${thumbH}" rx="2" fill="${C.overlay0}" opacity="0.6"/>
  `;
}

function renderDetail(): string {
  const detailY = panelH - DETAIL_H;

  let content: string;
  if (
    selectedCommit !== null &&
    selectedCommit >= 0 &&
    selectedCommit < commits.length
  ) {
    const c = commits[selectedCommit];
    const decoStr = c.decorations.length > 0 ? c.decorations.join(", ") : "";
    content = `
      <text x="12" y="${detailY + 18}" fill="${C.blue}" font-size="11" font-family="monospace" font-weight="600">${escapeXml(c.hash)}</text>
      <text x="12" y="${detailY + 34}" fill="${C.text}" font-size="10" font-family="monospace">${escapeXml(c.author)} \u2014 ${escapeXml(c.message)}</text>
      ${decoStr.length > 0 ? `<text x="${panelW - 12}" y="${detailY + 18}" text-anchor="end" fill="${C.peach}" font-size="10" font-family="monospace">${escapeXml(decoStr)}</text>` : ""}
    `;
  } else {
    content = `
      <text x="12" y="${detailY + 24}" fill="${C.overlay0}" font-size="10" font-family="monospace">Click a commit to inspect</text>
    `;
  }

  return `
    <rect x="0" y="${detailY}" width="${panelW}" height="${DETAIL_H}" fill="${C.surface0}"/>
    <line x1="0" y1="${detailY}" x2="${panelW}" y2="${detailY}" stroke="${C.surface1}" stroke-width="1"/>
    ${content}
  `;
}

// ---------------------------------------------------------------------------
// Panel rendering
// ---------------------------------------------------------------------------

let firstRender = true;

function render(): void {
  const svg = renderSvg();
  const svgBytes = encoder.encode(svg);

  if (firstRender) {
    writeMeta({
      id: PANEL_ID,
      type: "svg",
      position: "float",
      x: 50,
      y: 20,
      width: panelW,
      height: panelH,
      draggable: true,
      resizable: true,
      interactive: true,
      byteLength: svgBytes.byteLength,
    });
    firstRender = false;
  } else {
    writeMeta({
      id: PANEL_ID,
      type: "update",
      byteLength: svgBytes.byteLength,
    });
  }

  writeData(svg);
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTest(
  x: number,
  y: number,
): { area: "header" | "graph" | "detail"; rowIdx?: number } {
  if (y < HEADER_H) return { area: "header" };
  if (y >= panelH - DETAIL_H) return { area: "detail" };

  const relY = y - HEADER_H;
  const rowIdx = Math.floor(relY / ROW_H);
  if (rowIdx >= 0 && rowIdx < visibleCount()) {
    return { area: "graph", rowIdx: scrollOffset + rowIdx };
  }
  return { area: "graph" };
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  if (evtId !== PANEL_ID) return;

  const ex = (event["x"] as number) ?? 0;
  const ey = (event["y"] as number) ?? 0;

  switch (evtType) {
    case "close": {
      writeMeta({ id: PANEL_ID, type: "clear" });
      console.log("\nGit graph closed.");
      process.exit(0);
      break;
    }

    case "click": {
      const hit = hitTest(ex, ey);
      if (hit.area === "graph" && hit.rowIdx !== undefined) {
        if (hit.rowIdx >= 0 && hit.rowIdx < commits.length) {
          selectedCommit = selectedCommit === hit.rowIdx ? null : hit.rowIdx;
          render();
        }
      }
      break;
    }

    case "wheel": {
      const deltaY = (event["deltaY"] as number) ?? 0;
      const step = deltaY > 0 ? 3 : -3;
      const maxOffset = Math.max(0, commits.length - visibleCount());
      scrollOffset = Math.max(0, Math.min(scrollOffset + step, maxOffset));
      render();
      break;
    }

    case "resize": {
      const newW = (event["width"] as number) ?? panelW;
      const newH = (event["height"] as number) ?? panelH;
      if (newW !== panelW || newH !== panelH) {
        panelW = newW;
        panelH = newH;
        render();
      }
      break;
    }

    case "dragend": {
      // Position updated, no re-render needed
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
          // invalid JSON
        }
      }
    }
  } catch {
    // fd closed
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Check we are in a git repo
if (!(await isGitRepo())) {
  console.error("Error: not inside a git repository.");
  process.exit(1);
}

branchName = await getCurrentBranch();
await fetchCommits();

if (commits.length === 0) {
  console.error("Error: no commits found in this repository.");
  process.exit(1);
}

// Count unique branches
const allDecorations = commits.flatMap((c) => c.decorations);
const branchNames = new Set(
  allDecorations
    .filter((d) => !d.startsWith("tag:") && d !== "HEAD")
    .map((d) => d.replace("HEAD -> ", "").replace(/^origin\//, "")),
);

console.log(
  `Loaded ${commits.length} commits from ${branchNames.size} branches.`,
);
console.log("Scroll with mouse wheel. Click a commit to inspect.");
console.log("Press Ctrl+C to exit.\n");

// Initial render
render();

// Start event loop
readEvents();

// Cleanup on SIGINT
process.on("SIGINT", () => {
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\nGit graph closed.");
  process.exit(0);
});
