#!/usr/bin/env bun
/**
 * Phase 0 Step 3 — render `doc/feature_grades.md` from
 * `doc/feature_grades.json` (the source of truth).
 *
 * Usage:
 *   bun scripts/build-feature-grades.ts          # write the md
 *   bun scripts/build-feature-grades.ts --check  # exit 1 if the md drifted
 *
 * The JSON schema is intentionally minimal so future features are
 * cheap to add: one entry under the right cluster, one entry in the
 * blockers list if it lifts more than one feature.
 *
 * If you find yourself hand-editing the .md instead of the .json,
 * stop — `--check` mode in CI will catch it and the next regen will
 * overwrite your edits.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface FeatureEntry {
  id: string;
  name: string;
  /** Letter grade: S / A / B / C / D / F — or a "+" variant like A- / B+. */
  grade: string;
  /** Single-paragraph evidence with file:line refs. May contain inline backticks. */
  evidence: string;
  /** Bullet list of gaps that would lift the grade. */
  gaps: string[];
}

interface Cluster {
  id: string;
  /** "1. Core terminal & pane management" style heading (without the leading number). */
  title: string;
  features: FeatureEntry[];
}

interface Blocker {
  rank: number;
  /** Bold heading text (no Markdown formatting). */
  title: string;
  /** Body paragraph. Will appear after a dash + space. */
  body: string;
}

interface GradesDoc {
  version: string;
  generatedAt: string;
  branch: string;
  headline: string;
  /** Optional override — by default the distribution is computed from
   *  the features. Set this only when you want to display a different
   *  number than the live tally (e.g. for a narrative snapshot). */
  distribution?: { S: number; A: number; B: number; C: number; DF: number };
  clusters: Cluster[];
  topBlockers: Blocker[];
}

/** Reduce a grade like "B+" / "A-" / "C+" to its base letter so the
 *  distribution table doesn't fan out into a per-modifier column. */
function baseGrade(g: string): string {
  return g
    .replace(/[+-].*$/, "")
    .trim()
    .toUpperCase();
}

function computeDistribution(clusters: Cluster[]): {
  S: number;
  A: number;
  B: number;
  C: number;
  DF: number;
  total: number;
} {
  const counts = { S: 0, A: 0, B: 0, C: 0, DF: 0, total: 0 };
  for (const c of clusters) {
    for (const f of c.features) {
      counts.total++;
      const base = baseGrade(f.grade);
      if (base === "S") counts.S++;
      else if (base === "A") counts.A++;
      else if (base === "B") counts.B++;
      else if (base === "C") counts.C++;
      else if (base === "D" || base === "F") counts.DF++;
    }
  }
  return counts;
}

const REPO_ROOT = resolve(import.meta.dir, "..");
const JSON_PATH = join(REPO_ROOT, "doc", "feature_grades.json");
const MD_PATH = join(REPO_ROOT, "doc", "feature_grades.md");

function render(doc: GradesDoc): string {
  const lines: string[] = [];
  lines.push(`# τ-mux Full Feature Review & Grading`);
  lines.push("");
  lines.push(`**Version:** ${doc.version}`);
  lines.push(`**Generated:** ${doc.generatedAt}`);
  lines.push(`**Branch:** ${doc.branch}`);
  lines.push(
    `**Method:** Five parallel deep-dive audits across (1) core terminal + pane management, (2) sideband / canvas panels, (3) UI surfaces / chrome, (4) integrations / external bridges, (5) process metadata / infra / dev/test tooling. Each feature graded against an AAA bar: completeness, polish, robustness under failure, accessibility, performance, and test depth.`,
  );
  lines.push("");
  lines.push(
    `This doc is **generated** from \`doc/feature_grades.json\` by \`bun run report:feature-grades\`. Edit the JSON, not this file.`,
  );
  lines.push("");
  lines.push(
    `This is a **per-feature grading** companion to \`doc/triple_a_analysis.md\` (which catalogues cross-cutting issues by severity). Where this doc cites a \`U#\`/\`A#\`/\`L#\`/\`S#\`/\`T#\` id, the detail lives in \`triple_a_analysis.md\`.`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // Scale
  lines.push("## Scale");
  lines.push("");
  lines.push("| Grade | Meaning |");
  lines.push("|---|---|");
  lines.push(
    "| **S** | AAA. Complete, polished, robust, accessible, well-tested. No rough edges. |",
  );
  lines.push(
    "| **A** | Works well; minor polish / edge-case / test gaps. Close to AAA. |",
  );
  lines.push(
    "| **B** | Happy path solid; visible gaps in robustness, polish, or coverage. |",
  );
  lines.push(
    "| **C** | Half-finished or naïve. Real bugs, missing controls, or lifecycle gaps. |",
  );
  lines.push("| **D** | Prototype. Brittle. |");
  lines.push("| **F** | Broken / abandoned. |");
  lines.push("");
  lines.push("---");
  lines.push("");

  // Headline
  lines.push("## Headline");
  lines.push("");
  lines.push(doc.headline);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Distribution — auto-computed unless the JSON overrides it.
  const dist = doc.distribution ?? computeDistribution(doc.clusters);
  const total = computeDistribution(doc.clusters).total;
  lines.push(`## Grade distribution (${total} features)`);
  lines.push("");
  lines.push("| Grade | Count | Notes |");
  lines.push("|---|---:|---|");
  lines.push(
    `| S (AAA) | **${dist.S}** | ${
      dist.S === 0
        ? "Nothing reaches it yet."
        : `Best-in-class — ${dist.S} feature${dist.S === 1 ? "" : "s"} cleared every gap.`
    } |`,
  );
  lines.push(`| A | **${dist.A}** | Most "production-shaped" subsystems. |`);
  lines.push(
    `| B (incl. B+) | **${dist.B}** | Functional, with named polish / test / lifecycle gaps. |`,
  );
  lines.push(
    `| C (incl. C+) | **${dist.C}** | Half-wired audits & release plumbing. |`,
  );
  lines.push(`| D / F | **${dist.DF}** | No abandoned features. |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Clusters
  for (let i = 0; i < doc.clusters.length; i++) {
    const c = doc.clusters[i];
    lines.push(`## ${i + 1}. ${c.title}`);
    lines.push("");
    for (const f of c.features) {
      lines.push(`### ${f.name}`);
      lines.push(`- **Grade: ${f.grade}**`);
      lines.push(`- **Evidence:** ${f.evidence}`);
      lines.push(`- **Gaps to AAA:**`);
      for (const g of f.gaps) {
        lines.push(`  - ${g}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // Blockers
  lines.push("## Top 10 blockers to AAA across the whole app");
  lines.push("");
  lines.push(
    "Ranked by leverage — each lifts multiple features by one letter.",
  );
  lines.push("");
  for (const b of doc.topBlockers) {
    lines.push(`${b.rank}. **${b.title}** — ${b.body}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Companion docs
  lines.push("## Companion docs");
  lines.push("");
  lines.push(
    "- `doc/triple_a_analysis.md` — severity-ranked cross-cutting issue catalogue (the source for `A#`/`L#`/`S#`/`U#`/`T#` ids).",
  );
  lines.push(
    "- `doc/tracking_triple_a_analysis.md` — execution log for F–J clusters.",
  );
  lines.push(
    "- `doc/feature_upgrade_to_AAA/00_master_plan.md` — programme to move every feature to AAA.",
  );
  lines.push(
    "- `doc/full_analysis.md`, `doc/issues_now.md`, `doc/deferred_items.md` — earlier audit rounds (context only).",
  );
  lines.push(
    "- `doc/changes_to_document.md` — running website-doc changelog (per CLAUDE.md convention).",
  );
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const check = process.argv.includes("--check");
  const raw = readFileSync(JSON_PATH, "utf-8");
  const doc = JSON.parse(raw) as GradesDoc;
  const rendered = render(doc);
  if (check) {
    let existing = "";
    try {
      existing = readFileSync(MD_PATH, "utf-8");
    } catch {
      console.error(
        `[feature-grades] ${MD_PATH} is missing; run without --check first.`,
      );
      process.exit(1);
    }
    if (existing === rendered) {
      console.log("[feature-grades] up to date.");
      return;
    }
    console.error(
      `[feature-grades] ${MD_PATH} is out of sync with ${JSON_PATH}.`,
    );
    console.error(`  Run: bun run report:feature-grades`);
    process.exit(1);
  }
  writeFileSync(MD_PATH, rendered);
  console.log(
    `[feature-grades] wrote ${MD_PATH} (${rendered.length} bytes, ${doc.clusters.reduce((n, c) => n + c.features.length, 0)} features)`,
  );
}

main();
