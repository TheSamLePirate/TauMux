#!/usr/bin/env bun
/**
 * Design-review report generator (doc/native-e2e-plan.md §7.5).
 *
 * Reads the screenshot index produced by the native-e2e fixture's `snap()`
 * helper (`test-results/screenshots-index.jsonl`) and emits a single
 * markdown file at `test-results/design-review/index.md` that embeds each
 * `@design-review`-tagged screenshot inline with its state blob.
 *
 * The report is intended to be fed to a multimodal reviewer (Claude Opus,
 * a human, …) for visual QA without a local run of the app:
 *
 *     bun run test:native:design-review
 *     bun scripts/build-design-review.ts
 *     open test-results/design-review/index.md
 *
 * Groups entries by spec, then by test, then by step — so the reviewer
 * sees a logical sequence for each scenario.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, relative } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const INDEX_PATH = join(REPO_ROOT, "test-results/screenshots-index.jsonl");
const OUT_DIR = join(REPO_ROOT, "test-results/design-review");
const OUT_IMAGES = join(OUT_DIR, "images");
const OUT_MD = join(OUT_DIR, "index.md");

interface IndexEntry {
  timestamp: string;
  spec: string;
  test: string;
  testSlug: string;
  step: string;
  path: string;
  state?: Record<string, unknown>;
  annotate?: Record<string, unknown>;
}

if (!existsSync(INDEX_PATH)) {
  console.error(
    `[design-review] no index at ${relative(REPO_ROOT, INDEX_PATH)} — ` +
      `run \`bun run test:native:design-review\` first`,
  );
  process.exit(1);
}

mkdirSync(OUT_IMAGES, { recursive: true });

const entries: IndexEntry[] = [];
for (const line of readFileSync(INDEX_PATH, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  try {
    entries.push(JSON.parse(trimmed));
  } catch {
    /* skip malformed lines */
  }
}

// Keep only the latest entry per (spec, test, step) — reruns append, and
// the design-review reader wants one canonical image per state, not a
// chronological replay.
const latest = new Map<string, IndexEntry>();
for (const e of entries) {
  const key = `${e.spec}::${e.test}::${e.step}`;
  const prior = latest.get(key);
  if (!prior || new Date(prior.timestamp) < new Date(e.timestamp)) {
    latest.set(key, e);
  }
}

// Copy each image into design-review/images/ so the report is a
// self-contained bundle (GH Pages artifact, email attachment, whatever).
const bySpec = new Map<string, IndexEntry[]>();
for (const e of latest.values()) {
  const list = bySpec.get(e.spec) ?? [];
  list.push(e);
  bySpec.set(e.spec, list);
}

const lines: string[] = [];
lines.push(`# Design review — ${new Date().toISOString()}`);
lines.push("");
lines.push(
  `Generated from \`${relative(REPO_ROOT, INDEX_PATH)}\`. ` +
    `${latest.size} canonical state(s) across ${bySpec.size} spec file(s).`,
);
lines.push("");
lines.push("Review for visual regressions, off-palette colours, ");
lines.push("off-grid elements, and layout drift. Each section is one");
lines.push("test's canonical shot; the **state** line gives you the");
lines.push("exact UI conditions without needing to run the app.");
lines.push("");

const specsSorted = [...bySpec.keys()].sort();
for (const spec of specsSorted) {
  const specEntries = bySpec.get(spec)!;
  lines.push(`## ${spec}`);
  lines.push("");
  specEntries.sort((a, b) => {
    if (a.test !== b.test) return a.test.localeCompare(b.test);
    return a.step.localeCompare(b.step);
  });
  for (const e of specEntries) {
    const imgName = `${e.spec.replace(/\W+/g, "_")}-${e.testSlug}-${e.step}${extForPath(e.path)}`;
    const dest = join(OUT_IMAGES, imgName);
    try {
      if (existsSync(e.path)) copyFileSync(e.path, dest);
    } catch {
      /* best-effort */
    }
    lines.push(`### ${e.test} — \`${e.step}\``);
    lines.push("");
    if (existsSync(dest)) {
      lines.push(`![${e.step}](images/${imgName})`);
    } else {
      lines.push(
        `_(screenshot missing at \`${relative(REPO_ROOT, e.path)}\`)_`,
      );
    }
    lines.push("");
    if (e.state && Object.keys(e.state).length > 0) {
      lines.push(`**state:** ${formatKV(e.state)}`);
      lines.push("");
    }
    if (e.annotate && Object.keys(e.annotate).length > 0) {
      lines.push(`**annotations:** ${formatKV(e.annotate)}`);
      lines.push("");
    }
  }
}

writeFileSync(OUT_MD, lines.join("\n"));
console.log(
  `[design-review] wrote ${latest.size} entries to ${relative(REPO_ROOT, OUT_MD)}`,
);

function formatKV(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(", ");
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 40 ? v.slice(0, 37) + "…" : v;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
}

function extForPath(path: string): string {
  const b = basename(path);
  const dot = b.lastIndexOf(".");
  return dot === -1 ? "" : b.slice(dot);
}

// silence unused-import warning for `dirname` when bun's lint runs on this
void dirname;
