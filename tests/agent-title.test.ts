// Agent title normalisation.
//
// Claude Code titles its terminal `<glyph> <summary>`, where the glyph
// is an animated braille spinner during a turn. Two things follow: the
// pane bar must not churn through spinner frames, and the glyph is a
// liveness signal worth keeping rather than a character worth rendering.
//
// The conservative half matters most: this runs on the title of EVERY
// program in every pane, so it must not eat text from titles that merely
// happen to start with punctuation.

import { describe, expect, test } from "bun:test";
import { parseAgentTitle } from "../src/shared/agent-title";
import { decideTitle } from "../src/shared/title-precedence";

describe("parseAgentTitle", () => {
  test("strips a static agent mark", () => {
    const t = parseAgentTitle("✳ Commit changes");
    expect(t.text).toBe("Commit changes");
    expect(t.glyph).toBe("✳");
    expect(t.busy).toBe(false);
    expect(t.fromAgent).toBe(true);
  });

  test("strips a spinner frame and reports busy", () => {
    for (const frame of ["⢂", "⣾", "⠋", "⣟"]) {
      const t = parseAgentTitle(`${frame} Running tests`);
      expect(t.text).toBe("Running tests");
      expect(t.busy).toBe(true);
      expect(t.fromAgent).toBe(true);
    }
  });

  test("every spinner frame yields the same stable text", () => {
    const texts = ["⢂", "⢄", "⢆", "⣾", "⣷"].map(
      (f) => parseAgentTitle(`${f} Commit changes`).text,
    );
    expect(new Set(texts).size).toBe(1);
  });

  test("leaves an ordinary title untouched", () => {
    for (const raw of [
      "zsh",
      "vim src/index.ts",
      "bun run dev",
      "~/Documents/DEV/crazyShell",
    ]) {
      const t = parseAgentTitle(raw);
      expect(t.text).toBe(raw);
      expect(t.glyph).toBe("");
      expect(t.fromAgent).toBe(false);
    }
  });

  test("only a LEADING glyph is stripped", () => {
    const t = parseAgentTitle("build ✳ step 2");
    expect(t.text).toBe("build ✳ step 2");
    expect(t.fromAgent).toBe(false);
  });

  test("a bare glyph keeps something to render", () => {
    const t = parseAgentTitle("✳");
    expect(t.text).toBe("✳");
    expect(t.glyph).toBe("✳");
    expect(t.fromAgent).toBe(true);
  });

  test("trims surrounding whitespace", () => {
    expect(parseAgentTitle("  ✳   Deploy  ").text).toBe("Deploy");
  });

  test("an empty title stays empty rather than becoming a glyph", () => {
    const t = parseAgentTitle("   ");
    expect(t.text).toBe("");
    expect(t.fromAgent).toBe(false);
  });

  test("non-ASCII titles survive intact", () => {
    const raw = "✳ Ajouter clause de médiation aux conditions générales";
    const t = parseAgentTitle(raw);
    expect(t.text).toBe("Ajouter clause de médiation aux conditions générales");
  });
});

describe("decideTitle — who gets to name a pane", () => {
  test("a user rename always wins and claims the title", () => {
    expect(decideTitle("user", false)).toEqual({ apply: true, lock: true });
    expect(decideTitle("user", true)).toEqual({ apply: true, lock: true });
  });

  test("a program rename applies only while the title is unclaimed", () => {
    expect(decideTitle("program", false)).toEqual({ apply: true, lock: false });
    // Otherwise `ht rename-surface "watcher"` would lose to the next
    // shell prompt.
    expect(decideTitle("program", true)).toEqual({ apply: false, lock: false });
  });

  test("restore re-applies text without claiming anything", () => {
    // Restore used to imply "user", which froze every restored pane's
    // title for the rest of the session.
    expect(decideTitle("restore", false)).toEqual({ apply: true, lock: false });
    expect(decideTitle("restore", true)).toEqual({ apply: true, lock: false });
  });
});
