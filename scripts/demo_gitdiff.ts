#!/usr/bin/env bun
/**
 * τ-mux — Live Git Diff Studio
 *
 * Beautiful split-view git diff explorer with:
 * - live auto-refresh on repository changes
 * - colorful file list + stats
 * - line-by-line diff rendering
 * - hunk navigation
 * - mouse + keyboard controls
 *
 * Usage:
 *   bun scripts/demo_gitdiff.ts
 */

import { readFileSync } from "fs";

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PANEL_ID = "gitdiff";
const POLL_INTERVAL = 1200;
const HEADER_H = 44;
const SUMMARY_H = 38;
const FOOTER_H = 30;
const DIFF_HEADER_H = 62;
const SIDEBAR_HEADER_H = 56;
const FILE_ROW_H = 64;
const DIFF_ROW_H = 22;
const REFRESH_BTN_W = 88;
const REFRESH_BTN_H = 28;
const HUNK_BTN_W = 58;
const HUNK_BTN_H = 26;
const MINIMAP_W = 26;
const MINIMAP_GAP = 12;
const MAX_RENDER_LINES = 2500;
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted"
  | "typechange";

type LineKind = "meta" | "hunk" | "ctx" | "add" | "del" | "note";

interface StatusEntry {
  path: string;
  oldPath?: string;
  code: string;
  kind: FileKind;
  label: string;
  color: string;
}

interface DiffLine {
  kind: LineKind;
  leftNo: number | null;
  rightNo: number | null;
  text: string;
}

interface ParsedDiff {
  lines: DiffLine[];
  added: number;
  deleted: number;
  hunks: number;
  hunkStarts: number[];
  binary: boolean;
  truncated: boolean;
  signature: string;
}

interface DiffFile {
  path: string;
  oldPath?: string;
  code: string;
  kind: FileKind;
  label: string;
  color: string;
  added: number;
  deleted: number;
  hunks: number;
  lines: DiffLine[];
  hunkStarts: number[];
  binary: boolean;
  truncated: boolean;
}

interface DiffModel {
  branch: string;
  files: DiffFile[];
  totalAdded: number;
  totalDeleted: number;
  updatedAt: string;
  clean: boolean;
}

interface PatchSegment {
  text: string;
  oldPath: string;
  newPath: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let model: DiffModel = {
  branch: "",
  files: [],
  totalAdded: 0,
  totalDeleted: 0,
  updatedAt: "",
  clean: true,
};

type HoveredControl = "close" | "refresh" | "prev-hunk" | "next-hunk" | null;

let firstRender = true;
let fileScroll = 0;
let diffScroll = 0;
let selectedFileIndex = 0;
let hoveredSidebarIndex: number | null = null;
let hoveredDiffLineIndex: number | null = null;
let hoveredMinimapLine: number | null = null;
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

function compactLayout(): boolean {
  return panelW < 1100 || panelH < 620;
}

function denseLayout(): boolean {
  return panelW < 900 || panelH < 540;
}

function headerH(): number {
  return denseLayout() ? 40 : HEADER_H;
}

function summaryH(): number {
  return denseLayout() ? 34 : SUMMARY_H;
}

function footerH(): number {
  return denseLayout() ? 28 : FOOTER_H;
}

function diffHeaderH(): number {
  return denseLayout() ? 54 : DIFF_HEADER_H;
}

function sidebarHeaderH(): number {
  return denseLayout() ? 50 : SIDEBAR_HEADER_H;
}

function fileRowH(): number {
  return denseLayout() ? 54 : FILE_ROW_H;
}

function diffRowH(): number {
  return denseLayout() ? 20 : DIFF_ROW_H;
}

function refreshBtnW(): number {
  return denseLayout() ? 78 : REFRESH_BTN_W;
}

function refreshBtnH(): number {
  return denseLayout() ? 24 : REFRESH_BTN_H;
}

function hunkBtnW(): number {
  return denseLayout() ? 52 : HUNK_BTN_W;
}

function hunkBtnH(): number {
  return denseLayout() ? 24 : HUNK_BTN_H;
}

function sidebarW(): number {
  if (denseLayout()) return clamp(Math.round(panelW * 0.34), 220, 300);
  if (compactLayout()) return clamp(Math.round(panelW * 0.32), 240, 340);
  return clamp(Math.round(panelW * 0.29), 260, 420);
}

function bodyTop(): number {
  return headerH() + summaryH();
}

function bodyH(): number {
  return Math.max(120, panelH - bodyTop() - footerH());
}

function diffW(): number {
  return Math.max(320, panelW - sidebarW());
}

function showMinimap(): boolean {
  return diffW() >= 520 && diffBodyRowsH() >= 180;
}

function minimapReservedW(): number {
  return showMinimap() ? MINIMAP_W + MINIMAP_GAP + 8 : 0;
}

function sidebarRowsH(): number {
  return Math.max(80, bodyH() - sidebarHeaderH());
}

function diffBodyRowsH(): number {
  return Math.max(100, bodyH() - diffHeaderH());
}

function fileVisibleCount(): number {
  return Math.max(1, Math.floor(sidebarRowsH() / fileRowH()));
}

function diffVisibleCount(): number {
  return Math.max(1, Math.floor(diffBodyRowsH() / diffRowH()));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function extractHunkContext(text: string): string {
  const match = text.match(/@@ [^@]+ @@\s*(.*)/);
  return match?.[1]?.trim() ?? "";
}

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

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hashBytes(input: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const keep = Math.max(4, Math.floor((maxChars - 1) / 2));
  return `${text.slice(0, keep)}…${text.slice(-keep)}`;
}

function applyViewportSize(
  nextViewportW: number,
  nextViewportH: number,
): boolean {
  const safeViewportW = Math.max(360, Math.round(nextViewportW));
  const safeViewportH = Math.max(220, Math.round(nextViewportH));
  const nextPanelW = safeViewportW;
  const nextPanelH = safeViewportH;
  const changed =
    safeViewportW !== viewportW ||
    safeViewportH !== viewportH ||
    nextPanelW !== panelW ||
    nextPanelH !== panelH;

  viewportW = safeViewportW;
  viewportH = safeViewportH;
  panelW = nextPanelW;
  panelH = nextPanelH;
  clampState();
  return changed;
}

function syncPanelSizeFromTerminal(): boolean {
  if (hasRealPixelSize) return false;

  const cols = process.stdout.isTTY ? (process.stdout.columns ?? 0) : 0;
  const rows = process.stdout.isTTY ? (process.stdout.rows ?? 0) : 0;

  const nextViewportW = cols > 0 ? cols * ESTIMATED_CELL_W : 1180;
  const nextViewportH = rows > 0 ? rows * ESTIMATED_CELL_H : 760;
  return applyViewportSize(nextViewportW, nextViewportH);
}

function syncPanelSizeFromEvent(event: Record<string, unknown>): boolean {
  const pxWidth = event["pxWidth"];
  const pxHeight = event["pxHeight"];
  const hasPx = typeof pxWidth === "number" && typeof pxHeight === "number";

  if (!hasPx && hasRealPixelSize) return false;

  if (hasPx) {
    hasRealPixelSize = true;
  }

  const cols = event["cols"];
  const rows = event["rows"];

  const nextViewportW = hasPx
    ? (pxWidth as number)
    : typeof cols === "number"
      ? cols * ESTIMATED_CELL_W
      : viewportW;
  const nextViewportH = hasPx
    ? (pxHeight as number)
    : typeof rows === "number"
      ? rows * ESTIMATED_CELL_H
      : viewportH;

  return applyViewportSize(nextViewportW, nextViewportH);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function badgeColor(kind: FileKind): string {
  switch (kind) {
    case "modified":
      return C.blue;
    case "added":
      return C.green;
    case "deleted":
      return C.red;
    case "renamed":
      return C.mauve;
    case "copied":
      return C.teal;
    case "untracked":
      return C.yellow;
    case "conflicted":
      return C.peach;
    case "typechange":
      return C.pink;
  }
}

function fileIcon(kind: FileKind): string {
  switch (kind) {
    case "modified":
      return "●";
    case "added":
      return "+";
    case "deleted":
      return "−";
    case "renamed":
      return "↪";
    case "copied":
      return "⎘";
    case "untracked":
      return "?";
    case "conflicted":
      return "!";
    case "typechange":
      return "◈";
  }
}

function selectedFile(): DiffFile | null {
  return model.files[selectedFileIndex] ?? null;
}

function currentHunkInfo(file: DiffFile | null): {
  index: number;
  total: number;
} {
  if (!file || file.hunkStarts.length === 0) return { index: 0, total: 0 };

  let index = 0;
  while (
    index + 1 < file.hunkStarts.length &&
    file.hunkStarts[index + 1] <= diffScroll
  ) {
    index++;
  }

  return { index: index + 1, total: file.hunkStarts.length };
}

function clampState(): void {
  if (model.files.length === 0) {
    selectedFileIndex = 0;
    fileScroll = 0;
    diffScroll = 0;
    return;
  }

  selectedFileIndex = clamp(selectedFileIndex, 0, model.files.length - 1);

  const maxFileScroll = Math.max(0, model.files.length - fileVisibleCount());
  if (selectedFileIndex < fileScroll) {
    fileScroll = selectedFileIndex;
  } else if (selectedFileIndex >= fileScroll + fileVisibleCount()) {
    fileScroll = selectedFileIndex - fileVisibleCount() + 1;
  }
  fileScroll = clamp(fileScroll, 0, maxFileScroll);

  const file = selectedFile();
  const maxDiffScroll = Math.max(
    0,
    (file?.lines.length ?? 0) - diffVisibleCount(),
  );
  diffScroll = clamp(diffScroll, 0, maxDiffScroll);
}

function selectFile(index: number): void {
  if (model.files.length === 0) return;
  const next = clamp(index, 0, model.files.length - 1);
  if (next !== selectedFileIndex) {
    selectedFileIndex = next;
    diffScroll = 0;
  }
  clampState();
  render(true);
}

function moveFileSelection(delta: number): void {
  selectFile(selectedFileIndex + delta);
}

function scrollDiff(delta: number): void {
  const file = selectedFile();
  if (!file) return;
  diffScroll += delta;
  clampState();
  render(true);
}

function pageDiff(direction: 1 | -1): void {
  scrollDiff(direction * Math.max(1, diffVisibleCount() - 2));
}

function jumpToHunk(direction: 1 | -1): void {
  const file = selectedFile();
  if (!file || file.hunkStarts.length === 0) return;

  if (direction > 0) {
    for (const start of file.hunkStarts) {
      if (start > diffScroll) {
        diffScroll = start;
        clampState();
        render(true);
        return;
      }
    }
    diffScroll = file.hunkStarts[file.hunkStarts.length - 1];
  } else {
    for (let i = file.hunkStarts.length - 1; i >= 0; i--) {
      if (file.hunkStarts[i] < diffScroll) {
        diffScroll = file.hunkStarts[i];
        clampState();
        render(true);
        return;
      }
    }
    diffScroll = file.hunkStarts[0];
  }

  clampState();
  render(true);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function runGit(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  } catch (err) {
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      code: 1,
    };
  }
}

async function isGitRepo(): Promise<boolean> {
  const result = await runGit(["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

function parseBranchLine(line: string): string {
  const branch = line.replace(/^##\s+/, "").trim();
  if (branch.startsWith("HEAD (no branch)")) return "detached";
  const ellipsis = branch.indexOf("...");
  const bracket = branch.indexOf("[");
  const cut = [ellipsis, bracket]
    .filter((n) => n >= 0)
    .sort((a, b) => a - b)[0];
  return cut === undefined ? branch : branch.slice(0, cut).trim();
}

function statusFromCode(code: string): {
  kind: FileKind;
  label: string;
  color: string;
} {
  if (code === "??") {
    return { kind: "untracked", label: "Untracked", color: C.yellow };
  }
  if (code.includes("U")) {
    return { kind: "conflicted", label: "Conflict", color: C.peach };
  }
  if (code.includes("R")) {
    return { kind: "renamed", label: "Renamed", color: C.mauve };
  }
  if (code.includes("C")) {
    return { kind: "copied", label: "Copied", color: C.teal };
  }
  if (code.includes("A")) {
    return { kind: "added", label: "Added", color: C.green };
  }
  if (code.includes("D")) {
    return { kind: "deleted", label: "Deleted", color: C.red };
  }
  if (code.includes("T")) {
    return { kind: "typechange", label: "Type", color: C.pink };
  }
  return { kind: "modified", label: "Modified", color: C.blue };
}

function parseStatus(text: string): { branch: string; entries: StatusEntry[] } {
  const entries: StatusEntry[] = [];
  let branch = "unknown";

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    if (line.startsWith("## ")) {
      branch = parseBranchLine(line);
      continue;
    }

    if (line.startsWith("!! ")) continue;
    if (line.length < 4) continue;

    const code = line.slice(0, 2);
    const payload = line.slice(3);
    const meta = statusFromCode(code);

    if (
      (code.includes("R") || code.includes("C")) &&
      payload.includes(" -> ")
    ) {
      const [oldPath, newPath] = payload.split(" -> ");
      entries.push({
        path: newPath,
        oldPath,
        code,
        kind: meta.kind,
        label: meta.label,
        color: meta.color,
      });
      continue;
    }

    entries.push({
      path: payload,
      code,
      kind: meta.kind,
      label: meta.label,
      color: meta.color,
    });
  }

  const weight: Record<FileKind, number> = {
    conflicted: 0,
    modified: 1,
    renamed: 2,
    added: 3,
    deleted: 4,
    copied: 5,
    untracked: 6,
    typechange: 7,
  };

  entries.sort((a, b) => {
    const byKind = weight[a.kind] - weight[b.kind];
    if (byKind !== 0) return byKind;
    return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
  });

  return { branch, entries };
}

function normalizeDiffPath(pathSpec: string): string {
  if (pathSpec === "/dev/null") return "";
  return pathSpec.replace(/^[ab]\//, "");
}

function splitCombinedDiff(text: string): PatchSegment[] {
  if (!text.trim()) return [];

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current.length > 0) chunks.push(current);
      current = [line];
      continue;
    }

    if (current.length > 0) current.push(line);
  }

  if (current.length > 0) chunks.push(current);

  return chunks.map((chunk) => {
    const textChunk = chunk.join("\n");
    let oldPath = "";
    let newPath = "";

    for (const line of chunk) {
      if (!oldPath && line.startsWith("--- ")) {
        oldPath = normalizeDiffPath(line.slice(4).trim());
      } else if (!newPath && line.startsWith("+++ ")) {
        newPath = normalizeDiffPath(line.slice(4).trim());
      }
    }

    if (!oldPath || !newPath) {
      const header = chunk[0] ?? "";
      const match = header.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (match) {
        if (!oldPath) oldPath = match[1];
        if (!newPath) newPath = match[2];
      }
    }

    return {
      text: textChunk,
      oldPath,
      newPath,
    };
  });
}

function isProbablyBinary(buf: Uint8Array): boolean {
  if (buf.length === 0) return false;

  let suspicious = 0;
  const sampleLen = Math.min(buf.length, 2048);
  for (let i = 0; i < sampleLen; i++) {
    const byte = buf[i];
    if (byte === 0) return true;
    const isTab = byte === 9;
    const isLf = byte === 10;
    const isCr = byte === 13;
    const isPrintable = byte >= 32 && byte <= 126;
    if (!isTab && !isLf && !isCr && !isPrintable) suspicious++;
  }

  return suspicious / sampleLen > 0.2;
}

const UNTRACKED_PREVIEW_MAX_BYTES = 1024 * 1024; // 1 MiB

function buildSyntheticUntrackedDiff(path: string): ParsedDiff {
  try {
    const rawBuf = readFileSync(path);
    const oversized = rawBuf.byteLength > UNTRACKED_PREVIEW_MAX_BYTES;
    const buf = oversized
      ? rawBuf.subarray(0, UNTRACKED_PREVIEW_MAX_BYTES)
      : rawBuf;
    const signature = hashBytes(rawBuf);

    if (isProbablyBinary(buf)) {
      return {
        lines: [
          {
            kind: "meta",
            leftNo: null,
            rightNo: null,
            text: `diff --git a/${path} b/${path}`,
          },
          {
            kind: "meta",
            leftNo: null,
            rightNo: null,
            text: "new file mode (binary)",
          },
          { kind: "meta", leftNo: null, rightNo: null, text: `+++ b/${path}` },
          {
            kind: "note",
            leftNo: null,
            rightNo: null,
            text: "Binary file preview unavailable",
          },
        ],
        added: 0,
        deleted: 0,
        hunks: 0,
        hunkStarts: [],
        binary: true,
        truncated: false,
        signature,
      };
    }

    const text = new TextDecoder().decode(buf).replace(/\r\n/g, "\n");
    const rawLines = text.split("\n");
    const displayLines: DiffLine[] = [
      {
        kind: "meta",
        leftNo: null,
        rightNo: null,
        text: `diff --git a/${path} b/${path}`,
      },
      {
        kind: "meta",
        leftNo: null,
        rightNo: null,
        text: "new file mode 100644",
      },
      { kind: "meta", leftNo: null, rightNo: null, text: "--- /dev/null" },
      { kind: "meta", leftNo: null, rightNo: null, text: `+++ b/${path}` },
      {
        kind: "hunk",
        leftNo: null,
        rightNo: null,
        text: `@@ -0,0 +1,${Math.max(1, rawLines.length)} @@`,
      },
    ];

    const hunkStarts = [4];
    let added = 0;

    for (let i = 0; i < rawLines.length; i++) {
      if (displayLines.length >= MAX_RENDER_LINES) {
        displayLines.push({
          kind: "note",
          leftNo: null,
          rightNo: null,
          text: "Preview truncated for readability…",
        });
        return {
          lines: displayLines,
          added,
          deleted: 0,
          hunks: 1,
          hunkStarts,
          binary: false,
          truncated: true,
          signature,
        };
      }

      displayLines.push({
        kind: "add",
        leftNo: null,
        rightNo: i + 1,
        text: rawLines[i],
      });
      added++;
    }

    if (oversized) {
      displayLines.push({
        kind: "note",
        leftNo: null,
        rightNo: null,
        text: "…(file too large to preview)",
      });
    }

    return {
      lines: displayLines,
      added,
      deleted: 0,
      hunks: 1,
      hunkStarts,
      binary: false,
      truncated: oversized,
      signature,
    };
  } catch (err) {
    return {
      lines: [
        {
          kind: "meta",
          leftNo: null,
          rightNo: null,
          text: `diff --git a/${path} b/${path}`,
        },
        {
          kind: "note",
          leftNo: null,
          rightNo: null,
          text: `Unable to read file: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      added: 0,
      deleted: 0,
      hunks: 0,
      hunkStarts: [],
      binary: false,
      truncated: false,
      signature: hashString(`error:${path}`),
    };
  }
}

function parsePatchText(patchText: string): ParsedDiff {
  const signature = hashString(patchText);
  if (!patchText.trim()) {
    return {
      lines: [
        {
          kind: "note",
          leftNo: null,
          rightNo: null,
          text: "No textual diff available.",
        },
      ],
      added: 0,
      deleted: 0,
      hunks: 0,
      hunkStarts: [],
      binary: false,
      truncated: false,
      signature,
    };
  }

  const rawLines = patchText.replace(/\r\n/g, "\n").split("\n");
  const lines: DiffLine[] = [];
  const hunkStarts: number[] = [];
  let leftNo = 0;
  let rightNo = 0;
  let added = 0;
  let deleted = 0;
  let hunks = 0;
  let binary = false;
  let truncated = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (i === rawLines.length - 1 && line === "") continue;

    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      leftNo = match ? parseInt(match[1]) : 0;
      rightNo = match ? parseInt(match[2]) : 0;
      hunkStarts.push(lines.length);
      hunks++;
      lines.push({ kind: "hunk", leftNo: null, rightNo: null, text: line });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      lines.push({ kind: "add", leftNo: null, rightNo, text: line.slice(1) });
      rightNo++;
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      lines.push({ kind: "del", leftNo, rightNo: null, text: line.slice(1) });
      leftNo++;
      deleted++;
    } else if (line.startsWith(" ")) {
      lines.push({ kind: "ctx", leftNo, rightNo, text: line.slice(1) });
      leftNo++;
      rightNo++;
    } else if (line.startsWith("\\ No newline")) {
      lines.push({ kind: "note", leftNo: null, rightNo: null, text: line });
    } else {
      if (line.startsWith("Binary files ")) binary = true;
      lines.push({ kind: "meta", leftNo: null, rightNo: null, text: line });
    }

    if (lines.length >= MAX_RENDER_LINES) {
      lines.push({
        kind: "note",
        leftNo: null,
        rightNo: null,
        text: "Preview truncated for readability…",
      });
      truncated = true;
      break;
    }
  }

  return {
    lines,
    added,
    deleted,
    hunks,
    hunkStarts,
    binary,
    truncated,
    signature,
  };
}

async function buildModel(): Promise<{ model: DiffModel; signature: string }> {
  const [statusResult, headResult] = await Promise.all([
    runGit(["status", "--porcelain=v1", "--branch", "--untracked-files=all"]),
    runGit(["rev-parse", "--verify", "HEAD"]),
  ]);

  const status = parseStatus(statusResult.stdout);
  const hasHead = headResult.code === 0;

  const diffResult = hasHead
    ? await runGit([
        "diff",
        "--no-color",
        "--unified=3",
        "--find-renames",
        "HEAD",
        "--",
      ])
    : await runGit([
        "diff",
        "--cached",
        "--no-color",
        "--unified=3",
        "--find-renames",
        "--",
      ]);

  const segments = splitCombinedDiff(diffResult.stdout);
  const segmentMap = new Map<string, PatchSegment>();
  for (const segment of segments) {
    if (segment.newPath) segmentMap.set(segment.newPath, segment);
    if (segment.oldPath) segmentMap.set(segment.oldPath, segment);
  }

  const files: DiffFile[] = [];
  const signatureParts = [
    statusResult.stdout,
    diffResult.stdout,
    status.branch,
  ];

  for (const entry of status.entries) {
    let parsed: ParsedDiff;

    if (entry.kind === "untracked") {
      parsed = buildSyntheticUntrackedDiff(entry.path);
    } else {
      const segment =
        segmentMap.get(entry.path) ??
        (entry.oldPath ? segmentMap.get(entry.oldPath) : undefined);
      parsed = parsePatchText(segment?.text ?? "");
    }

    signatureParts.push(`${entry.path}:${parsed.signature}`);

    files.push({
      path: entry.path,
      oldPath: entry.oldPath,
      code: entry.code,
      kind: entry.kind,
      label: entry.label,
      color: entry.color,
      added: parsed.added,
      deleted: parsed.deleted,
      hunks: parsed.hunks,
      lines: parsed.lines,
      hunkStarts: parsed.hunkStarts,
      binary: parsed.binary,
      truncated: parsed.truncated,
    });
  }

  const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
  const totalDeleted = files.reduce((sum, file) => sum + file.deleted, 0);

  return {
    model: {
      branch: status.branch,
      files,
      totalAdded,
      totalDeleted,
      updatedAt: formatTime(new Date()),
      clean: files.length === 0,
    },
    signature: hashString(signatureParts.join("\u0000")),
  };
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderScrollThumb(
  total: number,
  visible: number,
  offset: number,
): {
  size: number;
  offset: number;
} | null {
  if (total <= visible || total <= 0) return null;
  const track = 100;
  const size = Math.max(12, Math.round((visible / total) * track));
  const maxOffset = total - visible;
  const thumbOffset = Math.round((offset / maxOffset) * (track - size));
  return { size, offset: thumbOffset };
}

function renderButton(
  label: string,
  accent: string,
  hovered: boolean,
  disabled = false,
): string {
  const isRefresh = label === "Refresh";
  const background = disabled
    ? C.surface0
    : hovered
      ? `${accent}26`
      : "rgba(49,50,68,0.88)";
  const border = disabled ? C.surface1 : hovered ? `${accent}88` : C.surface1;
  const color = disabled ? C.overlay0 : hovered ? accent : C.text;
  const shadow = hovered
    ? `0 0 0 1px ${accent}22 inset, 0 8px 24px ${accent}18`
    : "none";

  return `<div style="width:${isRefresh ? refreshBtnW() : hunkBtnW()}px;height:${isRefresh ? refreshBtnH() : hunkBtnH()}px;background:${background};border:1px solid ${border};border-radius:9px;display:flex;align-items:center;justify-content:center;color:${color};font-size:${denseLayout() ? 10 : 11}px;font-weight:700;letter-spacing:0.02em;box-shadow:${shadow};transition:none;cursor:${disabled ? "default" : "pointer"};">${label}</div>`;
}

function renderCloseButton(hovered: boolean): string {
  const size = refreshBtnH();
  const bg = hovered ? `${C.red}26` : "rgba(49,50,68,0.88)";
  const border = hovered ? `${C.red}88` : C.surface1;
  const color = hovered ? C.red : C.overlay0;
  const shadow = hovered
    ? `0 0 0 1px ${C.red}22 inset, 0 8px 24px ${C.red}18`
    : "none";
  return `<div style="width:${size}px;height:${size}px;background:${bg};border:1px solid ${border};border-radius:9px;display:flex;align-items:center;justify-content:center;color:${color};font-size:14px;font-weight:700;box-shadow:${shadow};cursor:pointer;line-height:1;">&times;</div>`;
}

function footerStatusText(): string {
  if (hoveredControl === "close") return "Close Git Diff Studio";
  if (hoveredControl === "refresh") return "Refresh diff snapshot";
  if (hoveredControl === "prev-hunk") return "Jump to previous hunk";
  if (hoveredControl === "next-hunk") return "Jump to next hunk";

  if (hoveredSidebarIndex !== null) {
    const file = model.files[hoveredSidebarIndex];
    if (file) {
      return `${file.label} · ${file.path} · +${file.added} -${file.deleted} · ${file.hunks} hunk${file.hunks === 1 ? "" : "s"}`;
    }
  }

  if (hoveredDiffLineIndex !== null) {
    const file = selectedFile();
    const line = file?.lines[hoveredDiffLineIndex];
    if (file && line) {
      const location = [line.leftNo, line.rightNo]
        .filter((value) => value !== null)
        .join(" → ");
      const kindLabel: Record<LineKind, string> = {
        meta: "meta",
        hunk: "hunk header",
        ctx: "context",
        add: "addition",
        del: "deletion",
        note: "note",
      };
      return `${kindLabel[line.kind]}${location ? ` · ${location}` : ""}`;
    }
  }

  if (hoveredMinimapLine !== null) {
    return `Minimap preview · line ${hoveredMinimapLine + 1}`;
  }

  const file = selectedFile();
  if (file) {
    const total = file.lines.length;
    const pos =
      total > 0
        ? `line ${diffScroll + 1}–${Math.min(diffScroll + diffVisibleCount(), total)} of ${total}`
        : "";
    const pct =
      total > 0
        ? `${Math.round(((diffScroll + diffVisibleCount()) / total) * 100)}%`
        : "";
    return `${selectedFileIndex + 1}/${model.files.length} · ${file.path}${pos ? ` · ${pos} (${pct})` : ""}`;
  }

  return "j/k select files · n/p navigate hunks · space/b page · g/G top/bottom · r refresh · q quit";
}

function renderSidebar(): string {
  const visible = model.files.slice(
    fileScroll,
    fileScroll + fileVisibleCount(),
  );
  const selected = selectedFile();
  const rows = visible
    .map((file, index) => {
      const absoluteIndex = fileScroll + index;
      const isSelected = absoluteIndex === selectedFileIndex;
      const isHovered = absoluteIndex === hoveredSidebarIndex;
      const rowBg = isSelected
        ? "linear-gradient(135deg, rgba(137,180,250,0.24), rgba(137,180,250,0.08))"
        : isHovered
          ? "linear-gradient(135deg, rgba(203,166,247,0.14), rgba(137,180,250,0.04))"
          : absoluteIndex % 2 === 0
            ? "rgba(24,24,37,0.55)"
            : "rgba(17,17,27,0.78)";
      const border = isSelected
        ? `box-shadow: inset 3px 0 0 ${C.blue}, inset 0 0 0 1px rgba(137,180,250,0.16);`
        : isHovered
          ? `box-shadow: inset 2px 0 0 ${C.mauve};`
          : "box-shadow: inset 2px 0 0 transparent;";
      const statBarTotal = Math.max(1, file.added + file.deleted);
      const pathMax = Math.max(22, Math.floor((sidebarW() - 92) / 7));
      const parts = file.path.split("/");
      const name = parts.pop() ?? file.path;
      const dir = parts.join("/");
      const statBarW = Math.max(60, sidebarW() - 140);
      const scaledAddW = Math.round((file.added / statBarTotal) * statBarW);
      const scaledDelW = Math.max(0, statBarW - scaledAddW);

      return `<div style="height:${fileRowH()}px;padding:10px 12px 8px 12px;background:${rowBg};${border}border-bottom:1px solid rgba(88,91,112,0.18);overflow:hidden;cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:4px;">
        <div style="display:flex;align-items:center;gap:9px;">
          <div style="width:22px;height:22px;border-radius:7px;background:${file.color}18;color:${file.color};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">${fileIcon(file.kind)}</div>
          <div style="min-width:0;flex:1;">
            <div style="color:${isSelected ? C.text : C.subtext1};font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(truncateMiddle(name, pathMax))}</div>
            <div style="color:${C.overlay0};font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(dir || "repo root")}</div>
          </div>
          <div style="font-size:9px;color:${file.color};background:${file.color}22;border:1px solid ${file.color}55;border-radius:999px;padding:2px 7px;flex-shrink:0;font-weight:600;">${escapeHtml(file.label)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding-left:31px;">
          <div style="width:${statBarW}px;height:5px;background:${C.surface0};border-radius:999px;overflow:hidden;flex-shrink:0;display:flex;">
            <div style="width:${scaledAddW}px;background:${C.green};"></div>
            <div style="width:${scaledDelW}px;background:${C.red};"></div>
          </div>
          <span style="font-size:10px;color:${C.green};font-weight:700;">+${file.added}</span>
          <span style="font-size:10px;color:${C.red};font-weight:700;">-${file.deleted}</span>
          <span style="font-size:10px;color:${C.overlay0};">${file.hunks}h</span>
        </div>
      </div>`;
    })
    .join("");

  const thumb = renderScrollThumb(
    model.files.length,
    fileVisibleCount(),
    fileScroll,
  );

  return `<div style="width:${sidebarW()}px;height:${bodyH()}px;position:relative;background:linear-gradient(180deg, rgba(24,24,37,0.98), rgba(17,17,27,0.96));border-right:1px solid ${C.surface1};overflow:hidden;flex-shrink:0;">
    <div style="height:${sidebarHeaderH()}px;padding:${denseLayout() ? "10px 12px 8px 12px" : "12px 14px 10px 14px"};border-bottom:1px solid rgba(88,91,112,0.28);background:linear-gradient(180deg, rgba(49,50,68,0.52), rgba(24,24,37,0.2));">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div>
          <div style="font-size:12px;color:${C.text};font-weight:800;letter-spacing:0.02em;">Changed files</div>
          <div style="font-size:10px;color:${C.overlay0};margin-top:4px;">${model.clean ? "No pending changes" : `${model.files.length} tracked/untracked changes`}</div>
        </div>
        <div style="font-size:10px;color:${C.overlay0};background:${C.surface0};border:1px solid rgba(88,91,112,0.36);border-radius:999px;padding:3px 8px;">${selected ? `${selectedFileIndex + 1}/${model.files.length}` : "0/0"}</div>
      </div>
    </div>
    <div style="height:${sidebarRowsH()}px;overflow:hidden;position:relative;">
      ${rows || `<div style="padding:24px 16px;color:${C.overlay0};font-size:12px;">Working tree is clean.</div>`}
    </div>
    ${
      thumb
        ? `<div style="position:absolute;right:4px;top:${sidebarHeaderH() + 8}px;bottom:8px;width:4px;background:${C.surface0};border-radius:999px;opacity:0.5;"><div style="position:absolute;left:0;right:0;height:${thumb.size}px;top:${thumb.offset}px;background:${hoveredSidebarIndex !== null ? C.blue : C.overlay0};border-radius:999px;"></div></div>`
        : ""
    }
  </div>`;
}

function renderDiffMinimap(file: DiffFile | null): string {
  if (!showMinimap()) return "";
  const trackH = diffBodyRowsH() - 16;
  if (!file || file.lines.length === 0) {
    return `<div style="position:absolute;right:8px;top:8px;width:${MINIMAP_W}px;height:${trackH}px;border-radius:12px;background:rgba(49,50,68,0.46);border:1px solid rgba(88,91,112,0.28);"></div>`;
  }

  const total = file.lines.length;
  const bucketCount = Math.min(96, Math.max(28, Math.floor(trackH / 3)));
  const bucketSize = Math.max(1, Math.ceil(total / bucketCount));
  const markers: string[] = [];

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = bucket * bucketSize;
    if (start >= total) break;
    const end = Math.min(total, start + bucketSize);
    let color = C.overlay0;
    let opacity = 0.18;

    for (let i = start; i < end; i++) {
      const kind = file.lines[i]?.kind;
      if (kind === "del") {
        color = C.red;
        opacity = 0.88;
        break;
      }
      if (kind === "add") {
        color = C.green;
        opacity = 0.88;
      } else if (kind === "hunk" && opacity < 0.76) {
        color = C.blue;
        opacity = 0.76;
      } else if (kind === "note" && opacity < 0.66) {
        color = C.yellow;
        opacity = 0.66;
      } else if (kind === "meta" && opacity < 0.34) {
        color = C.overlay0;
        opacity = 0.34;
      }
    }

    const top = Math.round((start / total) * trackH);
    const height = Math.max(2, Math.round(((end - start) / total) * trackH));
    markers.push(
      `<div style="position:absolute;left:4px;right:4px;top:${top}px;height:${height}px;background:${color};opacity:${opacity};border-radius:999px;"></div>`,
    );
  }

  const visible = diffVisibleCount();
  const viewportH = Math.max(
    18,
    Math.round((Math.min(total, visible) / total) * trackH),
  );
  const viewportY =
    total <= visible
      ? 0
      : Math.round(
          (diffScroll / Math.max(1, total - visible)) * (trackH - viewportH),
        );
  const hoverY =
    hoveredMinimapLine !== null
      ? Math.round((hoveredMinimapLine / Math.max(1, total - 1)) * trackH)
      : null;

  return `<div style="position:absolute;right:8px;top:8px;width:${MINIMAP_W}px;height:${trackH}px;border-radius:12px;background:rgba(17,17,27,0.78);border:1px solid rgba(88,91,112,0.32);overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);cursor:pointer;">
    ${markers.join("")}
    <div style="position:absolute;left:2px;right:2px;top:${viewportY}px;height:${viewportH}px;border-radius:999px;background:${C.blue}22;border:1px solid ${C.blue}66;box-shadow:0 0 0 1px rgba(137,180,250,0.08);"></div>
    ${hoverY !== null ? `<div style="position:absolute;left:1px;right:1px;top:${hoverY}px;height:2px;background:${C.yellow};opacity:0.95;border-radius:999px;"></div>` : ""}
  </div>`;
}

function renderDiffHeader(file: DiffFile | null): string {
  const hunkInfo = currentHunkInfo(file);
  const rightMeta =
    hunkInfo.total > 0
      ? `hunk ${hunkInfo.index}/${hunkInfo.total}`
      : "no hunks";

  if (!file) {
    return `<div style="height:${diffHeaderH()}px;padding:${denseLayout() ? "10px 12px" : "12px 16px"};border-bottom:1px solid ${C.surface1};display:flex;align-items:center;justify-content:space-between;position:relative;background:linear-gradient(180deg, rgba(49,50,68,0.22), rgba(30,30,46,0.04));">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:22px;height:22px;border-radius:7px;background:${C.green}18;color:${C.green};display:flex;align-items:center;justify-content:center;font-size:14px;">&#10003;</div>
        <div>
          <div style="font-size:14px;color:${C.text};font-weight:800;">Working tree clean</div>
          <div style="font-size:11px;color:${C.overlay0};margin-top:3px;">Live watcher active — changes appear automatically every ${POLL_INTERVAL / 1000}s</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;opacity:0.5;">
        ${renderButton("Prev", C.mauve, hoveredControl === "prev-hunk", true)}
        ${renderButton("Next", C.blue, hoveredControl === "next-hunk", true)}
      </div>
    </div>`;
  }

  const titleMax = Math.max(28, Math.floor((diffW() - 260) / 8));

  return `<div style="height:${diffHeaderH()}px;padding:${denseLayout() ? "10px 12px" : "12px 16px"};border-bottom:1px solid ${C.surface1};display:flex;align-items:center;justify-content:space-between;position:relative;background:linear-gradient(180deg, rgba(49,50,68,0.22), rgba(30,30,46,0.04));">
    <div style="min-width:0;max-width:${Math.max(260, diffW() - 220)}px;">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;">
        <div style="width:20px;height:20px;border-radius:7px;background:${file.color}18;color:${file.color};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">${fileIcon(file.kind)}</div>
        <span style="font-size:12px;color:${file.color};background:${file.color}18;border:1px solid ${file.color}44;border-radius:999px;padding:2px 8px;flex-shrink:0;">${escapeHtml(file.label)}</span>
        <span style="font-size:14px;font-weight:800;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(truncateMiddle(file.path, titleMax))}</span>
      </div>
      <div style="font-size:11px;color:${C.overlay0};margin-top:5px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <span><span style="color:${C.green};font-weight:700;">+${file.added}</span> <span style="color:${C.red};font-weight:700;">-${file.deleted}</span></span>
        <span style="color:${C.surface2};">|</span>
        <span>${file.hunks} hunk${file.hunks === 1 ? "" : "s"}</span>
        <span style="color:${C.surface2};">|</span>
        <span>${file.lines.length} lines</span>
        ${file.oldPath ? `<span style="color:${C.surface2};">|</span><span style="color:${C.mauve};">from ${escapeHtml(truncateMiddle(file.oldPath, 32))}</span>` : ""}
        ${file.binary ? `<span style="color:${C.surface2};">|</span><span style="color:${C.yellow};font-weight:600;">binary</span>` : ""}
        ${file.truncated ? `<span style="color:${C.surface2};">|</span><span style="color:${C.peach};font-weight:600;">truncated</span>` : ""}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
      <div style="font-size:11px;color:${C.overlay0};margin-right:4px;">${rightMeta}</div>
      ${renderButton("Prev", C.mauve, hoveredControl === "prev-hunk", file.hunkStarts.length === 0)}
      ${renderButton("Next", C.blue, hoveredControl === "next-hunk", file.hunkStarts.length === 0)}
    </div>
  </div>`;
}

function renderDiffRows(file: DiffFile | null): string {
  const lines = file?.lines ?? [];
  const visible = lines.slice(diffScroll, diffScroll + diffVisibleCount());
  const activeHunk = currentHunkInfo(file).index;
  const activeHunkLine =
    file && activeHunk > 0 ? file.hunkStarts[activeHunk - 1] : -1;
  const lineContentW = Math.max(240, diffW() - minimapReservedW());

  const rows = visible
    .map((line, index) => {
      const absoluteIndex = diffScroll + index;
      const isHovered = absoluteIndex === hoveredDiffLineIndex;
      let bg = "transparent";
      let fg = C.text;
      let marker = " ";

      switch (line.kind) {
        case "meta":
          bg =
            absoluteIndex % 2 === 0
              ? "rgba(49,50,68,0.12)"
              : "rgba(49,50,68,0.20)";
          fg = C.overlay0;
          marker = "·";
          break;
        case "hunk":
          bg =
            absoluteIndex === activeHunkLine
              ? "rgba(203,166,247,0.26)"
              : "rgba(137,180,250,0.20)";
          fg = absoluteIndex === activeHunkLine ? C.mauve : C.blue;
          marker = "@@";
          break;
        case "ctx":
          bg =
            absoluteIndex % 2 === 0
              ? "rgba(17,17,27,0.10)"
              : "rgba(17,17,27,0.18)";
          fg = C.subtext0;
          marker = " ";
          break;
        case "add":
          bg = "rgba(166,227,161,0.18)";
          fg = C.green;
          marker = "+";
          break;
        case "del":
          bg = "rgba(243,139,168,0.18)";
          fg = C.red;
          marker = "−";
          break;
        case "note":
          bg = "rgba(249,226,175,0.14)";
          fg = C.yellow;
          marker = "!";
          break;
      }

      if (isHovered) {
        bg =
          line.kind === "add"
            ? "rgba(166,227,161,0.28)"
            : line.kind === "del"
              ? "rgba(243,139,168,0.28)"
              : line.kind === "hunk"
                ? "rgba(203,166,247,0.32)"
                : "rgba(137,180,250,0.18)";
      }

      const markerColor =
        line.kind === "add"
          ? C.green
          : line.kind === "del"
            ? C.red
            : line.kind === "hunk"
              ? fg
              : line.kind === "note"
                ? C.yellow
                : C.overlay0;

      const fontSize = denseLayout() ? 10 : 11;
      const gutterFont = `font-family:'SF Mono',Monaco,Consolas,monospace;font-size:${fontSize}px;`;
      const leftNum = line.leftNo ?? "";
      const rightNum = line.rightNo ?? "";
      const gutterBg =
        line.kind === "add"
          ? "rgba(166,227,161,0.08)"
          : line.kind === "del"
            ? "rgba(243,139,168,0.08)"
            : "rgba(49,50,68,0.18)";
      const hunkContext =
        line.kind === "hunk" ? extractHunkContext(line.text) : "";

      return `<div style="height:${diffRowH()}px;display:flex;align-items:center;background:${bg};font-family:'SF Mono',Monaco,Consolas,'JetBrains Mono',monospace;font-size:${fontSize}px;line-height:${diffRowH()}px;width:${lineContentW}px;border-bottom:${isHovered ? `1px solid ${C.blue}22` : "1px solid transparent"};cursor:default;">
        <div style="width:28px;color:${markerColor};text-align:center;flex-shrink:0;font-weight:700;opacity:0.9;">${marker}</div>
        <div style="width:52px;color:${line.kind === "del" ? C.red + "88" : C.overlay0};text-align:right;padding-right:6px;box-sizing:border-box;flex-shrink:0;background:${gutterBg};${gutterFont}">${leftNum}</div>
        <div style="width:52px;color:${line.kind === "add" ? C.green + "88" : C.overlay0};text-align:right;padding-right:6px;box-sizing:border-box;flex-shrink:0;background:${gutterBg};border-right:1px solid rgba(88,91,112,0.22);${gutterFont}">${rightNum}</div>
        <div style="flex:1;color:${fg};white-space:pre;overflow:hidden;padding:0 10px;">${line.kind === "hunk" && hunkContext ? `<span style="color:${C.overlay0};">${escapeHtml(line.text.split("@@").slice(0, 2).join("@@"))}@@</span> <span style="color:${C.mauve};font-weight:600;">${escapeHtml(hunkContext)}</span>` : escapeHtml(line.text || " ")}</div>
      </div>`;
    })
    .join("");

  const emptyMsg = file
    ? `<div style="padding:28px;color:${C.overlay0};font-size:12px;">No textual diff for this file.</div>`
    : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;opacity:0.6;">
        <div style="font-size:28px;">&#916;</div>
        <div style="font-size:13px;color:${C.subtext0};font-weight:600;">No changes to display</div>
        <div style="font-size:11px;color:${C.overlay0};">Edit a file and changes will appear here</div>
      </div>`;

  const diffThumb = renderScrollThumb(
    lines.length,
    diffVisibleCount(),
    diffScroll,
  );
  const diffScrollBar =
    diffThumb && !showMinimap()
      ? `<div style="position:absolute;right:4px;top:8px;bottom:8px;width:4px;background:${C.surface0};border-radius:999px;opacity:0.5;"><div style="position:absolute;left:0;right:0;height:${diffThumb.size}px;top:${diffThumb.offset}px;background:${C.blue};border-radius:999px;opacity:0.7;"></div></div>`
      : "";

  return `<div style="position:relative;height:${diffBodyRowsH()}px;overflow:hidden;background:linear-gradient(180deg, rgba(17,17,27,0.98), rgba(17,17,27,0.92));">
    <div style="position:absolute;left:0;top:0;bottom:0;right:${minimapReservedW()}px;overflow:hidden;">
      ${rows || emptyMsg}
    </div>
    ${renderDiffMinimap(file)}
    ${diffScrollBar}
  </div>`;
}

function buildPage(): string {
  clampState();
  const file = selectedFile();
  const changedCounts = model.files.reduce(
    (acc, entry) => {
      acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<FileKind, number>,
  );
  const summaryBg = model.clean
    ? "linear-gradient(90deg, rgba(166,227,161,0.16), rgba(148,226,213,0.08))"
    : "linear-gradient(90deg, rgba(137,180,250,0.16), rgba(203,166,247,0.08))";
  const summaryText = model.clean
    ? "Working tree clean"
    : `${model.files.length} file${model.files.length === 1 ? "" : "s"} changed`;

  return `<div style="width:${panelW}px;height:${panelH}px;background:${C.base};color:${C.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;overflow:hidden;display:flex;flex-direction:column;user-select:none;">
    <style>
      * { box-sizing: border-box; }
    </style>

    <div style="height:${headerH()}px;background:linear-gradient(180deg, rgba(49,50,68,0.98), rgba(30,30,46,0.98));border-bottom:1px solid ${C.surface1};display:flex;align-items:center;justify-content:space-between;padding:0 ${denseLayout() ? 12 : 16}px;flex-shrink:0;box-shadow:0 10px 30px rgba(0,0,0,0.16);">
      <div style="display:flex;align-items:center;gap:12px;min-width:0;">
        <div style="width:12px;height:12px;border-radius:999px;background:${model.clean ? C.green : C.blue};box-shadow:0 0 18px ${model.clean ? C.green : C.blue}88;"></div>
        <div style="display:flex;flex-direction:column;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <span style="font-size:15px;font-weight:800;color:${C.text};">Git Diff Studio</span>
            <span style="font-size:11px;color:${C.blue};background:${C.blue}18;border:1px solid ${C.blue}44;border-radius:999px;padding:2px 8px;flex-shrink:0;">${escapeHtml(model.branch || "unknown")}</span>
            <span style="font-size:10px;color:${C.overlay0};flex-shrink:0;">live</span>
          </div>
          <div style="font-size:10px;color:${C.overlay0};margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Beautiful live diff explorer · responsive mouse navigation · fixed full-terminal canvas</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        ${renderButton("Refresh", C.blue, hoveredControl === "refresh")}
        ${renderCloseButton(hoveredControl === "close")}
      </div>
    </div>

    <div style="height:${summaryH()}px;background:${summaryBg};border-bottom:1px solid ${C.surface1};display:flex;align-items:center;justify-content:space-between;padding:0 ${denseLayout() ? 12 : 16}px;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:12px;font-size:11px;min-width:0;flex-wrap:wrap;">
        <span style="color:${model.clean ? C.green : C.text};font-weight:800;">${summaryText}</span>
        <span style="color:${C.green};font-weight:700;">+${model.totalAdded}</span>
        <span style="color:${C.red};font-weight:700;">-${model.totalDeleted}</span>
        ${changedCounts.modified ? `<span style="color:${C.blue};">${changedCounts.modified} modified</span>` : ""}
        ${changedCounts.added ? `<span style="color:${C.green};">${changedCounts.added} added</span>` : ""}
        ${changedCounts.deleted ? `<span style="color:${C.red};">${changedCounts.deleted} deleted</span>` : ""}
        ${changedCounts.untracked ? `<span style="color:${C.yellow};">${changedCounts.untracked} untracked</span>` : ""}
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:${C.overlay0};flex-shrink:0;">
        ${changedCounts.renamed ? `<span style="color:${C.mauve};">${changedCounts.renamed} renamed</span>` : ""}
        ${changedCounts.copied ? `<span style="color:${C.teal};">${changedCounts.copied} copied</span>` : ""}
        ${changedCounts.typechange ? `<span style="color:${C.pink};">${changedCounts.typechange} typechange</span>` : ""}
        ${changedCounts.conflicted ? `<span style="color:${C.peach};">${changedCounts.conflicted} conflicted</span>` : ""}
      </div>
    </div>

    <div style="display:flex;height:${bodyH()}px;min-height:0;flex-shrink:0;">
      ${renderSidebar()}
      <div style="width:${diffW()}px;height:${bodyH()}px;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(180deg, rgba(30,30,46,0.98), rgba(17,17,27,0.98));">
        ${renderDiffHeader(file)}
        ${renderDiffRows(file)}
      </div>
    </div>

    <div style="height:${footerH()}px;background:linear-gradient(180deg, rgba(49,50,68,0.96), rgba(49,50,68,1));border-top:1px solid ${C.surface1};display:flex;align-items:center;justify-content:space-between;padding:0 ${denseLayout() ? 12 : 16}px;font-size:10px;color:${C.overlay0};flex-shrink:0;gap:16px;">
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(footerStatusText())}</span>
      <span style="flex-shrink:0;">updated ${model.updatedAt}</span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Rendering
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
  | { area: "prev-hunk" }
  | { area: "next-hunk" }
  | { area: "sidebar-row"; index: number }
  | { area: "sidebar" }
  | { area: "diff-row"; index: number }
  | { area: "minimap"; line: number }
  | { area: "diff" }
  | { area: "none" };

function hitTest(x: number, y: number): HitResult {
  const horizontalPad = denseLayout() ? 12 : 16;
  const closeSize = refreshBtnH();
  const closeX = panelW - horizontalPad - closeSize;
  const closeY = Math.round((headerH() - closeSize) / 2);
  const refreshX = closeX - 8 - refreshBtnW();
  const refreshY = Math.round((headerH() - refreshBtnH()) / 2);

  if (
    y >= closeY &&
    y < closeY + closeSize &&
    x >= closeX &&
    x < closeX + closeSize
  ) {
    return { area: "close" };
  }

  if (
    y >= refreshY &&
    y < refreshY + refreshBtnH() &&
    x >= refreshX &&
    x < refreshX + refreshBtnW()
  ) {
    return { area: "refresh" };
  }

  if (y >= bodyTop() && y < bodyTop() + bodyH()) {
    if (x < sidebarW()) {
      const localY = y - bodyTop();
      if (localY < sidebarHeaderH()) return { area: "sidebar" };
      const rowY = localY - sidebarHeaderH();
      const index = fileScroll + Math.floor(rowY / fileRowH());
      return { area: "sidebar-row", index };
    }

    const diffHeaderY = y - bodyTop();
    if (diffHeaderY >= 0 && diffHeaderY < diffHeaderH()) {
      const horizontalPad = denseLayout() ? 12 : 16;
      const prevButtonX = panelW - horizontalPad - hunkBtnW() * 2 - 8;
      const nextButtonX = panelW - horizontalPad - hunkBtnW();
      const top = bodyTop() + Math.round((diffHeaderH() - hunkBtnH()) / 2);
      if (
        y >= top &&
        y < top + hunkBtnH() &&
        x >= prevButtonX &&
        x < prevButtonX + hunkBtnW()
      ) {
        return { area: "prev-hunk" };
      }
      if (
        y >= top &&
        y < top + hunkBtnH() &&
        x >= nextButtonX &&
        x < nextButtonX + hunkBtnW()
      ) {
        return { area: "next-hunk" };
      }
      return { area: "diff" };
    }

    const diffBodyTop = bodyTop() + diffHeaderH();
    const diffBodyBottom = diffBodyTop + diffBodyRowsH();
    if (y >= diffBodyTop && y < diffBodyBottom) {
      const minimapX = panelW - 8 - MINIMAP_W;
      if (showMinimap() && x >= minimapX && x < minimapX + MINIMAP_W) {
        const file = selectedFile();
        const total = file?.lines.length ?? 0;
        const localY = clamp(y - diffBodyTop - 8, 0, diffBodyRowsH() - 16);
        const line =
          total > 0
            ? clamp(
                Math.round(
                  (localY / Math.max(1, diffBodyRowsH() - 16)) * (total - 1),
                ),
                0,
                total - 1,
              )
            : 0;
        return { area: "minimap", line };
      }

      const index = diffScroll + Math.floor((y - diffBodyTop) / diffRowH());
      return { area: "diff-row", index };
    }

    return { area: "diff" };
  }

  return { area: "none" };
}

function updateHoverState(hit: HitResult): boolean {
  const before = `${hoveredSidebarIndex ?? ""}|${hoveredDiffLineIndex ?? ""}|${hoveredMinimapLine ?? ""}|${hoveredControl ?? ""}`;

  hoveredSidebarIndex = null;
  hoveredDiffLineIndex = null;
  hoveredMinimapLine = null;
  hoveredControl = null;

  switch (hit.area) {
    case "close":
    case "refresh":
    case "prev-hunk":
    case "next-hunk":
      hoveredControl = hit.area;
      break;
    case "sidebar-row":
      if (hit.index >= 0 && hit.index < model.files.length) {
        hoveredSidebarIndex = hit.index;
      }
      break;
    case "diff-row": {
      const file = selectedFile();
      if (file && hit.index >= 0 && hit.index < file.lines.length) {
        hoveredDiffLineIndex = hit.index;
      }
      break;
    }
    case "minimap": {
      const file = selectedFile();
      if (file && file.lines.length > 0) {
        hoveredMinimapLine = clamp(hit.line, 0, file.lines.length - 1);
      }
      break;
    }
  }

  const after = `${hoveredSidebarIndex ?? ""}|${hoveredDiffLineIndex ?? ""}|${hoveredMinimapLine ?? ""}|${hoveredControl ?? ""}`;
  return before !== after;
}

// ---------------------------------------------------------------------------
// Refresh loop
// ---------------------------------------------------------------------------

async function refreshModel(forceRender = false): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;

  try {
    const sizeChanged = syncPanelSizeFromTerminal();
    const previousPath = selectedFile()?.path ?? null;
    const previousScroll = diffScroll;
    const built = await buildModel();

    model = built.model;
    const nextIndex = previousPath
      ? model.files.findIndex((file) => file.path === previousPath)
      : -1;

    selectedFileIndex = nextIndex >= 0 ? nextIndex : 0;
    diffScroll = previousScroll;
    clampState();

    if (forceRender || sizeChanged || built.signature !== lastSignature) {
      lastSignature = built.signature;
      render(true);
    }
  } catch (err) {
    console.log(
      `git diff refresh failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    refreshInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function cleanup(): void {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
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
  console.log("\nGit Diff Studio closed.");
  process.exit(0);
}

function handleKeyByte(byte: number, next?: number): boolean {
  switch (byte) {
    case 0x03: // Ctrl+C
    case 0x71: // q
      cleanup();
      return true;

    case 0x6a: // j
      moveFileSelection(1);
      return true;

    case 0x6b: // k
      moveFileSelection(-1);
      return true;

    case 0x6e: // n
      jumpToHunk(1);
      return true;

    case 0x70: // p
      jumpToHunk(-1);
      return true;

    case 0x72: // r
      refreshModel(true);
      return true;

    case 0x20: // space
      pageDiff(1);
      return true;

    case 0x62: // b
      pageDiff(-1);
      return true;

    case 0x67: // g
      diffScroll = 0;
      clampState();
      render(true);
      return true;

    case 0x47: // G
      diffScroll = Number.MAX_SAFE_INTEGER;
      clampState();
      render(true);
      return true;

    case 0x1b:
      if (next === 0x5b) {
        return false;
      }
      return true;
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

      if (byte === 0x1b && i + 2 < data.length && data[i + 1] === 0x5b) {
        const arrow = data[i + 2];
        i += 2;

        if (arrow === 0x41) {
          moveFileSelection(-1);
        } else if (arrow === 0x42) {
          moveFileSelection(1);
        }
        continue;
      }

      handleKeyByte(byte, data[i + 1]);
    }
  };

  process.stdin.on("data", stdinHandler);
}

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  if (evtId === "__system__" && evtType === "error") {
    const code = (event["code"] as string) ?? "unknown";
    const message = (event["message"] as string) ?? "";
    const panelId = (event["panelId"] as string) ?? "";
    process.stderr.write(
      `[gitdiff] sideband error: ${code}${panelId ? ` (${panelId})` : ""}${
        message ? ` — ${message}` : ""
      }\n`,
    );
    return;
  }

  if (evtId === "__terminal__" && evtType === "resize") {
    if (syncPanelSizeFromEvent(event)) {
      render(true);
    }
    return;
  }

  if (evtId !== PANEL_ID) return;

  const x = (event["x"] as number) ?? 0;
  const y = (event["y"] as number) ?? 0;

  switch (evtType) {
    case "close":
      cleanup();
      break;

    case "mouseenter":
    case "mousemove": {
      const hit = hitTest(x, y);
      if (updateHoverState(hit)) {
        render();
      }
      break;
    }

    case "mouseleave": {
      if (updateHoverState({ area: "none" })) {
        render();
      }
      break;
    }

    case "resize": {
      const newViewportW = (event["width"] as number) ?? viewportW;
      const newViewportH = (event["height"] as number) ?? viewportH;
      if (applyViewportSize(newViewportW, newViewportH)) {
        render(true);
      }
      break;
    }

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
      if (hit.area === "prev-hunk") {
        jumpToHunk(-1);
        return;
      }
      if (hit.area === "next-hunk") {
        jumpToHunk(1);
        return;
      }
      if (hit.area === "sidebar-row") {
        if (hit.index >= 0 && hit.index < model.files.length) {
          selectFile(hit.index);
        }
        return;
      }
      if (hit.area === "minimap") {
        const file = selectedFile();
        if (file && file.lines.length > 0) {
          diffScroll = hit.line - Math.floor(diffVisibleCount() / 2);
          clampState();
          render(true);
        }
        return;
      }
      if (hit.area === "diff-row") {
        const file = selectedFile();
        if (file && hit.index >= 0 && hit.index < file.lines.length) {
          hoveredDiffLineIndex = hit.index;
          render(true);
        }
      }
      break;
    }

    case "wheel": {
      const deltaY = (event["deltaY"] as number) ?? 0;
      const step = deltaY > 0 ? 3 : -3;
      if (x < sidebarW()) {
        fileScroll += step;
        const max = Math.max(0, model.files.length - fileVisibleCount());
        fileScroll = clamp(fileScroll, 0, max);
        render(true);
      } else {
        scrollDiff(step * 2);
      }
      break;
    }
  }
}

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

      let idx = 0;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* invalid event */
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

console.log("Git Diff Studio");
console.log("Polished live-updating git diff explorer fixed to terminal size.");
console.log(
  "It adapts to terminal resize and reflows the layout automatically.",
);
console.log(
  "Controls: j/k or ↑/↓ files, n/p hunks, space/b page, g/G top/bottom, r refresh, q quit.",
);
console.log(
  "Mouse: hover rows, click files, click minimap, wheel scroll, click Prev/Next hunk.",
);
console.log(
  "This view is a fixed full-terminal overlay — use q or Ctrl+C to exit.\n",
);

await refreshModel(true);
startStdinReader();
refreshTimer = setInterval(() => {
  refreshModel();
}, POLL_INTERVAL);

process.on("SIGWINCH", () => {
  if (syncPanelSizeFromTerminal()) {
    render(true);
  }
});

if (process.stdout.isTTY) {
  process.stdout.on("resize", () => {
    if (syncPanelSizeFromTerminal()) {
      render(true);
    }
  });
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
