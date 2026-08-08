/**
 * Dropping files onto a terminal pane.
 *
 * The quoting is the part that matters. macOS filenames may contain
 * spaces, quotes, `$`, backticks and newlines, and the text goes to a
 * *shell* — a quoting bug here is command injection from a filename.
 */
import { describe, test, expect } from "bun:test";
import {
  extractDroppedPaths,
  formatDroppedPaths,
  shellQuote,
} from "../src/views/terminal/terminal-drop";

describe("shellQuote", () => {
  test("wraps a plain path", () => {
    expect(shellQuote("/tmp/file.txt")).toBe("'/tmp/file.txt'");
  });

  test("handles spaces", () => {
    expect(shellQuote("/tmp/my file.txt")).toBe("'/tmp/my file.txt'");
  });

  test("escapes embedded single quotes", () => {
    expect(shellQuote("/tmp/it's.txt")).toBe(`'/tmp/it'\\''s.txt'`);
  });

  test("neutralises shell metacharacters", () => {
    // Each of these would otherwise be interpreted by the shell.
    for (const evil of [
      "/tmp/$(whoami).txt",
      "/tmp/`id`.txt",
      "/tmp/a;rm -rf b.txt",
      "/tmp/a&&b.txt",
      "/tmp/a|b.txt",
      "/tmp/a>b.txt",
      "/tmp/*.txt",
      "/tmp/a$HOME.txt",
      '/tmp/a"b.txt',
      "/tmp/a\\b.txt",
    ]) {
      const quoted = shellQuote(evil);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
      // Nothing inside may terminate the quote except via the escape idiom.
      expect(quoted.slice(1, -1).includes("'")).toBe(false);
    }
  });

  test("a newline in a filename stays inside the quotes", () => {
    const quoted = shellQuote("/tmp/two\nlines.txt");
    expect(quoted).toBe("'/tmp/two\nlines.txt'");
    expect(quoted.slice(1, -1).includes("'")).toBe(false);
  });

  test("the quote-escape idiom round-trips through a real shell", async () => {
    // The one assertion that cannot be fooled by a plausible-looking
    // implementation: hand it to /bin/sh and see what comes back.
    const nasty = `/tmp/it's a $(whoami) "file"; rm -rf x.txt`;
    const proc = Bun.spawn(
      ["/bin/sh", "-c", `printf %s ${shellQuote(nasty)}`],
      {
        stdout: "pipe",
      },
    );
    expect(await new Response(proc.stdout).text()).toBe(nasty);
  });
});

describe("formatDroppedPaths", () => {
  test("single path", () => {
    expect(formatDroppedPaths(["/tmp/a.txt"])).toBe("'/tmp/a.txt'");
  });

  test("multiple paths are space-separated", () => {
    expect(formatDroppedPaths(["/tmp/a.txt", "/tmp/b c.txt"])).toBe(
      "'/tmp/a.txt' '/tmp/b c.txt'",
    );
  });

  test("nothing droppable produces nothing", () => {
    expect(formatDroppedPaths([])).toBe("");
    expect(formatDroppedPaths([""])).toBe("");
  });
});

describe("extractDroppedPaths", () => {
  test("prefers real filesystem paths from files[]", () => {
    expect(
      extractDroppedPaths({
        files: [{ path: "/Users/me/shot.png", name: "shot.png" }],
      }),
    ).toEqual(["/Users/me/shot.png"]);
  });

  test("ignores files[] entries with only a name", () => {
    // A bare filename would resolve against the wrong cwd.
    expect(extractDroppedPaths({ files: [{ name: "shot.png" }] })).toEqual([]);
  });

  test("falls back to text/uri-list", () => {
    expect(
      extractDroppedPaths({
        getData: (f) => (f === "text/uri-list" ? "file:///Users/me/a.txt" : ""),
      }),
    ).toEqual(["/Users/me/a.txt"]);
  });

  test("percent-decodes uri-list entries", () => {
    expect(
      extractDroppedPaths({
        getData: () => "file:///Users/me/my%20file%20(1).txt",
      }),
    ).toEqual(["/Users/me/my file (1).txt"]);
  });

  test("multiple uri-list entries and comments", () => {
    expect(
      extractDroppedPaths({
        getData: () => "# comment\nfile:///a.txt\n\nfile:///b.txt\n",
      }),
    ).toEqual(["/a.txt", "/b.txt"]);
  });

  test("non-file URLs are dropped, not pasted as text", () => {
    // A dragged web link is not a path; inserting https://… into a
    // shell prompt is not what the user meant.
    expect(
      extractDroppedPaths({ getData: () => "https://example.com/page" }),
    ).toEqual([]);
  });

  test("malformed URIs are skipped", () => {
    expect(extractDroppedPaths({ getData: () => "file://%%%" })).toEqual([]);
  });

  test("null / empty transfers are safe", () => {
    expect(extractDroppedPaths(null)).toEqual([]);
    expect(extractDroppedPaths({})).toEqual([]);
    expect(extractDroppedPaths({ files: [], getData: () => "" })).toEqual([]);
  });
});
