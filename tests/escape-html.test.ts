// Triple-A F.3 / A13 — verify the single source of truth escapeHtml helper.
// Backfill from Phase 0 audit (PR 13). The fix lives in src/shared/escape-html.ts;
// previously it was duplicated across sidebar / plan-panel-render / design-report.

import { describe, it, expect } from "bun:test";
import { escapeHtml } from "../src/shared/escape-html";

describe("[A13] escapeHtml", () => {
  it("escapes the five XML-significant characters", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml('attr="x"')).toBe("attr=&quot;x&quot;");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("orders & first so it doesn't double-encode escaped output", () => {
    // If `&` were replaced after the others, `<` → `&lt;` → `&amp;lt;`
    // would corrupt every escape. This is the regression we're guarding.
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("<&")).toBe("&lt;&amp;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("returns the input unchanged when nothing needs escaping", () => {
    expect(escapeHtml("")).toBe("");
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });

  it("handles strings containing all five characters at once", () => {
    expect(escapeHtml(`<a href="x">it's & done</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; done&lt;/a&gt;",
    );
  });
});
