// Plan #05 commit A — pure-function coverage for the shareBin lib
// modules. Each lib renders user content (markdown / JSON / diff)
// to HTML; the tests pin the safety story (HTML escape) and the
// shape of the output so future agents can rely on stable classes
// for stylesheets.

import { describe, expect, test } from "bun:test";
import { escapeAttr, escapeHtml } from "../shareBin/lib/escape";
import { renderInline, renderMarkdown } from "../shareBin/lib/markdown";
import { renderJsonTree } from "../shareBin/lib/json-tree";
import { renderUnifiedDiff } from "../shareBin/lib/diff-render";

// ── escape ────────────────────────────────────────────────────

describe("escapeHtml", () => {
  test("rewrites the five canonical entities", () => {
    expect(escapeHtml(`<a href="x">A's & B</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;A&#39;s &amp; B&lt;/a&gt;",
    );
  });

  test("amp encoding runs first so & doesn't double-encode", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  test("preserves whitespace", () => {
    expect(escapeHtml("  a\nb\tc  ")).toBe("  a\nb\tc  ");
  });
});

describe("escapeAttr", () => {
  test("stringifies non-string inputs", () => {
    expect(escapeAttr(42)).toBe("42");
    expect(escapeAttr(null)).toBe("");
    expect(escapeAttr(undefined)).toBe("");
    expect(escapeAttr(true)).toBe("true");
  });
});

// ── markdown ──────────────────────────────────────────────────

describe("renderMarkdown — block grammar", () => {
  test("headings h1..h4", () => {
    const out = renderMarkdown("# A\n\n## B\n\n### C\n\n#### D");
    expect(out).toContain("<h1>A</h1>");
    expect(out).toContain("<h2>B</h2>");
    expect(out).toContain("<h3>C</h3>");
    expect(out).toContain("<h4>D</h4>");
  });

  test("paragraph wraps consecutive non-blank lines", () => {
    const out = renderMarkdown("first line\nsecond line\n\nnext para");
    expect(out).toContain("<p>first line<br>second line</p>");
    expect(out).toContain("<p>next para</p>");
  });

  test("fenced code blocks preserve whitespace + escape HTML", () => {
    const out = renderMarkdown("```ts\nconst x = '<bad>';\n```");
    expect(out).toContain('<pre><code class="language-ts">');
    expect(out).toContain("const x = &#39;&lt;bad&gt;&#39;;");
    expect(out).toContain("</code></pre>");
  });

  test("unordered list", () => {
    const out = renderMarkdown("- one\n- two\n- three");
    expect(out).toContain("<ul><li>one</li><li>two</li><li>three</li></ul>");
  });

  test("ordered list", () => {
    const out = renderMarkdown("1. first\n2. second");
    expect(out).toContain("<ol><li>first</li><li>second</li></ol>");
  });
});

describe("renderInline", () => {
  test("inline code escapes its contents", () => {
    expect(renderInline("see `<a>`")).toContain("<code>&lt;a&gt;</code>");
  });

  test("bold + italic", () => {
    const out = renderInline("**bold** and _italic_");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
  });

  test("http link renders as anchor with safe target / rel", () => {
    const out = renderInline("[click](https://example.com/x)");
    expect(out).toContain('<a href="https://example.com/x"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener"');
  });

  test("non-http link drops to plain text (XSS guard)", () => {
    // The contract is "no <a> tag emitted for non-http(s) URLs" —
    // the parser is permissive about residual punctuation when an
    // attacker stuffs unbalanced parens into the URL portion (e.g.
    // `javascript:alert(1)` produces label + a stray ")"); what
    // matters is that no clickable anchor lands in the output.
    const js = renderInline("[evil](javascript:alert(1))");
    expect(js).not.toContain("<a ");
    expect(js).toContain("evil");
    const fileUrl = renderInline("[file](file:///etc/passwd)");
    expect(fileUrl).not.toContain("<a ");
    expect(fileUrl).toContain("file");
  });

  test("backticks in inline code don't trip later passes", () => {
    // `**bold**` inside an inline-code span shouldn't render bold.
    const out = renderInline("look: `**not bold**`");
    expect(out).toContain("<code>**not bold**</code>");
    expect(out).not.toContain("<strong>");
  });

  test("bare HTML in input is escaped", () => {
    const out = renderInline("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });
});

// ── json-tree ─────────────────────────────────────────────────

describe("renderJsonTree", () => {
  test("primitives render with data-type attributes", () => {
    expect(renderJsonTree(42)).toContain('data-type="number"');
    expect(renderJsonTree("hi")).toContain('data-type="string"');
    expect(renderJsonTree(true)).toContain('data-type="boolean"');
    expect(renderJsonTree(null)).toContain('data-type="null"');
  });

  test("strings are HTML-escaped + wrapped in quotes", () => {
    const out = renderJsonTree('<bad> "quoted"');
    expect(out).toContain("&lt;bad&gt;");
    expect(out).toContain("&quot;quoted&quot;");
  });

  test("array renders as collapsible details with [N] summary", () => {
    const out = renderJsonTree([1, 2, 3]);
    expect(out).toContain('<details class="jt-array"');
    expect(out).toContain("[3]");
    expect(out).toContain("<summary>");
  });

  test("object renders with key labels", () => {
    const out = renderJsonTree({ a: 1, b: "two" });
    expect(out).toContain('class="jt-key">a</span>');
    expect(out).toContain('class="jt-key">b</span>');
    expect(out).toContain("{2}");
  });

  test("openDepth controls which containers start expanded", () => {
    const data = { outer: { inner: { leaf: 1 } } };
    const shallow = renderJsonTree(data, { openDepth: 0 });
    const deep = renderJsonTree(data, { openDepth: 5 });
    // Shallow: zero "open" attrs (every container is collapsed).
    expect(shallow.match(/details[^>]* open/g)).toBeNull();
    // Deep: at least one "open" attr.
    expect(deep.match(/details[^>]* open/g)?.length ?? 0).toBeGreaterThan(0);
  });

  test("rootLabel is applied to the top-level container", () => {
    const out = renderJsonTree([1], { rootLabel: "result" });
    expect(out).toContain("result");
  });

  test("deeply-nested cycles bottom out at the depth limit", () => {
    type Cyclic = { next?: Cyclic };
    const root: Cyclic = {};
    let cur = root;
    for (let i = 0; i < 200; i++) {
      cur.next = {};
      cur = cur.next!;
    }
    const out = renderJsonTree(root);
    expect(out).toContain("depth limit");
  });
});

// ── diff ──────────────────────────────────────────────────────

describe("renderUnifiedDiff", () => {
  const sample = `--- a/foo.ts
+++ b/foo.ts
@@ -1,4 +1,4 @@
 keep
-old line
+new line
 more keep
`;

  test('emits a side-by-side <table class="diff">', () => {
    const out = renderUnifiedDiff(sample);
    expect(out.startsWith('<table class="diff">')).toBe(true);
    expect(out).toContain("</table>");
  });

  test("pairs adjacent del + add into a single row", () => {
    const out = renderUnifiedDiff(sample);
    // The paired row has both "diff-del" on left and "diff-add" on right.
    expect(out).toMatch(
      /<td class="diff-del"><code>old line<\/code><\/td><td class="diff-add"><code>new line<\/code><\/td>/,
    );
  });

  test("context lines are duplicated on both sides", () => {
    const out = renderUnifiedDiff(sample);
    expect(out).toMatch(
      /<td class="diff-ctx"><code>keep<\/code><\/td><td class="diff-ctx"><code>keep<\/code><\/td>/,
    );
  });

  test("hunk + file headers span both columns", () => {
    const out = renderUnifiedDiff(sample);
    expect(out).toContain('<tr class="diff-sep">');
    expect(out).toContain("@@ -1,4 +1,4 @@");
    expect(out).toContain("--- a/foo.ts");
    expect(out).toContain("+++ b/foo.ts");
  });

  test("HTML escape applies to both sides", () => {
    const evilDiff = "@@ -1 +1 @@\n-<bad>\n+<worse>\n";
    const out = renderUnifiedDiff(evilDiff);
    expect(out).toContain("&lt;bad&gt;");
    expect(out).toContain("&lt;worse&gt;");
    expect(out).not.toContain("<bad>");
    expect(out).not.toContain("<worse>");
  });

  test("unpaired deletions render with a blank right side", () => {
    const onlyDel = "@@ -1,2 +1,1 @@\n keep\n-gone\n";
    const out = renderUnifiedDiff(onlyDel);
    expect(out).toMatch(
      /<td class="diff-del"><code>gone<\/code><\/td><td><code><\/code><\/td>/,
    );
  });

  test("unpaired additions render with a blank left side", () => {
    const onlyAdd = "@@ -1,1 +1,2 @@\n keep\n+new\n";
    const out = renderUnifiedDiff(onlyAdd);
    expect(out).toMatch(
      /<td><code><\/code><\/td><td class="diff-add"><code>new<\/code><\/td>/,
    );
  });
});
