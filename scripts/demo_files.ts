#!/usr/bin/env bun
/**
 * HyperTerm Canvas — File Explorer
 *
 * A two-pane file browser with directory navigation, file previews,
 * search/filter, and keyboard controls. Renders as an interactive HTML
 * panel via the sideband protocol.
 *
 * Usage:
 *   bun scripts/demo_files.ts [directory]   — defaults to cwd
 */

import {
  readdirSync,
  statSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "fs";
import { resolve, extname, dirname, join } from "path";

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

const PANEL_ID = "files";

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
  sky: "#89dceb",
} as const;

// ---------------------------------------------------------------------------
// Layout constants (px) — used for hit-testing
// ---------------------------------------------------------------------------

const PATH_BAR_H = 36;
const STATUS_BAR_H = 24;
const LEFT_PANE_W = 220;
const ROW_H = 24;

// Button regions in the path bar (right side)
const BTN_W = 28;
const BTN_GAP = 4;
// Buttons are positioned from the right edge
// [Up] [Refresh] [Hidden]
const BTN_MARGIN_RIGHT = 10;

// Panel dimensions (updated by resize events)
let panelW = 700;
let panelH = 550;

// Derived helpers
function contentH(): number {
  return Math.max(0, panelH - PATH_BAR_H - STATUS_BAR_H);
}

function visibleRows(): number {
  return Math.floor(contentH() / ROW_H);
}

function rightPaneW(): number {
  return Math.max(0, panelW - LEFT_PANE_W);
}

// ---------------------------------------------------------------------------
// File entry type
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string;
  fullPath: string;
  isDir: boolean;
  isSymlink: boolean;
  isHidden: boolean;
  size: number;
  modified: Date;
  permissions: string;
  error: boolean; // true if stat failed
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentDir: string = resolve(process.argv[2] ?? ".");
let entries: FileEntry[] = [];
let selectedIndex = 0;
let scrollOffset = 0;
let showHidden = false;
let lastClickTime = 0;
let lastClickIndex = -1;
let filterText = "";
let filterMode = false; // true when typing a filter after pressing /

// Throttle
let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 24;
let renderQueued = false;

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + " KB";
  return bytes + " B";
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function permissionsToString(mode: number): string {
  const octal = (mode & 0o777).toString(8);
  const chars = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
  const digits = octal.padStart(3, "0");
  return digits
    .split("")
    .map((d) => chars[parseInt(d)])
    .join("");
}

function fileIcon(entry: FileEntry): string {
  if (entry.isDir) return "\u{1F4C1}";

  const ext = extname(entry.name).toLowerCase();
  const name = entry.name.toLowerCase();

  // Special files
  if (name === "package.json" || name === "package-lock.json")
    return "\u{1F4E6}";
  if (name === "bun.lock" || name === "yarn.lock" || name === "pnpm-lock.yaml")
    return "\u{1F4E6}";
  if (
    name.startsWith(".env") ||
    name === ".gitignore" ||
    name === ".editorconfig"
  )
    return "\u2699\uFE0F";
  if (
    name === "tsconfig.json" ||
    name === "eslint.config.js" ||
    name === "eslint.config.ts" ||
    name === ".prettierrc" ||
    name.endsWith(".config.ts") ||
    name.endsWith(".config.js") ||
    name === "Makefile" ||
    name === "Dockerfile"
  )
    return "\u2699\uFE0F";

  // By extension
  switch (ext) {
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".webp":
    case ".svg":
    case ".ico":
    case ".bmp":
      return "\u{1F3A8}";
    case ".md":
    case ".mdx":
    case ".txt":
    case ".rst":
      return "\u{1F4DD}";
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "\u{1F4DC}";
    case ".json":
    case ".yaml":
    case ".yml":
    case ".toml":
    case ".xml":
      return "\u{1F4CB}";
    case ".py":
    case ".rb":
    case ".go":
    case ".rs":
    case ".c":
    case ".cpp":
    case ".h":
    case ".java":
    case ".sh":
    case ".bash":
    case ".zsh":
      return "\u{1F4DC}";
    case ".zip":
    case ".tar":
    case ".gz":
    case ".bz2":
    case ".xz":
    case ".7z":
    case ".rar":
      return "\u{1F4E6}";
    case ".lock":
      return "\u{1F512}";
    default:
      return "\u{1F4C4}";
  }
}

function fileTypeLabel(entry: FileEntry): string {
  if (entry.isDir) return "Directory";
  if (entry.isSymlink) return "Symlink";

  const ext = extname(entry.name).toLowerCase();
  const typeMap: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript JSX",
    ".js": "JavaScript",
    ".jsx": "JavaScript JSX",
    ".mjs": "ES Module",
    ".cjs": "CommonJS",
    ".json": "JSON",
    ".md": "Markdown",
    ".mdx": "MDX",
    ".txt": "Plain Text",
    ".html": "HTML",
    ".css": "CSS",
    ".scss": "SCSS",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".toml": "TOML",
    ".xml": "XML",
    ".py": "Python",
    ".rb": "Ruby",
    ".go": "Go",
    ".rs": "Rust",
    ".c": "C",
    ".cpp": "C++",
    ".h": "C Header",
    ".java": "Java",
    ".sh": "Shell Script",
    ".bash": "Bash Script",
    ".zsh": "Zsh Script",
    ".png": "PNG Image",
    ".jpg": "JPEG Image",
    ".jpeg": "JPEG Image",
    ".gif": "GIF Image",
    ".webp": "WebP Image",
    ".svg": "SVG Image",
    ".ico": "Icon",
    ".zip": "ZIP Archive",
    ".tar": "TAR Archive",
    ".gz": "Gzip Archive",
    ".lock": "Lock File",
  };

  return typeMap[ext] ?? (ext ? ext.slice(1).toUpperCase() + " File" : "File");
}

function isTextFile(entry: FileEntry): boolean {
  if (entry.isDir) return false;
  const ext = extname(entry.name).toLowerCase();
  const textExts = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".mdx",
    ".txt",
    ".html",
    ".css",
    ".scss",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".c",
    ".cpp",
    ".h",
    ".java",
    ".sh",
    ".bash",
    ".zsh",
    ".sql",
    ".graphql",
    ".gql",
    ".env",
    ".gitignore",
    ".editorconfig",
    ".prettierrc",
    ".eslintrc",
    ".svelte",
    ".vue",
    ".astro",
    ".ini",
    ".cfg",
    ".conf",
    ".log",
    ".csv",
    ".tsv",
    ".rst",
    ".tex",
    ".lua",
    ".swift",
    ".kt",
    ".kts",
    ".r",
    ".m",
    ".mm",
    ".pl",
    ".pm",
    ".ex",
    ".exs",
    ".erl",
    ".hrl",
    ".hs",
    ".elm",
    ".clj",
    ".cljs",
    ".scala",
    ".dart",
    ".zig",
    ".nim",
    ".v",
    ".d",
    "",
  ]);
  if (textExts.has(ext)) return true;
  // Check common dotfiles without extensions
  const name = entry.name.toLowerCase();
  if (
    name.startsWith(".") &&
    !ext &&
    (name.includes("rc") ||
      name.includes("ignore") ||
      name.includes("config") ||
      name.includes("profile"))
  )
    return true;
  return false;
}

function isImageFile(entry: FileEntry): boolean {
  const ext = extname(entry.name).toLowerCase();
  return [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".bmp",
  ].includes(ext);
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

function scanDirectory(dir: string): void {
  entries = [];
  try {
    const names = readdirSync(dir);
    for (const name of names) {
      const fullPath = join(dir, name);
      const isHidden = name.startsWith(".");

      let isDir = false;
      let isSymlink = false;
      let size = 0;
      let modified = new Date(0);
      let permissions = "rw-r--r--";
      let error = false;

      try {
        const lstat = statSync(fullPath, { throwIfNoEntry: false });
        if (!lstat) {
          error = true;
        } else {
          isDir = lstat.isDirectory();
          isSymlink = lstat.isSymbolicLink();
          size = lstat.size;
          modified = lstat.mtime;
          permissions = permissionsToString(lstat.mode);

          // If it's a symlink, try to resolve and re-stat
          if (isSymlink) {
            try {
              const realPath = realpathSync(fullPath);
              const realStat = statSync(realPath, { throwIfNoEntry: false });
              if (realStat) {
                isDir = realStat.isDirectory();
                size = realStat.size;
              }
            } catch {
              // broken symlink — keep original stat info
            }
          }
        }
      } catch {
        error = true;
      }

      entries.push({
        name,
        fullPath,
        isDir,
        isSymlink,
        isHidden,
        size,
        modified,
        permissions,
        error,
      });
    }

    // Sort: directories first, then alphabetical (case-insensitive)
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  } catch (err) {
    console.log(
      `Permission denied or error reading: ${dir} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function filteredEntries(): FileEntry[] {
  let list = entries;

  // Filter hidden files
  if (!showHidden) {
    list = list.filter((e) => !e.isHidden);
  }

  // Filter by search text
  if (filterText.length > 0) {
    const lower = filterText.toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(lower));
  }

  return list;
}

function clampSelection(): void {
  const list = filteredEntries();
  if (list.length === 0) {
    selectedIndex = 0;
    scrollOffset = 0;
    return;
  }
  selectedIndex = Math.max(0, Math.min(selectedIndex, list.length - 1));
  // Ensure selected item is visible
  const vr = visibleRows();
  if (selectedIndex < scrollOffset) {
    scrollOffset = selectedIndex;
  } else if (selectedIndex >= scrollOffset + vr) {
    scrollOffset = selectedIndex - vr + 1;
  }
  scrollOffset = Math.max(
    0,
    Math.min(scrollOffset, Math.max(0, list.length - vr)),
  );
}

// ---------------------------------------------------------------------------
// Preview generation
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Simple syntax highlighting for common keywords */
function highlightLine(line: string): string {
  let escaped = escapeHtml(line);

  // Comments (// or #)
  escaped = escaped.replace(
    /^(\s*)(\/\/.*)$/,
    `$1<span style="color:${C.overlay0};">$2</span>`,
  );
  escaped = escaped.replace(
    /^(\s*)(#.*)$/,
    `$1<span style="color:${C.overlay0};">$2</span>`,
  );

  // Strings
  escaped = escaped.replace(
    /(&quot;[^&]*?&quot;)/g,
    `<span style="color:${C.green};">$1</span>`,
  );
  escaped = escaped.replace(
    /('[^']*?')/g,
    `<span style="color:${C.green};">$1</span>`,
  );
  escaped = escaped.replace(
    /(`[^`]*?`)/g,
    `<span style="color:${C.green};">$1</span>`,
  );

  // Keywords
  const keywords =
    /\b(import|export|from|const|let|var|function|class|interface|type|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|async|await|default|extends|implements|enum|namespace|module|declare|readonly|abstract|static|public|private|protected|true|false|null|undefined|void|typeof|instanceof|in|of|as|is|def|self|None|True|False|fn|pub|mut|impl|struct|trait|use|mod|match|loop|where)\b/g;
  escaped = escaped.replace(
    keywords,
    `<span style="color:${C.mauve};">$&</span>`,
  );

  // Numbers
  escaped = escaped.replace(
    /\b(\d+\.?\d*)\b/g,
    `<span style="color:${C.peach};">$1</span>`,
  );

  return escaped;
}

function generatePreview(entry: FileEntry): string {
  if (entry.error) {
    return `<div style="color:${C.red};padding:12px;">Unable to read this file.<br>Permission denied or broken symlink.</div>`;
  }

  const rpW = rightPaneW() - 24; // padding

  // Directory preview: show child count and total size
  if (entry.isDir) {
    let childCount = 0;
    let childDirs = 0;
    let childFiles = 0;
    let totalSize = 0;

    try {
      const children = readdirSync(entry.fullPath);
      childCount = children.length;
      for (const child of children) {
        try {
          const childStat = statSync(join(entry.fullPath, child), {
            throwIfNoEntry: false,
          });
          if (childStat) {
            if (childStat.isDirectory()) childDirs++;
            else childFiles++;
            totalSize += childStat.size;
          }
        } catch {
          childFiles++;
        }
      }
    } catch {
      return `<div style="color:${C.red};padding:12px;">Cannot read directory contents.<br>Permission denied.</div>`;
    }

    return `<div style="padding:12px;color:${C.text};line-height:1.8;">
      <div style="font-size:13px;font-weight:600;color:${C.blue};margin-bottom:8px;">${escapeHtml(entry.name)}/</div>
      <div style="font-size:12px;color:${C.subtext0};">
        <div>Items: <span style="color:${C.text};">${childCount}</span></div>
        <div>Folders: <span style="color:${C.text};">${childDirs}</span></div>
        <div>Files: <span style="color:${C.text};">${childFiles}</span></div>
        <div>Total size: <span style="color:${C.text};">${formatSize(totalSize)}</span></div>
        <div style="margin-top:8px;">Modified: <span style="color:${C.text};">${formatDate(entry.modified)}</span></div>
        <div>Permissions: <span style="color:${C.text};font-family:monospace;">${entry.permissions}</span></div>
        ${entry.isSymlink ? `<div style="margin-top:4px;color:${C.yellow};">Symlink</div>` : ""}
      </div>
    </div>`;
  }

  // File metadata header
  const metaHtml = `<div style="padding:8px 12px;border-bottom:1px solid ${C.surface1};font-size:11px;color:${C.subtext0};line-height:1.6;">
    <div style="font-weight:600;color:${C.blue};font-size:12px;margin-bottom:4px;">${escapeHtml(entry.name)}</div>
    <div>Size: <span style="color:${C.text};">${formatSize(entry.size)}</span></div>
    <div>Modified: <span style="color:${C.text};">${formatDate(entry.modified)}</span></div>
    <div>Type: <span style="color:${C.text};">${fileTypeLabel(entry)}</span></div>
    <div>Permissions: <span style="color:${C.text};font-family:monospace;">${entry.permissions}</span></div>
    ${entry.isSymlink ? `<div style="color:${C.yellow};">Symlink \u2192 ${escapeHtml(safeReadlink(entry.fullPath))}</div>` : ""}
  </div>`;

  // Image metadata
  if (isImageFile(entry)) {
    return `${metaHtml}
    <div style="padding:12px;color:${C.subtext0};font-size:12px;">
      <div style="color:${C.mauve};margin-bottom:4px;">\u{1F3A8} Image File</div>
      <div>Format: ${fileTypeLabel(entry)}</div>
      <div>Size: ${formatSize(entry.size)}</div>
    </div>`;
  }

  // Text file preview
  if (isTextFile(entry)) {
    try {
      const raw = readFileSync(entry.fullPath, "utf-8").slice(0, 4096);
      const lines = raw.split("\n").slice(0, 50);
      const lineHtml = lines
        .map((line, i) => {
          const num = String(i + 1).padStart(3, " ");
          const highlighted = highlightLine(line);
          return `<div style="display:flex;min-height:16px;line-height:16px;"><span style="color:${C.overlay0};min-width:32px;text-align:right;margin-right:8px;user-select:none;flex-shrink:0;">${num}</span><span style="white-space:pre-wrap;word-break:break-all;flex:1;">${highlighted}</span></div>`;
        })
        .join("");

      const truncated =
        lines.length >= 50
          ? `<div style="padding:4px 0;color:${C.overlay0};font-style:italic;text-align:center;border-top:1px solid ${C.surface1};margin-top:4px;">... truncated at 50 lines ...</div>`
          : "";

      return `${metaHtml}
      <div style="padding:8px;font-family:'SF Mono',Monaco,Consolas,'Liberation Mono',monospace;font-size:11px;color:${C.text};overflow:hidden;max-width:${rpW}px;">
        ${lineHtml}
        ${truncated}
      </div>`;
    } catch {
      return `${metaHtml}<div style="padding:12px;color:${C.red};font-size:12px;">Unable to read file contents.</div>`;
    }
  }

  // Binary file: hex dump preview (first 128 bytes)
  try {
    const buf = readFileSync(entry.fullPath);
    const previewBytes = buf.slice(0, 128);
    const hexLines: string[] = [];

    for (let offset = 0; offset < previewBytes.length; offset += 16) {
      const chunk = previewBytes.slice(offset, offset + 16);
      const addr = offset.toString(16).padStart(8, "0");

      const hexParts: string[] = [];
      const asciiParts: string[] = [];
      for (let j = 0; j < 16; j++) {
        if (j < chunk.length) {
          hexParts.push(chunk[j].toString(16).padStart(2, "0"));
          const byte = chunk[j];
          asciiParts.push(
            byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".",
          );
        } else {
          hexParts.push("  ");
          asciiParts.push(" ");
        }
      }

      const hexStr = hexParts.join(" ");
      const asciiStr = escapeHtml(asciiParts.join(""));
      hexLines.push(
        `<div style="display:flex;gap:8px;line-height:16px;"><span style="color:${C.overlay0};">${addr}</span><span style="color:${C.blue};">${hexStr}</span><span style="color:${C.subtext0};">|${asciiStr}|</span></div>`,
      );
    }

    const truncNote =
      entry.size > 128
        ? `<div style="padding:4px 0;color:${C.overlay0};font-style:italic;text-align:center;border-top:1px solid ${C.surface1};margin-top:4px;">Showing first 128 of ${formatSize(entry.size)}</div>`
        : "";

    return `${metaHtml}
    <div style="padding:8px;font-family:'SF Mono',Monaco,Consolas,'Liberation Mono',monospace;font-size:10px;color:${C.text};overflow:hidden;">
      <div style="color:${C.mauve};margin-bottom:6px;font-size:11px;">Hex Dump</div>
      ${hexLines.join("")}
      ${truncNote}
    </div>`;
  } catch {
    return `${metaHtml}<div style="padding:12px;color:${C.red};font-size:12px;">Unable to read file.</div>`;
  }
}

function safeReadlink(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    return "?";
  }
}

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

interface HitResult {
  area:
    | "pathbar"
    | "pathbar-up"
    | "pathbar-refresh"
    | "pathbar-hidden"
    | "left-pane"
    | "right-pane"
    | "status"
    | "none";
  rowIndex?: number;
}

function hitTest(x: number, y: number): HitResult {
  // Path bar
  if (y < PATH_BAR_H) {
    // Buttons from the right edge: [Hidden] [Refresh] [Up]
    const hiddenBtnX = panelW - BTN_MARGIN_RIGHT - BTN_W;
    const refreshBtnX = hiddenBtnX - BTN_GAP - BTN_W;
    const upBtnX = refreshBtnX - BTN_GAP - BTN_W;

    if (x >= hiddenBtnX && x < hiddenBtnX + BTN_W) {
      return { area: "pathbar-hidden" };
    }
    if (x >= refreshBtnX && x < refreshBtnX + BTN_W) {
      return { area: "pathbar-refresh" };
    }
    if (x >= upBtnX && x < upBtnX + BTN_W) {
      return { area: "pathbar-up" };
    }
    return { area: "pathbar" };
  }

  // Status bar
  if (y >= panelH - STATUS_BAR_H) {
    return { area: "status" };
  }

  // Left pane
  if (x < LEFT_PANE_W) {
    const rowY = y - PATH_BAR_H;
    if (rowY >= 0) {
      const rowIndex = Math.floor((rowY + scrollOffset * ROW_H) / ROW_H);
      return { area: "left-pane", rowIndex };
    }
    return { area: "left-pane" };
  }

  // Right pane
  return { area: "right-pane" };
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function renderHtml(): string {
  const list = filteredEntries();
  clampSelection();

  const vr = visibleRows();
  const visible = list.slice(scrollOffset, scrollOffset + vr);

  // Count stats
  const allVisible = showHidden ? entries : entries.filter((e) => !e.isHidden);
  const folderCount = allVisible.filter((e) => e.isDir).length;
  const fileCount = allVisible.filter((e) => !e.isDir).length;
  const totalSize = allVisible.reduce((s, e) => s + (e.isDir ? 0 : e.size), 0);

  // Truncate path for display
  const displayPath = truncatePath(currentDir, panelW - 140);

  // Path bar buttons (positioned from right)
  const hiddenBtnX = panelW - BTN_MARGIN_RIGHT - BTN_W;
  const refreshBtnX = hiddenBtnX - BTN_GAP - BTN_W;
  const upBtnX = refreshBtnX - BTN_GAP - BTN_W;

  const btnStyle = (active?: boolean) =>
    `display:inline-flex;align-items:center;justify-content:center;width:${BTN_W}px;height:${BTN_W}px;background:${active ? C.blue : C.surface1};color:${active ? C.base : C.text};border-radius:4px;font-size:13px;cursor:pointer;user-select:none;position:absolute;top:4px;`;

  const pathBar = `<div style="height:${PATH_BAR_H}px;background:${C.surface0};display:flex;align-items:center;padding:0 10px;position:relative;flex-shrink:0;border-bottom:1px solid ${C.surface1};">
    <span style="font-size:12px;color:${C.blue};font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:${upBtnX - 20}px;">\u{1F4C1} ${escapeHtml(displayPath)}</span>
    ${filterMode ? `<span style="margin-left:8px;font-size:11px;color:${C.peach};background:${C.surface1};padding:1px 6px;border-radius:3px;">/${escapeHtml(filterText)}<span style="opacity:0.5;">|</span></span>` : ""}
    <div style="${btnStyle()}left:${upBtnX}px;" title="Go to parent">\u2191</div>
    <div style="${btnStyle()}left:${refreshBtnX}px;" title="Refresh">\u27F3</div>
    <div style="${btnStyle(showHidden)}left:${hiddenBtnX}px;" title="Toggle hidden files">\u{1F441}</div>
  </div>`;

  // Left pane rows
  const rows = visible
    .map((entry, i) => {
      const absIdx = scrollOffset + i;
      const isSelected = absIdx === selectedIndex;
      const bg = isSelected
        ? "rgba(137,180,250,0.2)"
        : absIdx % 2 === 0
          ? "transparent"
          : "rgba(49,50,68,0.2)";
      const border = isSelected
        ? `border-left:2px solid ${C.blue};`
        : "border-left:2px solid transparent;";
      const icon = fileIcon(entry);
      const nameColor = entry.isDir
        ? C.blue
        : entry.error
          ? C.red
          : entry.isSymlink
            ? C.teal
            : C.text;
      const sizeStr = entry.isDir ? "" : formatSize(entry.size);
      const selectedMarker = isSelected
        ? `<span style="position:absolute;right:4px;top:50%;transform:translateY(-50%);color:${C.blue};font-size:10px;">\u25C0</span>`
        : "";

      return `<div style="height:${ROW_H}px;display:flex;align-items:center;padding:0 6px;background:${bg};${border}cursor:pointer;user-select:none;position:relative;box-sizing:border-box;overflow:hidden;">
        <span style="font-size:13px;margin-right:5px;flex-shrink:0;width:18px;text-align:center;">${icon}</span>
        <span style="font-size:11px;color:${nameColor};overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1;">${escapeHtml(entry.name)}${entry.isSymlink ? " \u2192" : ""}</span>
        <span style="font-size:9px;color:${C.overlay0};margin-left:auto;flex-shrink:0;padding-left:4px;">${sizeStr}</span>
        ${selectedMarker}
      </div>`;
    })
    .join("");

  // Empty state
  const emptyMsg =
    list.length === 0
      ? `<div style="padding:20px;text-align:center;color:${C.overlay0};font-size:12px;">${filterText ? "No matching files" : "Empty directory"}</div>`
      : "";

  // Right pane: preview
  const selectedEntry = list[selectedIndex];
  const preview = selectedEntry
    ? generatePreview(selectedEntry)
    : `<div style="padding:20px;text-align:center;color:${C.overlay0};font-size:12px;">No file selected</div>`;

  // Status bar
  const filterInfo =
    filterText.length > 0
      ? ` | filter: "${escapeHtml(filterText)}" (${list.length} match${list.length !== 1 ? "es" : ""})`
      : "";
  const statusText = `${allVisible.length} items | ${folderCount} folder${folderCount !== 1 ? "s" : ""}, ${fileCount} file${fileCount !== 1 ? "s" : ""} | ${formatSize(totalSize)}${filterInfo}`;

  const cH = contentH();

  return `<div style="width:${panelW}px;height:${panelH}px;background:${C.base};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;overflow:hidden;display:flex;flex-direction:column;user-select:none;">
  ${pathBar}
  <div style="display:flex;flex:1;min-height:0;height:${cH}px;">
    <!-- Left pane: file list -->
    <div style="width:${LEFT_PANE_W}px;flex-shrink:0;overflow:hidden;border-right:1px solid ${C.surface1};background:${C.mantle};">
      ${rows}
      ${emptyMsg}
    </div>
    <!-- Right pane: preview -->
    <div style="flex:1;overflow:hidden;background:${C.base};">
      <div style="height:${cH}px;overflow:hidden;">
        ${preview}
      </div>
    </div>
  </div>
  <div style="height:${STATUS_BAR_H}px;background:${C.surface0};display:flex;align-items:center;padding:0 10px;flex-shrink:0;border-top:1px solid ${C.surface1};">
    <span style="font-size:10px;color:${C.subtext0};overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${statusText}</span>
  </div>
</div>`;
}

function truncatePath(path: string, maxPxWidth: number): string {
  // Rough estimate: ~7px per char at 12px font size
  const maxChars = Math.floor(maxPxWidth / 7);
  if (path.length <= maxChars) return path;
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  // Show first part + ... + last 2 parts
  return parts[0] + "/.../" + parts.slice(-2).join("/");
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
      width: panelW,
      height: panelH,
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
// Navigation actions
// ---------------------------------------------------------------------------

// Tracks inodes of every directory we descend into so navigation into a
// symlink loop (e.g. `ln -s . self`) aborts instead of recursing forever.
const visitedInodes: Set<number> = new Set();

function navigateTo(dir: string): void {
  const resolved = resolve(dir);
  let inode: number | null = null;
  try {
    // Verify it's a directory we can access
    const st = statSync(resolved, { throwIfNoEntry: false });
    if (!st || !st.isDirectory()) {
      console.log(`Not a directory: ${resolved}`);
      return;
    }
    inode = typeof st.ino === "number" ? st.ino : null;
  } catch {
    console.log(`Cannot access: ${resolved}`);
    return;
  }

  if (inode !== null && visitedInodes.has(inode)) {
    console.log(`Symlink loop detected — refusing to enter ${resolved}`);
    return;
  }

  currentDir = resolved;
  if (inode !== null) visitedInodes.add(inode);
  selectedIndex = 0;
  scrollOffset = 0;
  filterText = "";
  filterMode = false;
  scanDirectory(currentDir);
  console.log(`\u{1F4C1} ${currentDir}`);
  render(true);
}

function navigateUp(): void {
  const parent = dirname(currentDir);
  if (parent !== currentDir) {
    navigateTo(parent);
  }
}

function enterSelected(): void {
  const list = filteredEntries();
  if (list.length === 0) return;

  const entry = list[selectedIndex];
  if (!entry) return;

  if (entry.isDir) {
    navigateTo(entry.fullPath);
  } else {
    // Print the file path to stdout (for shell integration)
    console.log(entry.fullPath);
  }
}

function refreshDirectory(): void {
  scanDirectory(currentDir);
  clampSelection();
  render(true);
}

function toggleHidden(): void {
  showHidden = !showHidden;
  selectedIndex = 0;
  scrollOffset = 0;
  render(true);
}

// ---------------------------------------------------------------------------
// Event handling — sideband events (fd5)
// ---------------------------------------------------------------------------

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  if (evtId === "__system__" && evtType === "error") {
    const code = (event["code"] as string) ?? "unknown";
    const message = (event["message"] as string) ?? "";
    const panelId = (event["panelId"] as string) ?? "";
    process.stderr.write(
      `[files] sideband error: ${code}${panelId ? ` (${panelId})` : ""}${
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

    case "resize": {
      const newW = (event["width"] as number) ?? panelW;
      const newH = (event["height"] as number) ?? panelH;
      if (newW !== panelW || newH !== panelH) {
        panelW = Math.max(400, newW);
        panelH = Math.max(200, newH);
        render(true);
      }
      break;
    }

    case "click": {
      const hit = hitTest(ex, ey);

      switch (hit.area) {
        case "pathbar-up":
          navigateUp();
          return;
        case "pathbar-refresh":
          refreshDirectory();
          return;
        case "pathbar-hidden":
          toggleHidden();
          return;
        case "left-pane": {
          if (hit.rowIndex === undefined) return;
          const list = filteredEntries();
          if (hit.rowIndex < 0 || hit.rowIndex >= list.length) return;

          const now = Date.now();

          // Double-click detection (two clicks on same item within 300ms)
          if (hit.rowIndex === lastClickIndex && now - lastClickTime < 300) {
            // Double click: enter directory or open file
            selectedIndex = hit.rowIndex;
            enterSelected();
            lastClickTime = 0;
            lastClickIndex = -1;
          } else {
            // Single click: select
            selectedIndex = hit.rowIndex;
            lastClickTime = now;
            lastClickIndex = hit.rowIndex;
            render(true);
          }
          return;
        }
      }
      break;
    }

    case "wheel": {
      const deltaY = (event["deltaY"] as number) ?? 0;
      const list = filteredEntries();
      const step = deltaY > 0 ? 3 : -3;
      scrollOffset = Math.max(
        0,
        Math.min(scrollOffset + step, Math.max(0, list.length - visibleRows())),
      );
      render(true);
      break;
    }
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
// Keyboard input (stdin raw mode)
// ---------------------------------------------------------------------------

async function readStdin(): Promise<void> {
  try {
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
          return;
        }

        // In filter mode, handle typing
        if (filterMode) {
          // Escape: cancel filter
          if (byte === 0x1b) {
            filterMode = false;
            filterText = "";
            selectedIndex = 0;
            scrollOffset = 0;
            render(true);
            continue;
          }
          // Enter: accept filter, exit filter mode
          if (byte === 0x0d) {
            filterMode = false;
            render(true);
            continue;
          }
          // Backspace
          if (byte === 0x7f || byte === 0x08) {
            if (filterText.length > 0) {
              filterText = filterText.slice(0, -1);
              selectedIndex = 0;
              scrollOffset = 0;
              render(true);
            } else {
              filterMode = false;
              render(true);
            }
            continue;
          }
          // Printable ASCII
          if (byte >= 0x20 && byte <= 0x7e) {
            filterText += String.fromCharCode(byte);
            selectedIndex = 0;
            scrollOffset = 0;
            render(true);
            continue;
          }
          continue;
        }

        // ESC sequences: arrow keys are ESC [ A/B/C/D
        if (byte === 0x1b && i + 2 < value.length && value[i + 1] === 0x5b) {
          const arrow = value[i + 2];
          i += 2;

          switch (arrow) {
            case 0x41: {
              // Up arrow
              const list = filteredEntries();
              if (list.length > 0) {
                selectedIndex = Math.max(0, selectedIndex - 1);
                clampSelection();
                render(true);
              }
              break;
            }
            case 0x42: {
              // Down arrow
              const list = filteredEntries();
              if (list.length > 0) {
                selectedIndex = Math.min(list.length - 1, selectedIndex + 1);
                clampSelection();
                render(true);
              }
              break;
            }
          }
          continue;
        }

        // Enter: enter directory or print file path
        if (byte === 0x0d) {
          enterSelected();
          continue;
        }

        // Backspace: go to parent directory
        if (byte === 0x7f || byte === 0x08) {
          navigateUp();
          continue;
        }

        // 'q': quit
        if (byte === 0x71) {
          cleanup();
          return;
        }

        // '.': toggle hidden files
        if (byte === 0x2e) {
          toggleHidden();
          continue;
        }

        // '/': start filter mode
        if (byte === 0x2f) {
          filterMode = true;
          filterText = "";
          render(true);
          continue;
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
  writeMeta({ id: PANEL_ID, type: "clear" });
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* already restored */
    }
  }
  console.log("\nFile Explorer closed.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Validate starting directory
try {
  const st = statSync(currentDir);
  if (!st.isDirectory()) {
    console.error(`Not a directory: ${currentDir}`);
    process.exit(1);
  }
} catch {
  console.error(`Cannot access directory: ${currentDir}`);
  process.exit(1);
}

currentDir = resolve(currentDir);
scanDirectory(currentDir);

console.log("HyperTerm File Explorer");
console.log(`Directory: ${currentDir}`);
console.log(`Found ${entries.length} items.\n`);
console.log("Controls:");
console.log("  Up/Down arrows  - navigate file list");
console.log("  Enter           - enter directory / print file path");
console.log("  Backspace       - go to parent directory");
console.log("  .               - toggle hidden files");
console.log("  /               - start search/filter");
console.log("  q or Ctrl+C     - quit");
console.log("  Mouse: click to select, double-click to enter, wheel to scroll");
console.log("  Buttons: [Up] [Refresh] [Hidden] in path bar\n");

// Initial render
render(true);

// Start event loop and keyboard input
readEvents();
readStdin();

// Cleanup on signals
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
