#!/usr/bin/env bun
/**
 * τ-mux — JSON Inspector
 *
 * An interactive tree viewer for JSON data with expand/collapse, type
 * coloring (Catppuccin Mocha), scroll, hover highlight, and JSONPath
 * display.  Renders as an interactive HTML panel via the sideband protocol.
 *
 * Usage:
 *   bun scripts/demo_json.ts data.json          — load from file
 *   cat data.json | bun scripts/demo_json.ts    — read from stdin pipe
 *   bun scripts/demo_json.ts '{"key":"value"}'  — parse from argument
 */

import { statSync } from "fs";

const MAX_JSON_FILE_BYTES = 100 * 1024 * 1024; // 100 MiB
const MAX_TREE_DEPTH = 512;

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

const PANEL_ID = "json";

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
  surface0: "#313244",
  surface1: "#45475a",
  overlay0: "#6c7086",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  blue: "#89b4fa",
  green: "#a6e3a1",
  peach: "#fab387",
  pink: "#f5c2e7",
  red: "#f38ba8",
  yellow: "#f9e2af",
  lavender: "#b4befe",
} as const;

// Type-specific colors
const TC = {
  string: C.green,
  number: C.peach,
  boolean: C.pink,
  null: C.overlay0,
  key: C.blue,
  bracket: C.text,
  count: C.overlay0,
} as const;

// ---------------------------------------------------------------------------
// Layout constants (px)
// ---------------------------------------------------------------------------

const PANEL_W = 550;
const PANEL_H = 600;
const HEADER_H = 36;
const PATH_BAR_H = 28;
const ROW_H = 22;
const INDENT_PX = 16;
const MAX_STR_LEN = 60;

// ---------------------------------------------------------------------------
// Tree data model
// ---------------------------------------------------------------------------

interface TreeNode {
  key: string;
  value: unknown;
  depth: number;
  expanded: boolean;
  path: string;
  isContainer: boolean;
  childCount: number;
  isArray: boolean;
}

// ---------------------------------------------------------------------------
// JSON loading
// ---------------------------------------------------------------------------

async function loadJson(): Promise<unknown> {
  const arg = process.argv[2];

  // No argument and stdin is a TTY — nothing to read
  if (!arg && Bun.stdin.stream().locked === false) {
    // Try reading stdin if it is piped (not a TTY)
    if (!process.stdin.isTTY) {
      const text = await Bun.stdin.text();
      if (text.trim()) {
        return JSON.parse(text);
      }
    }
    console.error(
      "Usage:\n" +
        "  bun scripts/demo_json.ts data.json\n" +
        "  cat data.json | bun scripts/demo_json.ts\n" +
        '  bun scripts/demo_json.ts \'{"key":"value"}\'',
    );
    process.exit(1);
  }

  if (arg) {
    // Try parsing as inline JSON first
    if (arg.startsWith("{") || arg.startsWith("[") || arg.startsWith('"')) {
      try {
        return JSON.parse(arg);
      } catch {
        // Not valid JSON literal — treat as file path
      }
    }

    // Treat as file path
    try {
      const resolved = Bun.resolveSync(arg, process.cwd());
      try {
        const stat = statSync(resolved);
        if (stat.size > MAX_JSON_FILE_BYTES) {
          console.error(
            `Error: "${arg}" is ${(stat.size / (1024 * 1024)).toFixed(1)} MB ` +
              `which exceeds the ${MAX_JSON_FILE_BYTES / (1024 * 1024)} MB limit.`,
          );
          process.exit(1);
        }
      } catch (statErr) {
        console.error(
          `Error stating "${arg}": ${
            statErr instanceof Error ? statErr.message : statErr
          }`,
        );
        process.exit(1);
      }
      const text = await Bun.file(resolved).text();
      return JSON.parse(text);
    } catch (err) {
      console.error(
        `Error loading "${arg}": ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  }

  // stdin pipe
  const text = await Bun.stdin.text();
  if (!text.trim()) {
    console.error("Empty stdin.");
    process.exit(1);
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// JSON stats
// ---------------------------------------------------------------------------

function countKeys(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    let count = value.length;
    for (const item of value) count += countKeys(item);
    return count;
  }
  const obj = value as Record<string, unknown>;
  let count = Object.keys(obj).length;
  for (const v of Object.values(obj)) count += countKeys(v);
  return count;
}

function maxDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== "object") return depth;
  if (Array.isArray(value)) {
    let max = depth;
    for (const item of value) max = Math.max(max, maxDepth(item, depth + 1));
    return max;
  }
  let max = depth;
  for (const v of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, maxDepth(v, depth + 1));
  }
  return max;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Build initial tree nodes from JSON
// ---------------------------------------------------------------------------

function isContainer(value: unknown): boolean {
  return value !== null && typeof value === "object";
}

function childCountOf(value: unknown): number {
  if (!isContainer(value)) return 0;
  if (Array.isArray(value)) return value.length;
  return Object.keys(value as Record<string, unknown>).length;
}

/** Expanded state map keyed by JSONPath string. */
const expandedMap: Map<string, boolean> = new Map();

function isExpanded(path: string, depth: number): boolean {
  const stored = expandedMap.get(path);
  if (stored !== undefined) return stored;
  // Default: root is expanded, everything else collapsed
  return depth === 0;
}

function toggleExpanded(path: string, depth: number): void {
  const current = isExpanded(path, depth);
  expandedMap.set(path, !current);
}

/**
 * Flatten the JSON tree into a list of visible TreeNode entries,
 * respecting expand/collapse state.
 */
function flattenTree(rootValue: unknown): TreeNode[] {
  const nodes: TreeNode[] = [];

  function walk(
    key: string,
    value: unknown,
    depth: number,
    path: string,
  ): void {
    if (depth > MAX_TREE_DEPTH) {
      nodes.push({
        key: "…",
        value: { "…": "max depth exceeded" },
        depth,
        expanded: false,
        path,
        isContainer: false,
        childCount: 0,
        isArray: false,
      });
      return;
    }

    const container = isContainer(value);
    const arrFlag = Array.isArray(value);
    const count = container ? childCountOf(value) : 0;
    const expanded = container ? isExpanded(path, depth) : false;

    nodes.push({
      key,
      value,
      depth,
      expanded,
      path,
      isContainer: container,
      childCount: count,
      isArray: arrFlag,
    });

    if (container && expanded) {
      if (arrFlag) {
        const arr = value as unknown[];
        for (let i = 0; i < arr.length; i++) {
          walk(String(i), arr[i], depth + 1, `${path}[${i}]`);
        }
      } else {
        const obj = value as Record<string, unknown>;
        for (const [k, v] of Object.entries(obj)) {
          const childPath = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)
            ? `${path}.${k}`
            : `${path}["${k}"]`;
          walk(k, v, depth + 1, childPath);
        }
      }
    }
  }

  walk("root", rootValue, 0, "$");
  return nodes;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let data: unknown = null;
let nodes: TreeNode[] = [];
let scrollOffset = 0;
let selectedPath = "$";
let hoveredRow = -1;
let totalKeys = 0;
let depth = 0;
let jsonSize = 0;

// Throttle
let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 16;
let renderQueued = false;

// ---------------------------------------------------------------------------
// HTML escape
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Value rendering
// ---------------------------------------------------------------------------

function renderValue(value: unknown): string {
  if (value === null) {
    return `<span style="color:${TC.null};">null</span>`;
  }
  switch (typeof value) {
    case "string": {
      const display =
        value.length > MAX_STR_LEN
          ? escapeHtml(value.slice(0, MAX_STR_LEN)) + "..."
          : escapeHtml(value);
      return `<span style="color:${TC.string};">"${display}"</span>`;
    }
    case "number":
      return `<span style="color:${TC.number};">${value}</span>`;
    case "boolean":
      return `<span style="color:${TC.boolean};">${value}</span>`;
    default:
      return `<span style="color:${TC.null};">${escapeHtml(String(value))}</span>`;
  }
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

function renderRow(
  node: TreeNode,
  index: number,
  isHovered: boolean,
  isSelected: boolean,
): string {
  const indent = node.depth * INDENT_PX;
  const bgColor = isSelected
    ? C.surface1
    : isHovered
      ? C.surface0
      : "transparent";

  let content = "";

  // Triangle for containers
  if (node.isContainer) {
    const triangle = node.expanded ? "\u25BC" : "\u25B6";
    content += `<span style="color:${C.overlay0};font-size:10px;width:14px;display:inline-block;text-align:center;cursor:pointer;">${triangle}</span> `;
  } else {
    content += `<span style="width:14px;display:inline-block;"></span> `;
  }

  // Key name (skip for root at depth 0 if it is the root object/array)
  if (node.depth === 0) {
    content += `<span style="color:${TC.key};font-weight:600;">root</span> `;
  } else {
    // For array indices show as number, for object keys show in quotes
    const parentIsArray = node.path.endsWith(`[${node.key}]`);
    if (parentIsArray) {
      content += `<span style="color:${TC.number};">${escapeHtml(node.key)}</span>`;
    } else {
      content += `<span style="color:${TC.key};">"${escapeHtml(node.key)}"</span>`;
    }
    content += `<span style="color:${C.overlay0};">: </span>`;
  }

  // Value or container indicator
  if (node.isContainer) {
    if (node.isArray) {
      content += `<span style="color:${TC.bracket};">[</span>`;
      content += `<span style="color:${TC.count};">${node.childCount}</span>`;
      content += `<span style="color:${TC.bracket};">]</span>`;
    } else {
      content += `<span style="color:${TC.bracket};">{</span>`;
      content += `<span style="color:${TC.count};">${node.childCount}</span>`;
      content += `<span style="color:${TC.bracket};">}</span>`;
    }
  } else {
    content += renderValue(node.value);
  }

  return `<div style="height:${ROW_H}px;line-height:${ROW_H}px;padding-left:${indent + 8}px;background:${bgColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-family:'SF Mono',Monaco,Consolas,'JetBrains Mono',monospace;cursor:pointer;">${content}</div>`;
}

// ---------------------------------------------------------------------------
// Full HTML rendering
// ---------------------------------------------------------------------------

function renderHtml(): string {
  const treeAreaH = PANEL_H - HEADER_H - PATH_BAR_H;
  const visibleRowCount = Math.floor(treeAreaH / ROW_H);

  // Clamp scroll
  const maxScroll = Math.max(0, nodes.length * ROW_H - treeAreaH);
  if (scrollOffset < 0) scrollOffset = 0;
  if (scrollOffset > maxScroll) scrollOffset = maxScroll;

  // Determine visible range
  const firstVisible = Math.floor(scrollOffset / ROW_H);
  const lastVisible = Math.min(
    nodes.length - 1,
    firstVisible + visibleRowCount + 1,
  );

  // Render visible rows
  const rowsHtml: string[] = [];
  for (let i = firstVisible; i <= lastVisible; i++) {
    const node = nodes[i];
    const isHovered = i === hoveredRow;
    const isSelected = node.path === selectedPath;
    rowsHtml.push(renderRow(node, i, isHovered, isSelected));
  }

  // Spacer before first visible row to maintain scroll position
  const topSpacer = firstVisible * ROW_H - scrollOffset;
  const totalHeight = nodes.length * ROW_H;

  // Scrollbar indicator
  const scrollbarH =
    treeAreaH > 0 && totalHeight > treeAreaH
      ? Math.max(20, (treeAreaH / totalHeight) * treeAreaH)
      : 0;
  const scrollbarY =
    totalHeight > treeAreaH
      ? (scrollOffset / maxScroll) * (treeAreaH - scrollbarH)
      : 0;
  const scrollbarHtml =
    scrollbarH > 0
      ? `<div style="position:absolute;right:2px;top:${scrollbarY}px;width:6px;height:${scrollbarH}px;background:${C.surface1};border-radius:3px;"></div>`
      : "";

  return `<div style="width:${PANEL_W}px;height:${PANEL_H}px;background:${C.base};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;display:flex;flex-direction:column;user-select:none;">
  <!-- Header -->
  <div style="height:${HEADER_H}px;background:${C.surface0};display:flex;align-items:center;padding:0 14px;flex-shrink:0;border-bottom:1px solid ${C.surface1};">
    <svg width="16" height="16" viewBox="0 0 16 16" style="margin-right:8px;flex-shrink:0;">
      <text x="2" y="12" font-size="11" font-weight="700" fill="${C.yellow}" font-family="monospace">{}</text>
    </svg>
    <span style="font-size:13px;font-weight:600;color:${C.text};">JSON Inspector</span>
    <div style="flex:1;"></div>
    <span style="font-size:11px;color:${C.overlay0};white-space:nowrap;">keys: ${totalKeys} &nbsp; size: ${formatSize(jsonSize)} &nbsp; depth: ${depth}</span>
  </div>

  <!-- Path bar -->
  <div style="height:${PATH_BAR_H}px;background:${C.mantle};display:flex;align-items:center;padding:0 14px;flex-shrink:0;border-bottom:1px solid ${C.surface0};overflow:hidden;">
    <span style="font-size:12px;color:${C.lavender};font-family:'SF Mono',Monaco,Consolas,'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(selectedPath)}</span>
  </div>

  <!-- Tree view -->
  <div style="flex:1;overflow:hidden;position:relative;">
    <div style="position:absolute;top:${topSpacer}px;left:0;right:0;">
      ${rowsHtml.join("\n      ")}
    </div>
    ${scrollbarHtml}
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
      x: 50,
      y: 30,
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

function rowIndexFromY(y: number): number {
  const treeY = y - HEADER_H - PATH_BAR_H;
  if (treeY < 0) return -1;
  return Math.floor((treeY + scrollOffset) / ROW_H);
}

function isTriangleClick(x: number, rowIndex: number): boolean {
  if (rowIndex < 0 || rowIndex >= nodes.length) return false;
  const node = nodes[rowIndex];
  if (!node.isContainer) return false;
  const indent = node.depth * INDENT_PX + 8;
  return x >= indent && x < indent + 16;
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
      `[json] sideband error: ${code}${panelId ? ` (${panelId})` : ""}${
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
      console.log("JSON Inspector closed.");
      process.exit(0);
      break;
    }

    case "click": {
      const row = rowIndexFromY(ey);
      if (row < 0 || row >= nodes.length) return;

      const node = nodes[row];

      // Toggle expand/collapse on triangle click or any click on a container
      if (node.isContainer && isTriangleClick(ex, row)) {
        toggleExpanded(node.path, node.depth);
        nodes = flattenTree(data);
        selectedPath = node.path;
        render(true);
        return;
      }

      // Select the row and update path
      selectedPath = node.path;
      render(true);
      break;
    }

    case "mousedown": {
      const row = rowIndexFromY(ey);
      if (row < 0 || row >= nodes.length) return;

      const node = nodes[row];

      // Toggle expand/collapse on triangle click
      if (node.isContainer && isTriangleClick(ex, row)) {
        toggleExpanded(node.path, node.depth);
        nodes = flattenTree(data);
        selectedPath = node.path;
        render(true);
        return;
      }

      // Select the row and update path
      selectedPath = node.path;
      render(true);
      break;
    }

    case "mousemove": {
      const row = rowIndexFromY(ey);
      if (row !== hoveredRow) {
        hoveredRow = row;
        render();
      }
      break;
    }

    case "wheel": {
      const deltaY = (event["deltaY"] as number) ?? 0;
      scrollOffset += deltaY;
      // Clamp is done in renderHtml
      render();
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

try {
  data = await loadJson();
} catch (err) {
  console.error(
    `Failed to parse JSON: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
}

const rawJson = JSON.stringify(data);
jsonSize = encoder.encode(rawJson).byteLength;
totalKeys = countKeys(data);
depth = maxDepth(data);
nodes = flattenTree(data);

console.log("τ-mux JSON Inspector started.");
console.log(
  `Keys: ${totalKeys}  Size: ${formatSize(jsonSize)}  Depth: ${depth}`,
);
console.log("Click triangles to expand/collapse. Scroll to navigate.");
console.log("Press Ctrl+C to exit.\n");

// Initial render
render(true);

// Start event loop
readEvents();

// Cleanup on exit
process.on("SIGINT", () => {
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\nJSON Inspector closed.");
  process.exit(0);
});
