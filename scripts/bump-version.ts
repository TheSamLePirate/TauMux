#!/usr/bin/env bun
/**
 * Bump the app version across every file that hard-codes it:
 *   - package.json                                                  (npm package version)
 *   - electrobun.config.ts                                          (bundle CFBundleVersion)
 *   - src/bun/rpc-handlers/system.ts                                (returned by `system.version` RPC)
 *   - website-doc/src/content/docs/cli/system.md                    (example output in `ht version`)
 *   - website-doc/src/content/docs/api/system.md                    (example output in `system.version` RPC)
 *
 * Usage:  bun scripts/bump-version.ts <patch|minor|major|x.y.z>
 * Wired via npm scripts: `bun run bump:{patch,minor,major}`.
 *
 * Reads the current version from package.json (the authoritative
 * source), bumps or replaces it, and writes the new version back to
 * each file with targeted regex replacements so we don't perturb
 * surrounding code. If the files were out of sync on entry, they are
 * all brought to the new version — this is the quickest way to
 * converge.
 *
 * Does NOT create a git tag or commit. Review the diff, stage, and
 * commit yourself.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PKG = resolve(ROOT, "package.json");
const ELECTROBUN = resolve(ROOT, "electrobun.config.ts");
const SYSTEM_RPC = resolve(ROOT, "src/bun/rpc-handlers/system.ts");
const CLI_DOC = resolve(ROOT, "website-doc/src/content/docs/cli/system.md");
const API_DOC = resolve(ROOT, "website-doc/src/content/docs/api/system.md");

type Level = "patch" | "minor" | "major";

function parseSemver(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) throw new Error(`Not a semver x.y.z: "${v}"`);
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

function bump(current: string, level: Level): string {
  const [maj, min, pat] = parseSemver(current);
  switch (level) {
    case "patch":
      return `${maj}.${min}.${pat + 1}`;
    case "minor":
      return `${maj}.${min + 1}.0`;
    case "major":
      return `${maj + 1}.0.0`;
  }
}

function readVersionFromPkg(): string {
  const pkg = JSON.parse(readFileSync(PKG, "utf8")) as { version?: string };
  if (!pkg.version) throw new Error("package.json has no `version` field.");
  return pkg.version;
}

function resolveTarget(arg: string, current: string): string {
  if (arg === "patch" || arg === "minor" || arg === "major") {
    return bump(current, arg);
  }
  // Explicit version — validate semver, accept as-is.
  parseSemver(arg);
  return arg;
}

function updatePackageJson(next: string): void {
  const raw = readFileSync(PKG, "utf8");
  // Preserve formatting by doing a targeted replace on the first
  // `"version": "…"` pair instead of round-tripping through JSON.
  const replaced = raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
  if (replaced === raw) {
    throw new Error(`Could not find "version" in ${PKG}`);
  }
  writeFileSync(PKG, replaced);
}

function updateElectrobunConfig(next: string): void {
  const raw = readFileSync(ELECTROBUN, "utf8");
  // Match the `version: "…",` line inside the `app` object. The
  // leading whitespace anchors us to the config block, not unrelated
  // `version` mentions elsewhere in the file.
  const replaced = raw.replace(/(\n\s+version:\s*")[^"]+(")/, `$1${next}$2`);
  if (replaced === raw) {
    throw new Error(`Could not find \`version: "…"\` in ${ELECTROBUN}`);
  }
  writeFileSync(ELECTROBUN, replaced);
}

function updateSystemRpc(next: string): void {
  const raw = readFileSync(SYSTEM_RPC, "utf8");
  const replaced = raw.replace(
    /(const VERSION\s*=\s*")[^"]+(")/,
    `$1${next}$2`,
  );
  if (replaced === raw) {
    throw new Error(`Could not find \`const VERSION = "…"\` in ${SYSTEM_RPC}`);
  }
  writeFileSync(SYSTEM_RPC, replaced);
}

/** Replace the example `# tau-mux X.Y.Z (build: …)` line in the CLI
 *  doc. The leading `tau-mux ` anchor disambiguates it from any other
 *  semver-shaped strings that might land in the file. */
function updateCliDoc(next: string): void {
  const raw = readFileSync(CLI_DOC, "utf8");
  const replaced = raw.replace(/(tau-mux\s+)\d+\.\d+\.\d+/, `$1${next}`);
  if (replaced === raw) {
    throw new Error(`Could not find \`tau-mux X.Y.Z\` in ${CLI_DOC}`);
  }
  writeFileSync(CLI_DOC, replaced);
}

/** Replace the example `"version": "X.Y.Z"` JSON value in the API
 *  doc. Anchored to the `version` key so unrelated semver-shaped
 *  strings (in code samples, payload examples) are left alone. */
function updateApiDoc(next: string): void {
  const raw = readFileSync(API_DOC, "utf8");
  const replaced = raw.replace(
    /("version"\s*:\s*")\d+\.\d+\.\d+(")/,
    `$1${next}$2`,
  );
  if (replaced === raw) {
    throw new Error(`Could not find \`"version": "X.Y.Z"\` in ${API_DOC}`);
  }
  writeFileSync(API_DOC, replaced);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const arg = process.argv[2]?.trim();
if (!arg) {
  console.error("Usage: bun scripts/bump-version.ts <patch|minor|major|x.y.z>");
  process.exit(2);
}

const current = readVersionFromPkg();
const next = resolveTarget(arg, current);

console.log(`[bump] ${current} → ${next}`);
updatePackageJson(next);
updateElectrobunConfig(next);
updateSystemRpc(next);
updateCliDoc(next);
updateApiDoc(next);
console.log(
  `[bump] Updated package.json, electrobun.config.ts, src/bun/rpc-handlers/system.ts,\n        website-doc/src/content/docs/{cli,api}/system.md.`,
);
console.log(`[bump] Review the diff, then commit.`);
