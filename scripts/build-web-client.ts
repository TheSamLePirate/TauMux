#!/usr/bin/env bun
// Build the web-mirror client bundle.
//
// Produces:
//   assets/web-client/client.js     — main bundle (browser, IIFE)
//   assets/web-client/client.css    — copied
//   assets/web-client/tokens.css    — design tokens
//   assets/web-client/sw.js         — PWA service worker
//   assets/web-client/manifest.json — PWA manifest (copied verbatim)
//   assets/web-client/icon.svg      — PWA icon (copied verbatim)
//
// All are inlined or served by src/bun/web/server.ts. In packaged
// mode electrobun copies them to vendor/web-client/.

import { resolve } from "node:path";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = resolve(import.meta.dir, "..");
const OUT_DIR = resolve(ROOT, "assets/web-client");
const ENTRY = resolve(ROOT, "src/web-client/main.ts");
const SW_ENTRY = resolve(ROOT, "src/web-client/sw.ts");
const CSS_SRC = resolve(ROOT, "src/web-client/client.css");
const CSS_OUT = resolve(OUT_DIR, "client.css");
const TOKENS_SRC = resolve(ROOT, "src/shared/web-theme-tokens.css");
const TOKENS_OUT = resolve(OUT_DIR, "tokens.css");
const MANIFEST_SRC = resolve(ROOT, "src/web-client/manifest.json");
const MANIFEST_OUT = resolve(OUT_DIR, "manifest.json");
const ICON_SRC = resolve(ROOT, "src/web-client/icon.svg");
const ICON_OUT = resolve(OUT_DIR, "icon.svg");

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

// Service-worker bundle. Built separately because it runs in the
// ServiceWorker scope, not the page; format defaults to esm. We rewrite
// the __BUILD_VERSION__ placeholder so deploys rotate the cache.
const swResult = await Bun.build({
  entrypoints: [SW_ENTRY],
  target: "browser",
  format: "esm",
  minify,
  naming: "sw.js",
});

if (!swResult.success) {
  for (const log of swResult.logs) console.error(log);
  process.exit(1);
}

// Build version: timestamp-derived, paired with the package.json
// version. Browsers see a fresh cache key on every build, which is
// what we want — the cache is a PWA shell, not a CDN.
let buildVersion = String(Date.now());
try {
  const pkgRaw = readFileSync(resolve(ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(pkgRaw) as { version?: string };
  if (pkg.version) buildVersion = `${pkg.version}-${buildVersion}`;
} catch {
  /* package.json unreadable in some test contexts — fall back to ts only */
}

const swText = await swResult.outputs[0]!.text();
const swReplaced = swText.replace(/__BUILD_VERSION__/g, buildVersion);
writeFileSync(resolve(OUT_DIR, "sw.js"), swReplaced);

copyFileSync(CSS_SRC, CSS_OUT);
copyFileSync(TOKENS_SRC, TOKENS_OUT);
copyFileSync(MANIFEST_SRC, MANIFEST_OUT);
copyFileSync(ICON_SRC, ICON_OUT);

console.log(
  `[build-web-client] wrote ${result.outputs.length} bundle${result.outputs.length === 1 ? "" : "s"} + sw.js + manifest.json + icon.svg to ${OUT_DIR}${minify ? " (minified)" : ""}`,
);
