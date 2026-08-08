/**
 * `ht shell-integration` rc-file editing.
 *
 * This code writes to `~/.zshrc`. A bug here does not degrade a feature,
 * it breaks the user's shell — so the edit is a pure function over the
 * file contents, tested against the shapes real rc files take: missing,
 * empty, no trailing newline, already installed, hand-mangled.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BEGIN_MARK,
  END_MARK,
  SNIPPET,
  detectShell,
  installInto,
  isInstalledIn,
  rcPathFor,
  stripSnippet,
  uninstallFrom,
} from "../src/cli/shell-integration";

const dirs: string[] = [];
function tmpRc(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ht-shellint-"));
  dirs.push(dir);
  const rc = join(dir, ".zshrc");
  if (contents !== undefined) writeFileSync(rc, contents, "utf-8");
  return rc;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("shell + path detection", () => {
  test("bash is detected from $SHELL", () => {
    expect(detectShell("/bin/bash")).toBe("bash");
    expect(detectShell("/opt/homebrew/bin/bash")).toBe("bash");
  });

  test("everything else defaults to zsh — the macOS default", () => {
    expect(detectShell("/bin/zsh")).toBe("zsh");
    expect(detectShell("")).toBe("zsh");
    expect(detectShell("/usr/bin/fish")).toBe("zsh");
  });

  test("rc paths are the conventional ones", () => {
    expect(rcPathFor("zsh", "/home/me")).toBe("/home/me/.zshrc");
    expect(rcPathFor("bash", "/home/me")).toBe("/home/me/.bashrc");
  });
});

describe("the snippet itself", () => {
  test("is guarded, so it is inert outside tau-mux", () => {
    // The whole safety story: installing this must not be able to break
    // the user's shell in iTerm2, over SSH, or in CI.
    expect(SNIPPET).toContain('[ -n "${HT_SHELL_INTEGRATION_PATH:-}" ]');
    expect(SNIPPET).toContain('[ -r "$HT_SHELL_INTEGRATION_PATH" ]');
  });

  test("sources the variable, never a hard-coded path", () => {
    // A literal path would go stale the moment the .app moves.
    expect(SNIPPET).not.toMatch(/\/Applications|\/Users\//);
  });

  test("is bracketed by markers so removal is exact", () => {
    expect(SNIPPET.startsWith(BEGIN_MARK)).toBe(true);
    expect(SNIPPET.trimEnd().endsWith(END_MARK)).toBe(true);
  });
});

describe("install", () => {
  test("creates the file when it does not exist", () => {
    const rc = tmpRc();
    expect(installInto(rc)).toBe("installed");
    expect(isInstalledIn(readFileSync(rc, "utf-8"))).toBe(true);
  });

  test("appends to an existing file, preserving it exactly", () => {
    const original = "export EDITOR=vim\nalias g=git\n";
    const rc = tmpRc(original);
    installInto(rc);
    const after = readFileSync(rc, "utf-8");
    expect(after.startsWith(original)).toBe(true);
    expect(after).toContain(BEGIN_MARK);
  });

  test("adds a newline first when the file lacks a trailing one", () => {
    const rc = tmpRc("alias g=git");
    installInto(rc);
    expect(readFileSync(rc, "utf-8")).toContain("alias g=git\n");
  });

  test("is idempotent", () => {
    const rc = tmpRc("alias g=git\n");
    installInto(rc);
    const once = readFileSync(rc, "utf-8");
    expect(installInto(rc)).toBe("already");
    expect(readFileSync(rc, "utf-8")).toBe(once);
  });

  test("backs the file up before touching it", () => {
    const rc = tmpRc("precious config\n");
    installInto(rc);
    expect(existsSync(`${rc}.tau-mux.bak`)).toBe(true);
    expect(readFileSync(`${rc}.tau-mux.bak`, "utf-8")).toBe(
      "precious config\n",
    );
  });
});

describe("uninstall", () => {
  test("removes the block and restores the original bytes", () => {
    const original = "export EDITOR=vim\nalias g=git\n";
    const rc = tmpRc(original);
    installInto(rc);
    expect(uninstallFrom(rc)).toBe("removed");
    expect(readFileSync(rc, "utf-8")).toBe(original);
  });

  test("reports absent rather than pretending", () => {
    const rc = tmpRc("alias g=git\n");
    expect(uninstallFrom(rc)).toBe("absent");
    expect(readFileSync(rc, "utf-8")).toBe("alias g=git\n");
  });

  test("a missing file is absent, not an error", () => {
    expect(uninstallFrom(tmpRc())).toBe("absent");
  });
});

describe("stripSnippet", () => {
  test("leaves an unrelated file untouched", () => {
    const s = "line one\nline two\n";
    expect(stripSnippet(s)).toBe(s);
  });

  test("removes content that follows the block", () => {
    const s = `before\n${SNIPPET}\nafter\n`;
    expect(stripSnippet(s)).toContain("before");
    expect(stripSnippet(s)).toContain("after");
    expect(stripSnippet(s)).not.toContain(BEGIN_MARK);
  });

  test("removes every copy if a file somehow has two", () => {
    const s = `a\n${SNIPPET}\nb\n${SNIPPET}\nc\n`;
    const out = stripSnippet(s);
    expect(out).not.toContain(BEGIN_MARK);
    expect(out).not.toContain(END_MARK);
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).toContain("c");
  });

  test("an unterminated block is removed to end of file", () => {
    // Hand-edited file: leaving a dangling `. "$HT_SHELL_INTEGRATION_PATH"`
    // behind would be worse than removing a trailing comment.
    const s = `keep me\n${BEGIN_MARK}\n. "$HT_SHELL_INTEGRATION_PATH"\n`;
    const out = stripSnippet(s);
    expect(out).toContain("keep me");
    expect(out).not.toContain("HT_SHELL_INTEGRATION_PATH");
  });

  test("does not remove a line that merely mentions the marker", () => {
    // Only a line that *is* the marker counts.
    const s = `echo "${BEGIN_MARK} is a marker"\n`;
    expect(stripSnippet(s)).toBe(s);
  });
});
