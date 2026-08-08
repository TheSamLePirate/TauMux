/**
 * Reconstructing file references that a terminal broke across rows.
 *
 * Two splits with different rules: a terminal soft wrap (xterm marks the
 * row `isWrapped`, nothing was inserted) and an application hard wrap
 * (a real newline plus an indent that is decoration, not path).
 *
 * The module over-generates on purpose — the caller probes candidates
 * against the filesystem — so these tests check that the *right
 * candidate is present*, and that joins which would corrupt independent
 * references are never proposed at all.
 */
import { describe, expect, test } from "bun:test";
import {
  findReferencesAcrossRows,
  pickNonOverlapping,
  type TerminalRowText,
  type WrappedFileReference,
} from "../src/shared/wrapped-file-reference";

/** Build a `getRow` over a list of rows starting at row 1. */
function rows(
  ...lines: (string | [string, { wrapped: boolean }])[]
): (row: number) => TerminalRowText | null {
  const parsed = lines.map((l) =>
    typeof l === "string"
      ? { text: l, isWrapped: false }
      : { text: l[0], isWrapped: l[1].wrapped },
  );
  return (row: number) => parsed[row - 1] ?? null;
}

const paths = (refs: WrappedFileReference[]) => refs.map((r) => r.path);

describe("single-row references still work", () => {
  test("finds a plain reference on the hovered row", () => {
    const refs = findReferencesAcrossRows(rows("edited src/index.ts:12"), 1);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "src/index.ts",
      line: 12,
      rowSpan: 1,
    });
  });

  test("columns are 0-based, end exclusive", () => {
    const [r] = findReferencesAcrossRows(rows("at src/a.ts"), 1);
    expect(r!.range).toEqual({
      startRow: 1,
      startCol: 3,
      endRow: 1,
      endCol: 11,
    });
  });

  test("a match wholly on an earlier row is not offered for this row", () => {
    const refs = findReferencesAcrossRows(rows("src/a.ts", "unrelated"), 2);
    expect(paths(refs)).not.toContain("src/a.ts");
  });
});

describe("terminal soft wrap", () => {
  test("joins a path the terminal split at the column edge", () => {
    const refs = findReferencesAcrossRows(
      rows("Read(/private/tmp/scratch/base-spl", [
        "it.png)",
        { wrapped: true },
      ]),
      1,
    );
    expect(paths(refs)).toContain("/private/tmp/scratch/base-split.png");
  });

  test("the joined range spans both rows", () => {
    const refs = findReferencesAcrossRows(
      rows("/private/tmp/scratch/base-spl", ["it.png", { wrapped: true }]),
      1,
    );
    const joined = refs.find((r) => r.rowSpan === 2)!;
    expect(joined.range).toMatchObject({ startRow: 1, endRow: 2, endCol: 6 });
  });

  test("hovering the SECOND row finds the same reference", () => {
    // The failure the user hit: the continuation row was dead to the
    // pointer because matching started and ended on one row.
    const refs = findReferencesAcrossRows(
      rows("/private/tmp/scratch/base-spl", ["it.png", { wrapped: true }]),
      2,
    );
    expect(paths(refs)).toContain("/private/tmp/scratch/base-split.png");
  });

  test("a soft-wrapped row starting with a space ends the token", () => {
    // A soft wrap inserts nothing, so that leading space is real
    // content — the path stopped at the row boundary.
    const refs = findReferencesAcrossRows(
      rows("/tmp/a.ts", [" and more", { wrapped: true }]),
      1,
    );
    expect(paths(refs)).toEqual(["/tmp/a.ts"]);
  });
});

describe("application hard wrap with an indent", () => {
  test("joins Claude Code's re-flowed transcript path", () => {
    const refs = findReferencesAcrossRows(
      rows(
        "⏺ Read(/private/tmp/claude-501/-Users-olivierveinand-Doc",
        "  uments-DEV-crazyShell/scratchpad/base-split.png)",
      ),
      1,
    );
    expect(paths(refs)).toContain(
      "/private/tmp/claude-501/-Users-olivierveinand-Documents-DEV-crazyShell/scratchpad/base-split.png",
    );
  });

  test("the trailing ) is stripped, not made part of the path", () => {
    const refs = findReferencesAcrossRows(
      rows("Read(/tmp/scratch/shot", "  .png)"),
      1,
    );
    expect(paths(refs)).toContain("/tmp/scratch/shot.png");
  });

  test("joins across three rows", () => {
    const refs = findReferencesAcrossRows(
      rows(
        "/private/tmp/claude-501/-Users-oli",
        "  vier/scratchpad/base",
        "  -split.png",
      ),
      2,
    );
    expect(paths(refs)).toContain(
      "/private/tmp/claude-501/-Users-olivier/scratchpad/base-split.png",
    );
  });

  test("hovering the LAST row of a three-row split still finds it", () => {
    const refs = findReferencesAcrossRows(
      rows(
        "/private/tmp/claude-501/-Users-oli",
        "  vier/scratchpad/base",
        "  -split.png",
      ),
      3,
    );
    expect(paths(refs)).toContain(
      "/private/tmp/claude-501/-Users-olivier/scratchpad/base-split.png",
    );
  });

  test("a tab indent works like a space indent", () => {
    const refs = findReferencesAcrossRows(
      rows("/tmp/scratch/sh", "\tot.png"),
      1,
    );
    expect(paths(refs)).toContain("/tmp/scratch/shot.png");
  });

  test("an un-indented next line is NOT joined", () => {
    // Without an indent there is no evidence of a wrap, and joining two
    // ordinary lines would corrupt both references.
    const refs = findReferencesAcrossRows(rows("/tmp/a.ts", "/tmp/b.ts"), 1);
    expect(paths(refs)).toEqual(["/tmp/a.ts"]);
  });

  test("the un-joined reading is ALWAYS offered alongside the join", () => {
    // The filesystem, not this module, decides which is real.
    const refs = findReferencesAcrossRows(
      rows("edited src/a.ts", "  and src/b.ts"),
      1,
    );
    expect(paths(refs)).toContain("src/a.ts");
  });

  test("a bogus join does not destroy the plain reference on the row", () => {
    // Regression guard: an earlier design merged rows before matching,
    // so "src/a.ts" + "and" became one greedy token and the real
    // reference vanished.
    const refs = findReferencesAcrossRows(
      rows("edited src/a.ts", "  and something else"),
      1,
    );
    const plain = refs.find((r) => r.path === "src/a.ts" && r.rowSpan === 1);
    expect(plain).toBeDefined();
  });

  test("stops extending once a continuation row has content past its tail", () => {
    // "  .png and more" proves the token ended mid-row, so nothing
    // further may be swallowed.
    const refs = findReferencesAcrossRows(
      rows("/tmp/scratch/shot", "  .png and more", "  /etc/passwd"),
      1,
    );
    expect(paths(refs)).not.toContain("/tmp/scratch/shot.png/etc/passwd");
    expect(paths(refs)).toContain("/tmp/scratch/shot.png");
  });

  test("over-generation is bounded and always includes the real reading", () => {
    // Deeper joins that no wrap produced are left in the candidate set
    // on purpose — they name files that do not exist, and the caller's
    // probe drops them. What matters is that the correct reading is
    // present and the set stays small enough to probe.
    const refs = findReferencesAcrossRows(
      rows("/tmp/scratch/shot", "  .png", "  /etc/passwd"),
      1,
    );
    expect(paths(refs)).toContain("/tmp/scratch/shot.png");
    expect(refs.length).toBeLessThanOrEqual(8);
  });

  test("row lookups past the end of the buffer are tolerated", () => {
    expect(() => findReferencesAcrossRows(rows("/tmp/a.ts"), 1)).not.toThrow();
    expect(findReferencesAcrossRows(rows(), 1)).toEqual([]);
  });

  test("respects the continuation-row bound", () => {
    const refs = findReferencesAcrossRows(
      rows("/tmp/a", "  b", "  c", "  d"),
      1,
      { maxContinuationRows: 1 },
    );
    expect(paths(refs)).not.toContain("/tmp/abcd");
  });
});

describe("pickNonOverlapping", () => {
  const ref = (
    path: string,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): WrappedFileReference => ({
    path,
    line: null,
    column: null,
    matchText: path,
    range: { startRow, startCol, endRow, endCol },
    rowSpan: endRow - startRow + 1,
  });

  test("prefers the joined reading over the truncated one", () => {
    // /tmp/foo is a real directory AND the prefix of a real file that
    // continues onto the next row. The longer reading is what was meant.
    const chosen = pickNonOverlapping([
      ref("/tmp/foo", 1, 0, 1, 8),
      ref("/tmp/foobar.png", 1, 0, 2, 7),
    ]);
    expect(paths(chosen)).toEqual(["/tmp/foobar.png"]);
  });

  test("keeps independent references on the same row", () => {
    const chosen = pickNonOverlapping([
      ref("a.ts", 1, 0, 1, 4),
      ref("b.ts", 1, 10, 1, 14),
    ]);
    expect(paths(chosen).sort()).toEqual(["a.ts", "b.ts"]);
  });

  test("adjacent ranges do not count as overlapping", () => {
    const chosen = pickNonOverlapping([
      ref("a.ts", 1, 0, 1, 4),
      ref("b.ts", 1, 4, 1, 8),
    ]);
    expect(chosen).toHaveLength(2);
  });

  test("longer path wins at equal span", () => {
    const chosen = pickNonOverlapping([
      ref("src/a", 1, 0, 1, 5),
      ref("src/a.ts", 1, 0, 1, 8),
    ]);
    expect(paths(chosen)).toEqual(["src/a.ts"]);
  });

  test("empty in, empty out", () => {
    expect(pickNonOverlapping([])).toEqual([]);
  });
});
