// P8 S1 — bump-version --commit / --tag / --changelog flag tests.
//
// Spawns the bump-version script against a sandboxed git repo built
// in a tmp dir with the seven version-tracked files seeded to a
// known version. Asserts:
//
// - --dry-run prints the would-be changes without touching files.
// - --commit creates a single chore(release) commit and refuses on
//   dirty trees (unless --allow-dirty is also passed).
// - --tag creates an annotated tag and refuses to overwrite an
//   existing one.
// - --changelog generates a CHANGELOG.md entry with conventional-
//   commit grouping; empty sections are skipped.

import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "scripts", "bump-version.ts");

interface SandboxOpts {
  version: string;
  /** Initial commits to layer on top of the seeded files. */
  extraCommits?: Array<{ subject: string; file?: string; body?: string }>;
  /** Optional tag at HEAD before any extra commits are layered. */
  baseTag?: string;
}

function seedFiles(dir: string, version: string): string[] {
  const files: Array<[string, string]> = [
    ["package.json", `{\n  "name": "tau-mux",\n  "version": "${version}"\n}\n`],
    [
      "electrobun.config.ts",
      `export default {\n  app: {\n    name: "tau-mux",\n    version: "${version}",\n  },\n};\n`,
    ],
    [
      "src/bun/rpc-handlers/system.ts",
      `export const VERSION = "${version}";\n`,
    ],
    [
      "website-doc/src/content/docs/cli/system.md",
      `# system\n\n\`\`\`\ntau-mux ${version} (build: dev)\n\`\`\`\n`,
    ],
    [
      "website-doc/src/content/docs/api/system.md",
      `# system\n\n\`\`\`json\n{ "version": "${version}" }\n\`\`\`\n`,
    ],
    [
      "website-doc/src/content/docs/fr/cli/system.md",
      `# système\n\n\`\`\`\ntau-mux ${version} (build: dev)\n\`\`\`\n`,
    ],
    [
      "website-doc/src/content/docs/fr/api/system.md",
      `# système\n\n\`\`\`json\n{ "version": "${version}" }\n\`\`\`\n`,
    ],
  ];
  const paths: string[] = [];
  for (const [rel, content] of files) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
    paths.push(rel);
  }
  return paths;
}

function sh(
  cwd: string,
  ...args: string[]
): { stdout: string; stderr: string; code: number } {
  const r = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  return {
    stdout: new TextDecoder().decode(r.stdout).trim(),
    stderr: new TextDecoder().decode(r.stderr).trim(),
    code: r.exitCode ?? -1,
  };
}

function makeSandbox(opts: SandboxOpts): string {
  const dir = mkdtempSync(join(tmpdir(), "bump-version-test-"));
  // Make a `scripts/` symlink-less copy: we run the real script via
  // an absolute path, so we just need the version-tracked files +
  // a git repo.
  const paths = seedFiles(dir, opts.version);
  sh(dir, "git", "init", "-q", "-b", "main");
  sh(dir, "git", "add", ".");
  sh(dir, "git", "commit", "-q", "-m", "initial");
  if (opts.baseTag) {
    sh(dir, "git", "tag", "-a", opts.baseTag, "-m", opts.baseTag);
  }
  for (const c of opts.extraCommits ?? []) {
    if (c.file) {
      writeFileSync(join(dir, c.file), c.body ?? "x\n");
      sh(dir, "git", "add", c.file);
    } else {
      // Make an empty commit if no file was supplied.
    }
    const args = c.file
      ? ["git", "commit", "-q", "-m", c.subject]
      : ["git", "commit", "-q", "--allow-empty", "-m", c.subject];
    sh(dir, ...args);
  }
  return dir;
}

function runBump(
  cwd: string,
  ...flags: string[]
): { stdout: string; stderr: string; code: number } {
  // BUMP_VERSION_ROOT redirects the script's filesystem ops to the
  // sandbox so we can test the real script without mocking.
  const r = Bun.spawnSync(["bun", SCRIPT, ...flags], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUMP_VERSION_ROOT: cwd,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  return {
    stdout: new TextDecoder().decode(r.stdout).trim(),
    stderr: new TextDecoder().decode(r.stderr).trim(),
    code: r.exitCode ?? -1,
  };
}

describe("bump-version --commit/--tag/--changelog (P8 S1)", () => {
  test("--dry-run prints would-be changes but writes nothing", () => {
    const dir = makeSandbox({ version: "0.1.0" });
    const r = runBump(dir, "patch", "--dry-run", "--changelog");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("0.1.0 → 0.1.1");
    expect(r.stdout).toContain("(dry-run)");
    // package.json untouched.
    expect(readFileSync(join(dir, "package.json"), "utf8")).toContain(
      '"version": "0.1.0"',
    );
    // No CHANGELOG written.
    expect(existsSync(join(dir, "CHANGELOG.md"))).toBe(false);
  });

  test("--commit creates a chore(release) commit and stages exactly the touched files", () => {
    const dir = makeSandbox({ version: "0.1.0" });
    const r = runBump(dir, "patch", "--commit");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Created commit chore(release): v0.1.1");
    const head = sh(dir, "git", "log", "-1", "--pretty=%s").stdout;
    expect(head).toBe("chore(release): v0.1.1");
    // Working tree is clean.
    expect(sh(dir, "git", "status", "--porcelain").stdout).toBe("");
    // package.json now at 0.1.1.
    expect(readFileSync(join(dir, "package.json"), "utf8")).toContain(
      '"version": "0.1.1"',
    );
  });

  test("--commit refuses on dirty working tree without --allow-dirty", () => {
    const dir = makeSandbox({ version: "0.1.0" });
    // Add an unrelated dirty file.
    writeFileSync(join(dir, "stray.txt"), "x\n");
    sh(dir, "git", "add", "stray.txt");
    const r = runBump(dir, "patch", "--commit");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("uncommitted changes");
  });

  test("--commit with --allow-dirty proceeds despite stray files", () => {
    const dir = makeSandbox({ version: "0.1.0" });
    writeFileSync(join(dir, "stray.txt"), "x\n");
    const r = runBump(dir, "patch", "--commit", "--allow-dirty");
    expect(r.code).toBe(0);
    const head = sh(dir, "git", "log", "-1", "--pretty=%s").stdout;
    expect(head).toBe("chore(release): v0.1.1");
    // stray.txt remains untracked / unstaged.
    const status = sh(dir, "git", "status", "--porcelain").stdout;
    expect(status).toContain("?? stray.txt");
  });

  test("--tag creates annotated tag at the release commit", () => {
    const dir = makeSandbox({ version: "0.1.0" });
    const r = runBump(dir, "patch", "--tag");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Created annotated tag v0.1.1");
    // Tag exists and points at HEAD.
    const tagSha = sh(dir, "git", "rev-list", "-n", "1", "v0.1.1").stdout;
    const headSha = sh(dir, "git", "rev-parse", "HEAD").stdout;
    expect(tagSha).toBe(headSha);
    // It's annotated, not lightweight.
    const tagType = sh(dir, "git", "cat-file", "-t", "v0.1.1").stdout;
    expect(tagType).toBe("tag");
  });

  test("--tag refuses to overwrite an existing tag", () => {
    const dir = makeSandbox({ version: "0.1.0" });
    sh(dir, "git", "tag", "v0.1.1");
    const r = runBump(dir, "patch", "--tag");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("already exists");
  });

  test(
    "--changelog groups conventional commits by type and skips empty sections",
    { timeout: 15000 },
    () => {
      const dir = makeSandbox({
        version: "0.1.0",
        baseTag: "v0.1.0",
        extraCommits: [
          { subject: "feat(ui): add foo", file: "a.txt" },
          { subject: "fix: bar", file: "b.txt" },
          { subject: "chore: deps", file: "c.txt" },
          { subject: "random thing not conventional", file: "d.txt" },
        ],
      });
      const r = runBump(dir, "patch", "--changelog");
      expect(r.code).toBe(0);
      const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
      expect(changelog).toContain("## v0.1.1");
      expect(changelog).toContain("### Features");
      expect(changelog).toContain("**ui**: add foo");
      expect(changelog).toContain("### Bug fixes");
      expect(changelog).toContain("- bar");
      expect(changelog).toContain("### Chores");
      expect(changelog).toContain("### Other");
      expect(changelog).toContain("- random thing not conventional");
      // Performance / Refactoring / Documentation / Tests sections
      // are absent — no commits of those types.
      expect(changelog).not.toContain("### Performance");
      expect(changelog).not.toContain("### Refactoring");
      expect(changelog).not.toContain("### Documentation");
      expect(changelog).not.toContain("### Tests");
    },
  );

  test(
    "--changelog --commit stages CHANGELOG.md alongside the version files",
    { timeout: 15000 },
    () => {
      const dir = makeSandbox({
        version: "0.1.0",
        baseTag: "v0.1.0",
        extraCommits: [{ subject: "feat: thing", file: "a.txt" }],
      });
      const r = runBump(dir, "patch", "--changelog", "--commit");
      expect(r.code).toBe(0);
      const head = sh(dir, "git", "log", "-1", "--pretty=%s").stdout;
      expect(head).toBe("chore(release): v0.1.1");
      // CHANGELOG.md is included in the commit (no diff in working tree).
      const status = sh(dir, "git", "status", "--porcelain").stdout;
      expect(status).toBe("");
      // The commit touches CHANGELOG.md.
      const filesInCommit = sh(
        dir,
        "git",
        "show",
        "--name-only",
        "--pretty=",
        "HEAD",
      ).stdout.split("\n");
      expect(filesInCommit).toContain("CHANGELOG.md");
    },
  );

  test("unknown flag fails fast", () => {
    const dir = makeSandbox({ version: "0.1.0" });
    const r = runBump(dir, "patch", "--bogus");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("Unknown flag");
  });

  // -----------------------------------------------------------------
  // P8 S2 — rollback safety
  // -----------------------------------------------------------------

  test("rollback restores all files if a later update throws", () => {
    const dir = makeSandbox({ version: "0.1.0" });
    // Corrupt system.ts so the regex `const VERSION = "…"` won't
    // match — the update fn throws, triggering rollback.
    writeFileSync(
      join(dir, "src/bun/rpc-handlers/system.ts"),
      "// no version constant here\n",
    );
    // Snapshot the pre-bump contents of package.json so we can
    // assert it was restored.
    const pkgBefore = readFileSync(join(dir, "package.json"), "utf8");
    const r = runBump(dir, "patch");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("rolling back");
    // package.json was touched before the throw; rollback should
    // have restored it to its pre-bump contents.
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(pkgBefore);
  });

  test("rollback deletes CHANGELOG.md if it didn't exist before", () => {
    const dir = makeSandbox({
      version: "0.1.0",
      extraCommits: [{ subject: "feat: a", file: "x.txt" }],
    });
    // Corrupt the FR API doc so a later update throws AFTER
    // CHANGELOG.md has been written.
    writeFileSync(
      join(dir, "website-doc/src/content/docs/fr/api/system.md"),
      "no version key here\n",
    );
    expect(existsSync(join(dir, "CHANGELOG.md"))).toBe(false);
    const r = runBump(dir, "patch", "--changelog");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("rolling back");
    // CHANGELOG.md was created mid-update; rollback should have
    // deleted it.
    expect(existsSync(join(dir, "CHANGELOG.md"))).toBe(false);
  });

  test("rollback undoes the commit if --tag fails after --commit succeeded", () => {
    const dir = makeSandbox({ version: "0.1.0" });
    // Pre-create the tag so --tag's "already exists" check trips.
    sh(dir, "git", "tag", "v0.1.1");
    const headBefore = sh(dir, "git", "rev-parse", "HEAD").stdout;
    const r = runBump(dir, "patch", "--tag");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("rolling back");
    // HEAD should be where it was before — the commit was reset.
    const headAfter = sh(dir, "git", "rev-parse", "HEAD").stdout;
    expect(headAfter).toBe(headBefore);
    // Files should be back to 0.1.0.
    expect(readFileSync(join(dir, "package.json"), "utf8")).toContain(
      '"version": "0.1.0"',
    );
  });
});
