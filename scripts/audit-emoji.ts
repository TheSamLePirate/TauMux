#!/usr/bin/env bun
/**
 * τ-mux emoji audit — enforces design guideline §0 rule 7:
 *
 *   "No emoji. Ever. Use the tokenised SVG icon set (§6)."
 *
 * Scans view + bun sources for emoji code points. Fails with a
 * non-zero exit if any are found outside the allowlist (comments,
 * test fixtures, explicit opt-outs marked with `emoji-audit-ignore`).
 *
 * Tree-drawing / box-drawing / status glyphs (●, ▸, ├, └, ─, ■, etc.)
 * are allowlisted — the guideline explicitly permits them for tree
 * and diff structure (§11 "Do"). They are NOT emoji code points,
 * which keeps this regex simple.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const SCAN_DIRS = ["src/views/terminal", "src/bun", "src/shared"];

// Files and directories excluded from the audit.
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "test-results",
]);
const IGNORE_FILES = new Set<string>([
  // Intentional test fixtures can be added here by path.
]);

const INCLUDE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".html"]);

// Emoji code-point ranges from Unicode TR #51 (approximate, covers
// 99% of user-visible emoji without dragging the whole CLDR dataset).
// Intentionally narrow: we do NOT flag Latin, CJK, box-drawing,
// geometric shapes (●, ■, ▸), or arrows (→, ←) — all permitted.
//
// Key ranges:
//   U+1F300..U+1FAFF  — pictographs, animals, food, flags, symbols
//   U+2600..U+27BF    — dingbats + misc symbols (✓, ✗, ★, ☀, ☁ … and the ⚠ family)
//   U+1F000..U+1F02F  — mahjong / playing cards / domino (rare but emoji-ish)
// Then the skin-tone + variation-selector + ZWJ combinators that
// stitch multi-code-point emoji together.
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}]|️|[\u{1F3FB}-\u{1F3FF}]|‍(?=[\u{1F300}-\u{1FAFF}])/u;

interface Hit {
  file: string;
  line: number;
  col: number;
  snippet: string;
  match: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) {
      const dotIdx = name.lastIndexOf(".");
      if (dotIdx > 0 && INCLUDE_EXT.has(name.slice(dotIdx))) out.push(p);
    }
  }
  return out;
}

function audit(): Hit[] {
  const hits: Hit[] = [];
  for (const sub of SCAN_DIRS) {
    const abs = join(ROOT, sub);
    try {
      statSync(abs);
    } catch {
      continue;
    }
    for (const file of walk(abs)) {
      const rel = relative(ROOT, file);
      if (IGNORE_FILES.has(rel)) continue;
      const text = readFileSync(file, "utf-8");
      if (text.includes("emoji-audit-ignore")) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("emoji-audit-ignore-line")) continue;
        const m = line.match(EMOJI_RE);
        if (m && m.index !== undefined) {
          hits.push({
            file: rel,
            line: i + 1,
            col: m.index + 1,
            snippet: line.slice(Math.max(0, m.index - 20), m.index + 40),
            match: m[0],
          });
        }
      }
    }
  }
  return hits;
}

const hits = audit();
if (hits.length === 0) {
  console.log(
    "[emoji-audit] clean — 0 emoji code points across",
    SCAN_DIRS.join(", "),
  );
  process.exit(0);
}

console.error(`[emoji-audit] FAIL — ${hits.length} emoji code point(s) found:`);
for (const h of hits.slice(0, 50)) {
  console.error(
    `  ${h.file}:${h.line}:${h.col}  «${h.match}»  ${h.snippet.trim()}`,
  );
}
if (hits.length > 50) console.error(`  … and ${hits.length - 50} more`);
console.error("");
console.error("Per τ-mux design guideline §0: 'No emoji. Ever.'");
console.error("Replace with an SVG icon from src/views/terminal/tau-icons.ts,");
console.error("or mark a line with `// emoji-audit-ignore-line` / a file with");
console.error(
  "`// emoji-audit-ignore` if the occurrence is load-bearing (e.g. user-facing",
);
console.error("copy rendering a user's own content, not chrome).");
process.exit(1);
