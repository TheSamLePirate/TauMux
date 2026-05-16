// Phase 3 Step 4 — Browser pane tests.
//
// browser-pane.ts depends on Electrobun's `<electrobun-webview>` custom
// element for the OOPIF — happy-dom can't simulate that, so we focus
// the runtime tests on the pure helpers (`isUrl`, `normalizeUrl`,
// `buildSearchUrl`) and pin the construction invariants via
// source-grep. Same pragmatic line Phase 0 used for runtime-impractical
// code paths.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "views", "terminal", "browser-pane.ts"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

import {
  isUrl,
  normalizeUrl,
  buildSearchUrl,
} from "../src/views/terminal/browser-pane";

describe("browser-pane — isUrl", () => {
  it("recognises explicit http / https URLs", () => {
    expect(isUrl("http://example.com")).toBe(true);
    expect(isUrl("https://example.com/path")).toBe(true);
    expect(isUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("recognises localhost / 127.0.0.1 / ::1", () => {
    expect(isUrl("localhost")).toBe(true);
    expect(isUrl("localhost:3000")).toBe(true);
    expect(isUrl("localhost:3000/api")).toBe(true);
    expect(isUrl("127.0.0.1")).toBe(true);
    expect(isUrl("127.0.0.1:8080/foo")).toBe(true);
    expect(isUrl("::1")).toBe(true);
  });

  it("recognises domain-like strings with a dot", () => {
    expect(isUrl("example.com")).toBe(true);
    expect(isUrl("foo.bar.baz")).toBe(true);
    expect(isUrl("example.com/path")).toBe(true);
  });

  it("rejects search queries (no dot, no whitespace)", () => {
    expect(isUrl("how to type a url")).toBe(false);
    expect(isUrl("javascript closures")).toBe(false);
    expect(isUrl("typescript")).toBe(false);
  });

  it("rejects domain-like strings that contain whitespace", () => {
    // A space-containing string with a dot is more likely a query
    // about a hostname ("compare foo.com with bar.com") than a URL.
    expect(isUrl("compare foo.com")).toBe(false);
  });
});

describe("browser-pane — normalizeUrl", () => {
  it("passes http / https through unchanged", () => {
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeUrl("https://example.com/p")).toBe("https://example.com/p");
  });

  it("prefixes localhost / 127 / ::1 with http (not https)", () => {
    // Local dev servers default to plain HTTP. Forcing HTTPS would
    // break the most common dev workflow.
    expect(normalizeUrl("localhost")).toBe("http://localhost");
    expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(normalizeUrl("::1:1234")).toBe("http://::1:1234");
  });

  it("prefixes any other domain with https", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("foo.bar.baz/p")).toBe("https://foo.bar.baz/p");
  });
});

describe("browser-pane — buildSearchUrl", () => {
  it("URL-encodes the query", () => {
    const url = buildSearchUrl("hello world");
    expect(url).toContain("hello%20world");
  });

  it("falls back to google for an unknown engine", () => {
    const url = buildSearchUrl("foo", "made-up-engine");
    expect(url).toContain("google");
    expect(url).toContain("foo");
  });

  it("default engine is google when omitted", () => {
    const url = buildSearchUrl("foo");
    expect(url).toContain("google");
  });

  it("encodes ampersands and equals safely", () => {
    const url = buildSearchUrl("a=1&b=2");
    expect(url).toContain("a%3D1%26b%3D2");
  });
});

// ---------------------------------------------------------------------------
// Source-level invariants (the construction path needs <electrobun-webview>
// which happy-dom doesn't provide; pin the shape of `createBrowserPaneView`
// instead).
// ---------------------------------------------------------------------------

describe("[Phase 3] browser-pane — construction invariants (source-grep)", () => {
  it("exports the full lifecycle surface", () => {
    for (const fn of [
      "createBrowserPaneView",
      "destroyBrowserPaneView",
      "browserPaneNavigateTo",
      "browserPaneGoBack",
      "browserPaneGoForward",
      "browserPaneReload",
      "browserPaneEvalJs",
      "browserPaneFindInPage",
      "browserPaneStopFind",
      "browserPaneToggleDevTools",
    ]) {
      expect(SRC).toMatch(new RegExp(`export\\s+function\\s+${fn}\\b`));
    }
  });

  it("the BrowserPaneView shape carries the address bar + nav buttons + lock", () => {
    const iface = SRC.match(/export interface BrowserPaneView \{[\s\S]*?\n\}/);
    expect(iface).not.toBeNull();
    const body = iface![0];
    for (const field of [
      "addressBar: HTMLInputElement",
      "backBtn: HTMLButtonElement",
      "forwardBtn: HTMLButtonElement",
      "reloadBtn: HTMLButtonElement",
      "lockIcon: HTMLSpanElement",
      "webviewEl",
      "currentUrl: string",
      "isLoading: boolean",
    ]) {
      expect(body).toContain(field);
    }
  });

  it("the BrowserPaneCallbacks shape exposes onNavigated + onConsoleLog + onError", () => {
    const iface = SRC.match(
      /export interface BrowserPaneCallbacks \{[\s\S]*?\n\}/,
    );
    expect(iface).not.toBeNull();
    const body = iface![0];
    expect(body).toContain("onNavigated:");
    expect(body).toContain("onConsoleLog?:");
    expect(body).toContain("onError?:");
    expect(body).toContain("onTitleChanged:");
  });

  it("ships the console-capture preload that wires console.* + global error", () => {
    expect(SRC).toMatch(
      /CONSOLE_CAPTURE_PRELOAD\s*=\s*`[\s\S]*console\[l\]\s*=/,
    );
    expect(SRC).toContain('addEventListener("error"');
    expect(SRC).toContain('addEventListener("unhandledrejection"');
  });
});
