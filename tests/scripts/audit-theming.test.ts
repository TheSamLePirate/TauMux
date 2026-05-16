// Phase 5 — audit:theming script unit tests.
//
// Hermetic tests against synthetic CSS fragments. The script lives at
// scripts/audit-theming.ts; running it against the live codebase
// reports the real (large) backlog of literals to migrate as part of
// P7 polish work. The unit tests below pin the matcher's behaviour
// so the audit's signal stays correct as that backlog shrinks.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditOneFile, COLOR_RE } from "../../scripts/audit-theming";

function writeCss(body: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "audit-theming-"));
  const path = join(dir, "test.css");
  writeFileSync(path, body);
  return { dir, path };
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* swallow */
  }
}

describe("[Phase 5] audit-theming — color regex", () => {
  it("matches hex literals", () => {
    expect("color: #fff".match(COLOR_RE)).toEqual(["#fff"]);
    expect("color: #abcdef".match(COLOR_RE)).toEqual(["#abcdef"]);
    expect("color: #abcdef99".match(COLOR_RE)).toEqual(["#abcdef99"]);
  });

  it("matches rgb / rgba / hsl / hsla", () => {
    COLOR_RE.lastIndex = 0;
    const text =
      "a rgb(1,2,3) b rgba(1,2,3,.5) c hsl(1,2%,3%) d hsla(1,2%,3%,.5)";
    expect(text.match(COLOR_RE)?.length).toBe(4);
  });

  it("matches oklch / lab / color()", () => {
    COLOR_RE.lastIndex = 0;
    expect("a oklch(0.7 0.1 30)".match(COLOR_RE)?.[0]).toBe("oklch(");
    expect("a lab(50% 20 -10)".match(COLOR_RE)?.[0]).toBe("lab(");
    expect("a color(display-p3 1 0 0)".match(COLOR_RE)?.[0]).toBe("color(");
  });

  it("does NOT match var(--…) tokens", () => {
    COLOR_RE.lastIndex = 0;
    expect("color: var(--ht-accent)".match(COLOR_RE)).toBeNull();
  });

  it("does NOT match non-hex hash strings (URL fragments)", () => {
    COLOR_RE.lastIndex = 0;
    // `mask` contains m/s/k — non-hex letters — so the regex skips
    // it. URL fragments named with all-hex chars would still match;
    // the false-positive cost there is low (rare) and a hex name
    // could legitimately be a colour reference at the call site.
    expect("url(#mask)".match(COLOR_RE)).toBeNull();
    expect("url(#abc)".match(COLOR_RE)?.[0]).toBe("#abc"); // all-hex: matches
  });
});

describe("[Phase 5] audit-theming — auditOneFile", () => {
  it("returns no hits for a file whose only colour lives inside :root", () => {
    const { dir, path } = writeCss(`
      :root {
        --x: #fff;
        --y: rgba(0, 0, 0, 0.5);
      }
      .a { color: var(--x); }
    `);
    try {
      const hits = auditOneFile(path);
      expect(hits).toEqual([]);
    } finally {
      cleanup(dir);
    }
  });

  it("flags a hard-coded colour on a component rule", () => {
    const { dir, path } = writeCss(`
      :root { --x: #fff; }
      .a { color: #ff00ff; }
    `);
    try {
      const hits = auditOneFile(path);
      expect(hits.length).toBe(1);
      expect(hits[0].match).toBe("#ff00ff");
    } finally {
      cleanup(dir);
    }
  });

  it("strips block comments so a comment mentioning #fff doesn't trip the audit", () => {
    const { dir, path } = writeCss(`
      /* maybe later #ff00ff would be nice */
      .a { color: var(--x); }
    `);
    try {
      const hits = auditOneFile(path);
      expect(hits).toEqual([]);
    } finally {
      cleanup(dir);
    }
  });

  it("preserves line numbers after stripping a multi-line :root block", () => {
    // The strip function MUST preserve newlines so the reported line
    // number matches the raw source. Without that fix the script
    // reports a `#ff00ff` on the wrong line, which silently shows
    // the wrong context to the reviewer.
    const { dir, path } = writeCss(
      [
        ":root {",
        "  --a: #111;",
        "  --b: #222;",
        "  --c: #333;",
        "}",
        "",
        ".whatever {",
        "  color: #ff00ff;",
        "}",
      ].join("\n"),
    );
    try {
      const hits = auditOneFile(path);
      expect(hits.length).toBe(1);
      expect(hits[0].match).toBe("#ff00ff");
      expect(hits[0].line).toBe(8);
    } finally {
      cleanup(dir);
    }
  });

  it("flags multiple literals on the same line", () => {
    const { dir, path } = writeCss(`
      .a { background: linear-gradient(#fff, #000); }
    `);
    try {
      const hits = auditOneFile(path);
      expect(hits.length).toBe(2);
      expect(hits.map((h) => h.match)).toEqual(["#fff", "#000"]);
    } finally {
      cleanup(dir);
    }
  });
});
