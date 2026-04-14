#!/usr/bin/env bun
// Build the web-mirror client bundle.
//
// Produces assets/web-client/client.js (bundled, browser-target) and
// copies assets/web-client/client.css. Both are inlined into the HTML
// page served by src/bun/web/page.ts. In packaged mode electrobun copies
// them to vendor/web-client/.

import { resolve } from "node:path";
import { mkdirSync, copyFileSync } from "node:fs";

const ROOT = resolve(import.meta.dir, "..");
const OUT_DIR = resolve(ROOT, "assets/web-client");
const ENTRY = resolve(ROOT, "src/web-client/main.ts");
const CSS_SRC = resolve(ROOT, "src/web-client/client.css");
const CSS_OUT = resolve(OUT_DIR, "client.css");
const TOKENS_SRC = resolve(ROOT, "src/shared/web-theme-tokens.css");
const TOKENS_OUT = resolve(OUT_DIR, "tokens.css");

mkdirSync(OUT_DIR, { recursive: true });

const minify = process.argv.includes("--minify");

const result = await Bun.build({
  entrypoints: [ENTRY],
  outdir: OUT_DIR,
  target: "browser",
  format: "iife",
  minify,
  naming: { entry: "client.js" },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

copyFileSync(CSS_SRC, CSS_OUT);
copyFileSync(TOKENS_SRC, TOKENS_OUT);

console.log(
  `[build-web-client] wrote ${result.outputs.length} bundle${result.outputs.length === 1 ? "" : "s"} to ${OUT_DIR}${minify ? " (minified)" : ""}`,
);
