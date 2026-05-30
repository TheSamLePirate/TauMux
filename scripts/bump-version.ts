#!/usr/bin/env bun
/**
 * Bump the app version across every file that hard-codes it:
 *   - package.json                                                  (npm package version)
 *   - electrobun.config.ts                                          (bundle CFBundleVersion)
 *   - src/bun/rpc-handlers/system.ts                                (returned by `system.version` RPC)
 *   - website-doc/src/content/docs/cli/system.md                    (example output in `ht version`)
 *   - website-doc/src/content/docs/api/system.md                    (example output in `system.version` RPC)
 *   - website-doc/src/content/docs/fr/cli/system.md                 (French mirror of the above)
 *   - website-doc/src/content/docs/fr/api/system.md                 (French mirror of the above)
 *
 * Usage:
 *   bun scripts/bump-version.ts <patch|minor|major|x.y.z> [flags]
 *
 * Flags (P8):
 *   --commit            Create a git commit "chore(release): vX.Y.Z" after the
 *                       file updates. Aborts if the working tree is dirty
 *                       in other ways unless --allow-dirty is also passed.
 *   --tag               Create an annotated git tag `vX.Y.Z` pointing at HEAD
 *                       (or the new commit if --commit is also set). Aborts
 *                       if the tag already exists. Implies --commit.
 *   --changelog         Generate / extend CHANGELOG.md with a section for
 *                       the new version, drawn from `git log <prev-tag>..HEAD`.
 *                       Conventional-commit style: feat / fix / refactor / docs
 *                       / chore / test / perf are grouped; other types fall
 *                       under "Other". Skips empty sections.
 *   --allow-dirty       Skip the working-tree-clean check for --commit.
 *   --dry-run           Print what would change without writing anything.
 *
 * Wired via npm scripts: `bun run bump:{patch,minor,major}`.
 *
 * Reads the current version from package.json (the authoritative
 * source), bumps or replaces it, and writes the new version back to
 * each file with targeted regex replacements so we don't perturb
 * surrounding code. If the files were out of sync on entry, they are
 * all brought to the new version — this is the quickest way to
 * converge.
 *
 * Without --commit / --tag / --changelog, behaves identically to the
 * pre-P8 script: review the diff, stage, commit yourself.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ROOT defaults to the repo root (one level above scripts/), but tests
// can override via BUMP_VERSION_ROOT to sandbox the script in a tmpdir.
const ROOT = process.env["BUMP_VERSION_ROOT"]
  ? resolve(process.env["BUMP_VERSION_ROOT"])
  : resolve(import.meta.dir, "..");
const PKG = resolve(ROOT, "package.json");
const ELECTROBUN = resolve(ROOT, "electrobun.config.ts");
const SYSTEM_RPC = resolve(ROOT, "src/bun/rpc-handlers/system.ts");
const CLI_DOC = resolve(ROOT, "website-doc/src/content/docs/cli/system.md");
const API_DOC = resolve(ROOT, "website-doc/src/content/docs/api/system.md");
const CLI_DOC_FR = resolve(
  ROOT,
  "website-doc/src/content/docs/fr/cli/system.md",
);
const API_DOC_FR = resolve(
  ROOT,
  "website-doc/src/content/docs/fr/api/system.md",
);
const CHANGELOG = resolve(ROOT, "CHANGELOG.md");

type Level = "patch" | "minor" | "major";

interface Flags {
  commit: boolean;
  tag: boolean;
  changelog: boolean;
  allowDirty: boolean;
  dryRun: boolean;
}

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
 *  semver-shaped strings that might land in the file. Updates the
 *  English source and the French mirror so the two locales stay in
 *  sync — the example block is identical in both. */
function updateCliDoc(next: string, path: string): void {
  const raw = readFileSync(path, "utf8");
  const replaced = raw.replace(/(tau-mux\s+)\d+\.\d+\.\d+/, `$1${next}`);
  if (replaced === raw) {
    throw new Error(`Could not find \`tau-mux X.Y.Z\` in ${path}`);
  }
  writeFileSync(path, replaced);
}

/** Replace the example `"version": "X.Y.Z"` JSON value in the API
 *  doc. Anchored to the `version` key so unrelated semver-shaped
 *  strings (in code samples, payload examples) are left alone. Updates
 *  the English source and the French mirror. */
function updateApiDoc(next: string, path: string): void {
  const raw = readFileSync(path, "utf8");
  const replaced = raw.replace(
    /("version"\s*:\s*")\d+\.\d+\.\d+(")/,
    `$1${next}$2`,
  );
  if (replaced === raw) {
    throw new Error(`Could not find \`"version": "X.Y.Z"\` in ${path}`);
  }
  writeFileSync(path, replaced);
}

// ---------------------------------------------------------------------------
// P8 — git commit / tag / changelog
// ---------------------------------------------------------------------------

/** Run a git command and return stdout (trimmed). Throws on non-zero exit. */
function git(args: string[], _opts: { silent?: boolean } = {}): string {
  const r = Bun.spawnSync(["git", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    const err = new TextDecoder().decode(r.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${err}`);
  }
  return new TextDecoder().decode(r.stdout).trim();
}

/** Soft variant of git() — returns null on failure instead of throwing. */
function gitSoft(args: string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/** Check the working tree is clean (no unstaged or staged changes
 *  OTHER than the version files we just edited). */
function assertCleanExcept(touchedFiles: string[]): void {
  const status = gitSoft(["status", "--porcelain=v1"]);
  if (status === null) {
    throw new Error("Not inside a git repository.");
  }
  const lines = status.split("\n").filter(Boolean);
  const touchedSet = new Set(
    touchedFiles.map((p) => p.replace(ROOT + "/", "")),
  );
  const offenders = lines.filter((l) => {
    // Each line is `XY path`; X=index status, Y=worktree status.
    const path = l.slice(3);
    return !touchedSet.has(path);
  });
  if (offenders.length > 0) {
    throw new Error(
      `Working tree has uncommitted changes (use --allow-dirty to skip):\n  ${offenders.join("\n  ")}`,
    );
  }
}

interface CommitSummary {
  type: string;
  scope: string | null;
  subject: string;
  hash: string;
}

/** Parse `git log` lines into structured commit summaries. Recognises
 *  conventional-commit prefixes; un-prefixed commits get type "other". */
function parseCommit(line: string): CommitSummary | null {
  // Format: "<short-hash> <subject>"
  const m = /^([0-9a-f]+)\s+(.+)$/.exec(line);
  if (!m) return null;
  const hash = m[1]!;
  const subject = m[2]!;
  const ccMatch = /^(\w+)(?:\(([^)]+)\))?(!?):\s*(.+)$/.exec(subject);
  if (!ccMatch) {
    return { type: "other", scope: null, subject, hash };
  }
  const [, type, scope, , rest] = ccMatch;
  return {
    type: type!.toLowerCase(),
    scope: scope ?? null,
    subject: rest!,
    hash,
  };
}

const CHANGELOG_SECTIONS: Array<[string, string]> = [
  ["feat", "Features"],
  ["fix", "Bug fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactoring"],
  ["docs", "Documentation"],
  ["test", "Tests"],
  ["chore", "Chores"],
  ["other", "Other"],
];

/** Build a CHANGELOG entry for the new version. Groups commits by
 *  conventional-commit type. Skips sections with no commits. */
function buildChangelogEntry(next: string, commits: CommitSummary[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const grouped = new Map<string, CommitSummary[]>();
  for (const c of commits) {
    const t = grouped.has(c.type)
      ? c.type
      : (CHANGELOG_SECTIONS.find(([k]) => k === c.type)?.[0] ?? "other");
    if (!grouped.has(t)) grouped.set(t, []);
    grouped.get(t)!.push(c);
  }
  const lines: string[] = [`## v${next} — ${today}`, ""];
  for (const [key, heading] of CHANGELOG_SECTIONS) {
    const list = grouped.get(key);
    if (!list || list.length === 0) continue;
    lines.push(`### ${heading}`);
    lines.push("");
    for (const c of list) {
      const scope = c.scope ? `**${c.scope}**: ` : "";
      lines.push(`- ${scope}${c.subject} (${c.hash})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Write the entry to CHANGELOG.md, prepending it after the title
 *  line if one exists, or creating a new file with a # Changelog
 *  header otherwise. */
function writeChangelog(entry: string): void {
  if (!existsSync(CHANGELOG)) {
    writeFileSync(CHANGELOG, `# Changelog\n\n${entry}\n`);
    return;
  }
  const raw = readFileSync(CHANGELOG, "utf8");
  // Insert below the first # Changelog header line.
  const m = /^(# [^\n]+\n+)/.exec(raw);
  if (m) {
    const head = raw.slice(0, m[0].length);
    const tail = raw.slice(m[0].length);
    writeFileSync(CHANGELOG, `${head}${entry}\n${tail}`);
  } else {
    writeFileSync(CHANGELOG, `${entry}\n${raw}`);
  }
}

function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const flags: Flags = {
    commit: false,
    tag: false,
    changelog: false,
    allowDirty: false,
    dryRun: false,
  };
  const positional: string[] = [];
  for (const a of argv) {
    switch (a) {
      case "--commit":
        flags.commit = true;
        break;
      case "--tag":
        flags.tag = true;
        flags.commit = true; // tag implies commit
        break;
      case "--changelog":
        flags.changelog = true;
        break;
      case "--allow-dirty":
        flags.allowDirty = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      default:
        if (a.startsWith("--")) {
          throw new Error(`Unknown flag: ${a}`);
        }
        positional.push(a);
    }
  }
  return { positional, flags };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const { positional, flags } = parseFlags(process.argv.slice(2));
const arg = positional[0]?.trim();
if (!arg) {
  console.error(
    "Usage: bun scripts/bump-version.ts <patch|minor|major|x.y.z> [--commit] [--tag] [--changelog] [--allow-dirty] [--dry-run]",
  );
  process.exit(2);
}

const current = readVersionFromPkg();
const next = resolveTarget(arg, current);

const touchedFiles = [
  PKG,
  ELECTROBUN,
  SYSTEM_RPC,
  CLI_DOC,
  API_DOC,
  CLI_DOC_FR,
  API_DOC_FR,
];

console.log(`[bump] ${current} → ${next}${flags.dryRun ? " (dry-run)" : ""}`);

if (flags.commit && !flags.allowDirty && !flags.dryRun) {
  // Pre-flight: ensure the working tree is clean (apart from the
  // files we're about to touch).
  assertCleanExcept(touchedFiles);
}

let commits: CommitSummary[] = [];
if (flags.changelog) {
  // Find the previous version tag (vX.Y.Z). If none exists, walk
  // back to the initial commit.
  const prevTag = gitSoft([
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v*",
  ]);
  const range = prevTag ? `${prevTag}..HEAD` : "HEAD";
  const log = gitSoft(["log", range, "--pretty=format:%h %s"]);
  if (log) {
    commits = log
      .split("\n")
      .map(parseCommit)
      .filter((c): c is CommitSummary => c !== null);
  }
  console.log(
    `[bump] Changelog: ${commits.length} commits since ${prevTag ?? "initial"}.`,
  );
}

if (flags.dryRun) {
  console.log(
    "[bump] (dry-run) would update:",
    touchedFiles.map((p) => p.replace(ROOT + "/", "")).join(", "),
  );
  if (flags.changelog) {
    console.log("\n--- changelog entry ---");
    console.log(buildChangelogEntry(next, commits));
  }
  if (flags.commit)
    console.log(
      "[bump] (dry-run) would create commit chore(release): v" + next,
    );
  if (flags.tag)
    console.log("[bump] (dry-run) would create annotated tag v" + next);
  process.exit(0);
}

// P8 S2 rollback safety: capture pre-write snapshots of every file
// the update phase will touch. If any update throws (regex didn't
// match, FS error, anything), restore every file from its snapshot
// so the workspace is exactly as it was on entry. CHANGELOG.md is
// special-cased: if it didn't exist before, the rollback deletes
// the partial file rather than restoring an empty one.
type Snapshot = { path: string; existed: boolean; contents: string | null };
const snapshots: Snapshot[] = touchedFiles.map((p) => ({
  path: p,
  existed: existsSync(p),
  contents: existsSync(p) ? readFileSync(p, "utf8") : null,
}));
if (flags.changelog) {
  snapshots.push({
    path: CHANGELOG,
    existed: existsSync(CHANGELOG),
    contents: existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : null,
  });
}

function rollback(reason: unknown): never {
  console.error(
    `[bump] ERROR — rolling back: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
  for (const s of snapshots) {
    try {
      if (s.existed && s.contents !== null) {
        writeFileSync(s.path, s.contents);
      } else if (!s.existed && existsSync(s.path)) {
        // File didn't exist before; delete the partial write.
        try {
          Bun.spawnSync(["rm", "-f", s.path]);
        } catch {
          /* best-effort */
        }
      }
    } catch (e) {
      console.error(
        `[bump] (rollback) failed to restore ${s.path}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  console.error("[bump] Rollback complete. No git commit / tag was created.");
  process.exit(3);
}

try {
  updatePackageJson(next);
  updateElectrobunConfig(next);
  updateSystemRpc(next);
  updateCliDoc(next, CLI_DOC);
  updateApiDoc(next, API_DOC);
  updateCliDoc(next, CLI_DOC_FR);
  updateApiDoc(next, API_DOC_FR);
  if (flags.changelog) {
    const entry = buildChangelogEntry(next, commits);
    writeChangelog(entry);
    touchedFiles.push(CHANGELOG);
  }
} catch (err) {
  rollback(err);
}

console.log(
  `[bump] Updated package.json, electrobun.config.ts, src/bun/rpc-handlers/system.ts,\n        website-doc/src/content/docs/{,fr/}{cli,api}/system.md.`,
);
if (flags.changelog) {
  console.log(`[bump] Wrote CHANGELOG.md entry for v${next}.`);
}

// P8 S2 rollback safety for git: if commit succeeded but tag failed,
// undo the commit so the user can retry from a clean slate. Track
// post-file-write actions so we can unwind them in order.
const gitActions: Array<() => void> = [];
function gitRollback(reason: unknown): never {
  console.error(
    `[bump] ERROR — rolling back git state: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
  for (let i = gitActions.length - 1; i >= 0; i--) {
    try {
      gitActions[i]!();
    } catch (e) {
      console.error(
        `[bump] (rollback) git step failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  // Now restore the file snapshots too — git rollback can't undo
  // the .ts/.md/.json writes by itself.
  rollback(reason);
}

if (flags.commit) {
  try {
    // Stage exactly the files we touched (not anything else in the
    // working tree).
    git(["add", ...touchedFiles]);
    // Check there's actually something to commit (in case all files
    // were already at `next`).
    const staged = gitSoft(["diff", "--cached", "--name-only"]);
    if (!staged) {
      console.log(
        "[bump] Nothing to commit — files were already at this version.",
      );
    } else {
      git(["commit", "-m", `chore(release): v${next}`]);
      gitActions.push(() => {
        git(["reset", "--soft", "HEAD~1"]);
        git(["reset", "HEAD", "--", ...touchedFiles]);
      });
      console.log(`[bump] Created commit chore(release): v${next}.`);
    }
  } catch (err) {
    gitRollback(err);
  }
}

if (flags.tag) {
  try {
    // Refuse to overwrite an existing tag.
    if (gitSoft(["rev-parse", `v${next}`]) !== null) {
      throw new Error(`Tag v${next} already exists.`);
    }
    git(["tag", "-a", `v${next}`, "-m", `Release v${next}`]);
    gitActions.push(() => {
      git(["tag", "-d", `v${next}`]);
    });
    console.log(`[bump] Created annotated tag v${next}.`);
  } catch (err) {
    gitRollback(err);
  }
}

if (!flags.commit && !flags.tag) {
  console.log(`[bump] Review the diff, then commit.`);
}
