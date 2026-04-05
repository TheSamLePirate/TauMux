#!/usr/bin/env bun
/**
 * HyperTerm Canvas — Live Markdown Previewer
 *
 * Renders a markdown file to a styled HTML panel with Catppuccin Mocha dark
 * theme. Watches the file for changes and auto-refreshes the panel.
 *
 * Usage:
 *   bun scripts/demo_mdpreview.ts README.md
 *   bun scripts/demo_mdpreview.ts path/to/file.md
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

const hasHyperTerm = META_FD !== null && DATA_FD !== null;

if (!hasHyperTerm) {
  console.log(
    "This script requires HyperTerm Canvas.\n" +
      "Run it inside the HyperTerm terminal emulator.",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI argument — file path
// ---------------------------------------------------------------------------

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: bun scripts/demo_mdpreview.ts <file.md>");
  process.exit(1);
}

const resolvedPath = Bun.resolveSync(filePath, process.cwd());
const fileName = resolvedPath.split("/").pop() ?? filePath;

const PANEL_ID = "md";
const PANEL_W = 600;
const PANEL_H = 700;
const POLL_INTERVAL = 500;

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
  blue: "#89b4fa",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  red: "#f38ba8",
  pink: "#f5c2e7",
  mauve: "#cba6f7",
  teal: "#94e2d5",
  peach: "#fab387",
  lavender: "#b4befe",
} as const;

// ---------------------------------------------------------------------------
// Lightweight Markdown Parser
// ---------------------------------------------------------------------------

/** Escape HTML special characters. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Apply inline formatting: bold, italic, code, links, images. */
function inlineFormat(text: string): string {
  let out = escapeHtml(text);

  // Images: ![alt](src)
  out = out.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px;margin:4px 0;" />',
  );

  // Links: [text](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="$2" style="color:${C.blue};text-decoration:underline;" target="_blank">$1</a>`,
  );

  // Inline code: `code`
  out = out.replace(
    /`([^`]+)`/g,
    `<code style="background:${C.surface0};color:${C.yellow};padding:2px 5px;border-radius:3px;font-size:0.9em;">$1</code>`,
  );

  // Bold + italic: ***text*** or ___text___
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/___(.+?)___/g, "<strong><em>$1</em></strong>");

  // Bold: **text** or __text__
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  out = out.replace(/(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g, "<em>$1</em>");

  return out;
}

/** Parse GFM pipe table from a block of lines. Returns HTML string. */
function parseTable(lines: string[]): string {
  if (lines.length < 2) return "";

  const parseRow = (line: string): string[] =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const headers = parseRow(lines[0]);
  // lines[1] is the separator row (ignored beyond validation)
  const bodyRows = lines.slice(2).map(parseRow);

  let html = `<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:0.9em;">`;
  html += "<thead><tr>";
  for (const h of headers) {
    html += `<th style="text-align:left;padding:8px 12px;border-bottom:2px solid ${C.surface1};color:${C.blue};font-weight:600;">${inlineFormat(h)}</th>`;
  }
  html += "</tr></thead><tbody>";

  for (let r = 0; r < bodyRows.length; r++) {
    const bg = r % 2 === 0 ? C.surface0 : C.base;
    html += `<tr style="background:${bg};">`;
    for (let c = 0; c < headers.length; c++) {
      const cell = bodyRows[r][c] ?? "";
      html += `<td style="padding:8px 12px;border-bottom:1px solid ${C.surface1};">${inlineFormat(cell)}</td>`;
    }
    html += "</tr>";
  }

  html += "</tbody></table>";
  return html;
}

/** Main markdown-to-HTML converter. Processes line by line with block state. */
function markdownToHtml(source: string): string {
  const lines = source.split("\n");
  const output: string[] = [];
  let i = 0;

  // Block state
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  let inUl = false;
  let ulLines: string[] = [];

  let inOl = false;
  let olLines: string[] = [];

  let paragraphLines: string[] = [];

  // Flush helpers ---------------------------------------------------------

  function flushParagraph(): void {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join("\n");
    output.push(
      `<p style="margin:0 0 12px 0;line-height:1.6;">${inlineFormat(text)}</p>`,
    );
    paragraphLines = [];
  }

  function flushBlockquote(): void {
    if (!inBlockquote) return;
    const inner = blockquoteLines.join("\n");
    output.push(
      `<blockquote style="margin:12px 0;padding:8px 16px;border-left:4px solid ${C.surface1};color:${C.subtext0};font-style:italic;">${inlineFormat(inner)}</blockquote>`,
    );
    blockquoteLines = [];
    inBlockquote = false;
  }

  function flushCodeBlock(): void {
    if (!inCodeBlock) return;
    const code = escapeHtml(codeBlockLines.join("\n"));
    const langLabel = codeBlockLang
      ? `<div style="font-size:0.75em;color:${C.overlay0};margin-bottom:4px;">${escapeHtml(codeBlockLang)}</div>`
      : "";
    output.push(
      `<div style="background:${C.surface0};border-radius:6px;padding:12px 14px;margin:12px 0;overflow-x:auto;">${langLabel}<pre style="margin:0;white-space:pre;font-family:'SF Mono',Monaco,Consolas,'JetBrains Mono',monospace;font-size:0.88em;line-height:1.5;color:${C.green};overflow-x:auto;"><code>${code}</code></pre></div>`,
    );
    codeBlockLines = [];
    codeBlockLang = "";
    inCodeBlock = false;
  }

  function flushUl(): void {
    if (!inUl) return;
    let html = `<ul style="margin:8px 0 12px 0;padding-left:24px;list-style:none;">`;
    for (const item of ulLines) {
      html += `<li style="margin:3px 0;line-height:1.5;"><span style="color:${C.overlay0};margin-right:6px;">&#8226;</span>${inlineFormat(item)}</li>`;
    }
    html += "</ul>";
    output.push(html);
    ulLines = [];
    inUl = false;
  }

  function flushOl(): void {
    if (!inOl) return;
    let html = `<ol style="margin:8px 0 12px 0;padding-left:24px;list-style:none;counter-reset:ol-counter;">`;
    for (let j = 0; j < olLines.length; j++) {
      html += `<li style="margin:3px 0;line-height:1.5;"><span style="color:${C.overlay0};margin-right:6px;">${j + 1}.</span>${inlineFormat(olLines[j])}</li>`;
    }
    html += "</ol>";
    output.push(html);
    olLines = [];
    inOl = false;
  }

  function flushAll(): void {
    flushParagraph();
    flushBlockquote();
    flushCodeBlock();
    flushUl();
    flushOl();
  }

  // Main loop -------------------------------------------------------------

  while (i < lines.length) {
    const line = lines[i];

    // --- Code blocks (fenced) ---
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        // Closing fence
        flushCodeBlock();
        i++;
        continue;
      } else {
        // Opening fence
        flushAll();
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
        codeBlockLines = [];
        i++;
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      i++;
      continue;
    }

    // --- Blank line flushes current block ---
    if (line.trim() === "") {
      flushAll();
      i++;
      continue;
    }

    // --- Headings ---
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushAll();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const sizes: Record<number, string> = {
        1: "1.8em",
        2: "1.4em",
        3: "1.15em",
        4: "1.0em",
        5: "0.95em",
        6: "0.9em",
      };
      const mt = level <= 2 ? "24px" : "16px";
      const mb = level <= 2 ? "12px" : "8px";
      const border =
        level <= 2
          ? `border-bottom:1px solid ${C.surface1};padding-bottom:6px;`
          : "";
      output.push(
        `<h${level} style="margin:${mt} 0 ${mb} 0;font-size:${sizes[level]};font-weight:600;color:${C.blue};${border}">${inlineFormat(text)}</h${level}>`,
      );
      i++;
      continue;
    }

    // --- Horizontal rule ---
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line.trim())) {
      flushAll();
      output.push(
        `<hr style="border:none;border-top:1px solid ${C.surface1};margin:16px 0;" />`,
      );
      i++;
      continue;
    }

    // --- Table (GFM pipe table) ---
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\|?\s*[-:]+[-|:\s]+$/.test(lines[i + 1].trim())
    ) {
      flushAll();
      const tableLines: string[] = [line];
      let j = i + 1;
      while (
        j < lines.length &&
        lines[j].includes("|") &&
        lines[j].trim() !== ""
      ) {
        tableLines.push(lines[j]);
        j++;
      }
      output.push(parseTable(tableLines));
      i = j;
      continue;
    }

    // --- Blockquote ---
    if (line.startsWith(">")) {
      if (!inBlockquote) {
        flushAll();
        inBlockquote = true;
        blockquoteLines = [];
      }
      blockquoteLines.push(line.replace(/^>\s?/, ""));
      i++;
      continue;
    }
    if (inBlockquote) {
      flushBlockquote();
    }

    // --- Unordered list ---
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inUl) {
        flushAll();
        inUl = true;
        ulLines = [];
      }
      ulLines.push(ulMatch[2]);
      i++;
      continue;
    }
    if (inUl) {
      flushUl();
    }

    // --- Ordered list ---
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inOl) {
        flushAll();
        inOl = true;
        olLines = [];
      }
      olLines.push(olMatch[2]);
      i++;
      continue;
    }
    if (inOl) {
      flushOl();
    }

    // --- Paragraph text ---
    paragraphLines.push(line);
    i++;
  }

  // Flush any remaining blocks
  flushAll();

  return output.join("\n");
}

// ---------------------------------------------------------------------------
// CSS styles (Catppuccin Mocha / GitHub-flavored dark)
// ---------------------------------------------------------------------------

function buildCss(): string {
  return `
    * { box-sizing: border-box; }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: ${C.mantle}; }
    ::-webkit-scrollbar-thumb { background: ${C.surface1}; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: ${C.overlay0}; }
    body, html {
      margin: 0; padding: 0;
      background: ${C.base};
      color: ${C.text};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.6;
    }
    strong { color: ${C.text}; font-weight: 600; }
    em { color: ${C.subtext1}; }
    a { color: ${C.blue}; text-decoration: underline; }
    a:hover { color: ${C.lavender}; }
    img { max-width: 100%; }
  `;
}

// ---------------------------------------------------------------------------
// Build full HTML page
// ---------------------------------------------------------------------------

function formatTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildPage(markdownHtml: string, modifiedAt: Date): string {
  const css = buildCss();
  const timeStr = formatTime(modifiedAt);

  return `<div style="width:100%;height:100%;display:flex;flex-direction:column;background:${C.base};overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <style>${css}</style>

  <!-- Title bar -->
  <div style="height:36px;min-height:36px;background:${C.surface0};display:flex;align-items:center;padding:0 14px;border-bottom:1px solid ${C.surface1};flex-shrink:0;">
    <svg width="16" height="16" viewBox="0 0 16 16" style="margin-right:8px;flex-shrink:0;">
      <rect x="2" y="1" width="12" height="14" rx="1.5" fill="none" stroke="${C.blue}" stroke-width="1.2"/>
      <line x1="5" y1="5" x2="11" y2="5" stroke="${C.overlay0}" stroke-width="1"/>
      <line x1="5" y1="7.5" x2="11" y2="7.5" stroke="${C.overlay0}" stroke-width="1"/>
      <line x1="5" y1="10" x2="9" y2="10" stroke="${C.overlay0}" stroke-width="1"/>
    </svg>
    <span style="font-size:13px;font-weight:600;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(fileName)}</span>
    <div style="flex:1;"></div>
    <span style="font-size:11px;color:${C.overlay0};white-space:nowrap;">modified ${timeStr}</span>
  </div>

  <!-- Markdown content (scrollable) -->
  <div style="flex:1;overflow-y:auto;padding:20px 24px 40px 24px;">
    <div style="max-width:560px;margin:0 auto;">
      ${markdownHtml}
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Rendering / update
// ---------------------------------------------------------------------------

let firstRender = true;

function sendPanel(html: string): void {
  const bytes = encoder.encode(html);

  if (firstRender) {
    writeMeta({
      id: PANEL_ID,
      type: "html",
      position: "float",
      width: PANEL_W,
      height: PANEL_H,
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
// Read file and render
// ---------------------------------------------------------------------------

async function renderFile(): Promise<void> {
  try {
    const file = Bun.file(resolvedPath);
    const text = await file.text();
    const stat = await file.stat();
    const mtime = stat?.mtime ? new Date(stat.mtime) : new Date();

    const markdownHtml = markdownToHtml(text);
    const pageHtml = buildPage(markdownHtml, mtime);
    sendPanel(pageHtml);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errorHtml = buildPage(
      `<div style="color:${C.red};padding:20px;">
        <h3 style="margin:0 0 8px 0;">Error reading file</h3>
        <pre style="font-size:0.9em;color:${C.subtext0};">${escapeHtml(errMsg)}</pre>
      </div>`,
      new Date(),
    );
    sendPanel(errorHtml);
  }
}

// ---------------------------------------------------------------------------
// File watcher — poll mtime every 500ms
// ---------------------------------------------------------------------------

let lastMtime = 0;
let watchTimer: ReturnType<typeof setInterval> | null = null;

async function checkFile(): Promise<void> {
  try {
    const file = Bun.file(resolvedPath);
    const stat = await file.stat();
    const mtime = stat?.mtime ?? 0;
    const mtimeMs =
      typeof mtime === "number" ? mtime : new Date(mtime).getTime();

    if (mtimeMs !== lastMtime) {
      lastMtime = mtimeMs;
      await renderFile();
      if (lastMtime !== 0) {
        console.log(`[${formatTime(new Date())}] File changed — refreshed.`);
      }
    }
  } catch {
    // File may have been deleted — ignore until it reappears
  }
}

function startWatching(): void {
  watchTimer = setInterval(checkFile, POLL_INTERVAL);
}

function stopWatching(): void {
  if (watchTimer !== null) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log(`HyperTerm Markdown Previewer started.`);
console.log(`Watching: ${resolvedPath}`);
console.log(`Poll interval: ${POLL_INTERVAL}ms`);
console.log("Press Ctrl+C to exit.\n");

// Initial render
await renderFile();
lastMtime = 0; // Force the first check to detect the initial mtime

// Start file watcher
startWatching();

// Cleanup on exit
process.on("SIGINT", () => {
  stopWatching();
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\nMarkdown previewer closed.");
  process.exit(0);
});
