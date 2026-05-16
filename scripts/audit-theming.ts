#!/usr/bin/env bun
/**
 * τ-mux theming audit — Phase 5 / theme system.
 *
 * The token system at `src/shared/web-theme-tokens.css` is the single
 * source of truth for colour. Every component CSS file must read its
 * colours through `var(--ht-…)` rather than hard-coding hex / rgb()
 * / hsl() literals.
 *
 * Why this matters: light-mode + high-contrast themes are layered on
 * top of the token block. A hard-coded `color: #fff` in a component
 * silently breaks both themes — the rest of the surface flips, that
 * one colour doesn't.
 *
 * This script:
 *   - Scans `src/views/terminal/index.css`, `src/web-client/client.css`,
 *     and any other component CSS files.
 *   - Skips the canonical token block (`web-theme-tokens.css`) where
 *     literals are EXPECTED to live.
 *   - Skips `xterm.css` (vendored — not ours to refactor).
 *   - Flags hex (#abc, #abcdef, #abcdef00), rgb(), rgba(), hsl(),
 *     hsla(), and the `color()` / `oklch()` / `lab()` functions.
 *   - Exits non-zero on any finding outside the existing allowlist.
 *
 * Allowlist (per-file): currently empty. Every legitimate colour
 * literal already lives in `web-theme-tokens.css`. New components
 * that need a new token should add it there, not paste a hex.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const SCAN_PATHS = ["src/views/terminal", "src/web-client", "src/shared"];

const IGNORE_FILES = new Set([
  // The token block IS the place for literal colours.
  "src/shared/web-theme-tokens.css",
  // Vendored — not ours.
  "src/views/terminal/xterm.css",
]);

// Per-file allowlist for legitimate residuals (currently none).
const PER_FILE_ALLOW: Record<string, RegExp[]> = {};

interface Hit {
  path: string;
  line: number;
  col: number;
  match: string;
  context: string;
}

const COLOR_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|color)\s*\(/gi;

function shouldScan(path: string): boolean {
  if (!path.endsWith(".css")) return false;
  const rel = relative(ROOT, path).replace(/\\/g, "/");
  if (IGNORE_FILES.has(rel)) return false;
  return true;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") {
      continue;
    }
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (s.isFile() && shouldScan(p)) acc.push(p);
  }
  return acc;
}

/** Strip lexical structures where literal colours legitimately live:
 *  - /* … *​/ block comments (a comment that mentions #fff isn't a regression).
 *  - `:root { … }` blocks (the canonical home for token declarations).
 *  - `@theme { … }` / `:root[data-theme="…"] { … }` blocks (alternate
 *    theme overrides; same allowance as the default token block).
 *
 *  Replace each match with the same number of space characters so
 *  the offset → line/col math downstream stays correct.
 */
/** Replace `m` with the same number of chars, **preserving newlines**
 *  so the offset→line/col math downstream stays correct. A naive
 *  `" ".repeat(m.length)` eats newlines and shifts every later line
 *  number — which silently produces bogus context lines in the error
 *  report. */
function blank(m: string): string {
  let out = "";
  for (let i = 0; i < m.length; i++) {
    out += m[i] === "\n" ? "\n" : " ";
  }
  return out;
}

function strip(source: string): string {
  return (
    source
      // Block comments first — they can contain `:root` text that would
      // confuse the subsequent matcher.
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      // `:root { … }` and `:root[data-theme="…"] { … }` and `@theme { … }`.
      .replace(/(?::root[^{]*|@theme[^{]*)\{[^}]*\}/g, blank)
  );
}

function findHits(path: string): Hit[] {
  const raw = readFileSync(path, "utf-8");
  const text = strip(raw);
  const lines = raw.split("\n");
  const out: Hit[] = [];
  let m: RegExpExecArray | null;
  COLOR_RE.lastIndex = 0;
  while ((m = COLOR_RE.exec(text)) !== null) {
    // Convert offset → line + column.
    const offset = m.index;
    let line = 1;
    let col = 1;
    for (let i = 0; i < offset; i++) {
      if (text[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    const rel = relative(ROOT, path).replace(/\\/g, "/");
    const allow = PER_FILE_ALLOW[rel];
    if (allow?.some((re) => re.test(m![0]))) continue;
    out.push({
      path: rel,
      line,
      col,
      match: m[0],
      context: lines[line - 1]?.trim().slice(0, 100) ?? "",
    });
  }
  return out;
}

function main(): void {
  const files: string[] = [];
  for (const sub of SCAN_PATHS) {
    const abs = join(ROOT, sub);
    try {
      walk(abs, files);
    } catch {
      // Sub-path missing — fine, just skip.
    }
  }

  const hits: Hit[] = [];
  for (const f of files) hits.push(...findHits(f));

  if (hits.length === 0) {
    console.log(
      `[audit:theming] clean — ${files.length} CSS files scanned, no hard-coded colour literals.`,
    );
    return;
  }

  console.error(
    `[audit:theming] ${hits.length} hard-coded colour literal(s) found outside the token block:`,
  );
  for (const h of hits) {
    console.error(`  ${h.path}:${h.line}:${h.col}  ${h.match}`);
    if (h.context) console.error(`    > ${h.context}`);
  }
  console.error(
    "\nFix: replace the literal with a var(--ht-…) reference, or add a new token in src/shared/web-theme-tokens.css.",
  );
  process.exit(1);
}

if (import.meta.main) {
  main();
}

// Test seam — exported so the unit test can drive the matcher without
// spawning the script.
export { COLOR_RE, findHits as auditOneFile };
