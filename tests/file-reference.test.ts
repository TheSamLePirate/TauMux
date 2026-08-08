/**
 * `path:line:col` matching for clickable terminal output.
 *
 * The bar for a link matcher is asymmetric: a missed link costs a
 * retype, a false positive underlines prose and *steals the click*. So
 * most of these tests are about what must NOT match.
 */
import { describe, test, expect } from "bun:test";
import {
  findFileReferences,
  isAbsoluteish,
} from "../src/shared/file-reference";

const paths = (s: string) => findFileReferences(s).map((r) => r.path);

describe("matches what tools actually print", () => {
  test("relative path with line and column", () => {
    const [r] = findFileReferences("src/bun/index.ts:2058:12");
    expect(r).toMatchObject({
      path: "src/bun/index.ts",
      line: 2058,
      column: 12,
    });
  });

  test("relative path with line only", () => {
    const [r] = findFileReferences("at tests/foo.test.ts:12");
    expect(r).toMatchObject({
      path: "tests/foo.test.ts",
      line: 12,
      column: null,
    });
  });

  test("path with no position at all", () => {
    const [r] = findFileReferences("edited src/shared/settings.ts");
    expect(r).toMatchObject({ path: "src/shared/settings.ts", line: null });
  });

  test("absolute path", () => {
    expect(paths("/Users/me/project/main.rs:9")).toEqual([
      "/Users/me/project/main.rs",
    ]);
  });

  test("home-relative and dot-relative paths", () => {
    expect(paths("~/.zshrc")).toEqual(["~/.zshrc"]);
    expect(paths("./scripts/build.ts:4")).toEqual(["./scripts/build.ts"]);
    expect(paths("../sibling/mod.rs")).toEqual(["../sibling/mod.rs"]);
  });

  test("a bare filename with an extension", () => {
    expect(paths("package.json is malformed")).toEqual(["package.json"]);
  });

  test("dotfiles and multi-dot names", () => {
    expect(paths("check .eslintrc.json now")).toEqual([".eslintrc.json"]);
    expect(paths("build Makefile.am")).toEqual(["Makefile.am"]);
  });

  test("several references on one line", () => {
    expect(paths("moved src/a.ts to src/b.ts")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("a typical compiler diagnostic", () => {
    const refs = findFileReferences(
      "src/views/terminal/index.ts(2058,12): error TS2345: bad",
    );
    expect(refs[0]!.path).toBe("src/views/terminal/index.ts");
  });

  test("a stack-trace frame", () => {
    const refs = findFileReferences(
      "    at foo (/Users/me/app/src/handler.ts:88:7)",
    );
    expect(refs[0]).toMatchObject({
      path: "/Users/me/app/src/handler.ts",
      line: 88,
      column: 7,
    });
  });
});

describe("does not match prose", () => {
  test("plain sentences", () => {
    expect(paths("this is a normal sentence about code")).toEqual([]);
  });

  test("a word followed by a number", () => {
    expect(paths("see line 42 for details")).toEqual([]);
    expect(paths("error:12 occurred")).toEqual([]);
  });

  test("a bare word with no extension or separator", () => {
    // `README` is indistinguishable from a word; a false positive here
    // would underline half the transcript.
    expect(paths("open README please")).toEqual([]);
  });

  test("bare directory references", () => {
    expect(paths("cd ..")).toEqual([]);
    expect(paths("ls .")).toEqual([]);
  });

  test("an over-long pseudo-extension is not a file", () => {
    expect(paths("word.extensionthatistoolong")).toEqual([]);
  });

  test("punctuation alone never matches", () => {
    expect(paths("--- ::: ...")).toEqual([]);
  });
});

describe("boundaries and punctuation", () => {
  test("trailing sentence punctuation is not part of the path", () => {
    expect(paths("edited src/a.ts.")).toEqual(["src/a.ts"]);
    expect(paths("see src/a.ts, then src/b.ts;")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("a wrapping bracket is not part of the path", () => {
    expect(paths("(src/a.ts)")).toEqual(["src/a.ts"]);
    expect(paths("[src/a.ts]")).toEqual(["src/a.ts"]);
  });

  test("a trailing digit after a colon is a line number, not junk", () => {
    const [r] = findFileReferences("src/a.ts:12");
    expect(r!.path).toBe("src/a.ts");
    expect(r!.line).toBe(12);
  });

  test("quotes around a path are excluded", () => {
    expect(paths(`opened "src/a.ts" ok`)).toEqual(["src/a.ts"]);
    expect(paths("opened 'src/a.ts' ok")).toEqual(["src/a.ts"]);
  });
});

describe("offsets", () => {
  test("start and end bracket exactly the reference", () => {
    const text = "edited src/a.ts:12:3 today";
    const [r] = findFileReferences(text);
    expect(text.slice(r!.start, r!.end)).toBe("src/a.ts:12:3");
  });

  test("offsets are correct for the second match too", () => {
    const text = "a src/one.ts b src/two.ts:9 c";
    const refs = findFileReferences(text);
    expect(text.slice(refs[0]!.start, refs[0]!.end)).toBe("src/one.ts");
    expect(text.slice(refs[1]!.start, refs[1]!.end)).toBe("src/two.ts:9");
  });

  test("a reference at the very start of the line", () => {
    const text = "src/a.ts:1 changed";
    const [r] = findFileReferences(text);
    expect(r!.start).toBe(0);
    expect(text.slice(r!.start, r!.end)).toBe("src/a.ts:1");
  });
});

describe("isAbsoluteish", () => {
  test("absolute and home paths stand alone", () => {
    expect(isAbsoluteish("/etc/hosts")).toBe(true);
    expect(isAbsoluteish("~/.zshrc")).toBe(true);
  });

  test("relative paths need a cwd", () => {
    expect(isAbsoluteish("src/a.ts")).toBe(false);
    expect(isAbsoluteish("./src/a.ts")).toBe(false);
  });
});

describe("robustness", () => {
  test("empty and whitespace input", () => {
    expect(findFileReferences("")).toEqual([]);
    expect(findFileReferences("   \t  ")).toEqual([]);
  });

  test("a very long line does not hang", () => {
    const text = "word ".repeat(5000) + "src/a.ts:1";
    const refs = findFileReferences(text);
    expect(refs.at(-1)!.path).toBe("src/a.ts");
  });

  test("repeated scans are independent (no lastIndex leak)", () => {
    // The regex is module-level and global; forgetting to reset
    // lastIndex makes the second call skip the start of the string.
    const text = "src/a.ts:1";
    expect(paths(text)).toEqual(["src/a.ts"]);
    expect(paths(text)).toEqual(["src/a.ts"]);
  });
});
