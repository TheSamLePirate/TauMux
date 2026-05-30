// Phase 4 / S2 / H.7 — mirror sandbox the sideband HTML / SVG payloads.
//
// Before this PR, panel-renderers.ts set `contentEl.innerHTML = payload`
// for both `html` and `svg` panels. Once a LAN peer authenticated,
// anything that could write to fd 4 of any pane could inject script
// running in the mirror page's origin — with access to the auth token,
// localStorage, and the live WebSocket. The iframe-sandbox shell adds
// three independent defenses (sandbox attribute, CSP meta, script-src
// none). These tests pin the contract.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = "";
});

async function load() {
  return await import("../src/web-client/panel-renderers");
}

function encodeB64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function findIframe(contentEl: HTMLElement): HTMLIFrameElement {
  const f = contentEl.querySelector(
    "iframe.sideband-sandbox",
  ) as HTMLIFrameElement | null;
  if (!f) throw new Error("no sandbox iframe rendered");
  return f;
}

describe("[S2/H.7] mirror sandbox — HTML payloads", () => {
  test("renders into an iframe.sideband-sandbox child, not innerHTML", async () => {
    const { renderHtml } = await load();
    const el = document.createElement("div");
    renderHtml(el, encodeB64("<p>hello</p>"), {});
    // Iframe must exist; raw HTML must NOT have been pasted into the
    // host element (the script tag is what we're guarding against).
    const iframe = findIframe(el);
    expect(iframe).toBeDefined();
    // The host element should contain only the iframe; the raw payload
    // must not have been written into innerHTML.
    expect(el.children.length).toBe(1);
    expect(el.firstElementChild).toBe(iframe);
  });

  test('iframe carries `sandbox=""` (most restrictive)', async () => {
    const { renderHtml } = await load();
    const el = document.createElement("div");
    renderHtml(el, encodeB64("<p>x</p>"), {});
    const iframe = findIframe(el);
    // Empty sandbox attribute = no scripts, no same-origin, no top-nav,
    // no forms, no popups. The presence of the attribute is what matters
    // — a missing attribute = unsandboxed iframe.
    expect(iframe.hasAttribute("sandbox")).toBe(true);
    expect(iframe.getAttribute("sandbox")).toBe("");
  });

  test("srcdoc embeds a strict Content-Security-Policy meta tag", async () => {
    const { renderHtml } = await load();
    const el = document.createElement("div");
    renderHtml(el, encodeB64("<p>x</p>"), {});
    const iframe = findIframe(el);
    const src = iframe.srcdoc;
    expect(src).toContain('http-equiv="Content-Security-Policy"');
    // Must block scripts.
    expect(src).toContain("script-src 'none'");
    // Must default-deny everything.
    expect(src).toContain("default-src 'none'");
    // Must block plugin objects.
    expect(src).toContain("object-src 'none'");
    // Must prevent framing.
    expect(src).toContain("frame-ancestors 'none'");
  });

  test("does NOT allow scripts via the sandbox attribute", async () => {
    const { renderHtml } = await load();
    const el = document.createElement("div");
    renderHtml(el, encodeB64("<p>x</p>"), {});
    const iframe = findIframe(el);
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  test("the payload IS embedded inside the srcdoc (for legitimate content)", async () => {
    const { renderHtml } = await load();
    const el = document.createElement("div");
    const payload = "<p data-marker='legit-content-12345'>hi</p>";
    renderHtml(el, encodeB64(payload), {});
    const iframe = findIframe(el);
    expect(iframe.srcdoc).toContain("legit-content-12345");
  });

  test("a malicious <script> in the payload is in the srcdoc but blocked by the sandbox", async () => {
    // The sandbox attribute is the runtime defense. We can't test that
    // the script is *executed* (happy-dom doesn't run iframe srcdoc
    // scripts), but we can pin the conditions under which the browser
    // refuses to run it: sandbox attribute present without
    // allow-scripts, and CSP meta in the srcdoc.
    const { renderHtml } = await load();
    const el = document.createElement("div");
    const payload = "<script>window.parent.__pwned=true</script>";
    renderHtml(el, encodeB64(payload), {});
    const iframe = findIframe(el);
    // Yes — the bytes are in the srcdoc. The defense is the sandbox +
    // CSP, NOT escaping.
    expect(iframe.srcdoc).toContain("__pwned");
    // No — but the iframe doesn't have allow-scripts so the browser
    // refuses to run it. Pin the absence of the escape hatch.
    expect(iframe.getAttribute("sandbox")).toBe("");
  });

  test("re-rendering reuses the same iframe instance (perf)", async () => {
    const { renderHtml } = await load();
    const el = document.createElement("div");
    // Use distinct markers that don't overlap with CSP keywords (the
    // policy contains 'none', which would match a substring "one").
    renderHtml(el, encodeB64("<p data-rev='ALPHA'>first</p>"), {});
    const first = findIframe(el);
    renderHtml(el, encodeB64("<p data-rev='BRAVO'>second</p>"), {});
    const second = findIframe(el);
    expect(second).toBe(first);
    expect(second.srcdoc).toContain("BRAVO");
    expect(second.srcdoc).not.toContain("ALPHA");
  });
});

describe("[S2/H.7] mirror sandbox — SVG payloads", () => {
  test("renders into the same sandboxed iframe shell", async () => {
    const { renderSvg } = await load();
    const el = document.createElement("div");
    renderSvg(
      el,
      encodeB64('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
      {},
    );
    const iframe = findIframe(el);
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.srcdoc).toContain("Content-Security-Policy");
    expect(iframe.srcdoc).toContain("<svg");
  });

  test("the SVG is wrapped in a body so it sizes correctly", async () => {
    const { renderSvg } = await load();
    const el = document.createElement("div");
    renderSvg(el, encodeB64("<svg/>"), {});
    const iframe = findIframe(el);
    // The wrapper adds margin:0 + transparent background so the SVG
    // doesn't bleed into the iframe's default styling.
    expect(iframe.srcdoc).toContain("<body");
    expect(iframe.srcdoc).toContain("margin:0");
  });
});

// C2 (full_app_review_2026-05.md): the inline `meta.data` path in main.ts
// used to do `contentEl.innerHTML = meta.data`, a SECOND html/svg sink that
// bypassed the iframe sandbox entirely. It now routes through the shared
// `renderSandboxedMarkup` (the same shell renderHtml/renderSvg use). These
// tests pin that the inline sink is sandboxed too. `renderSandboxedMarkup`
// takes already-decoded raw markup (no base64), matching the inline path.
describe("[C2] inline meta.data sink routes through the sandbox", () => {
  test("renderSandboxedMarkup renders into the sandbox iframe, not innerHTML", async () => {
    const { renderSandboxedMarkup } = await load();
    const el = document.createElement("div");
    renderSandboxedMarkup(
      el,
      "<div class='inline-not-iframe'>hi</div>",
      "html",
    );
    const iframe = findIframe(el);
    expect(el.children.length).toBe(1);
    expect(el.firstElementChild).toBe(iframe);
    // Raw markup must NOT have been pasted into the host element.
    expect(el.querySelector(".inline-not-iframe")).toBeNull();
  });

  test("a malicious onerror/script in inline data is sandboxed, not live in the host", async () => {
    const { renderSandboxedMarkup } = await load();
    const el = document.createElement("div");
    const payload = "<img src=x onerror='window.parent.__pwned=true'>";
    renderSandboxedMarkup(el, payload, "html");
    const iframe = findIframe(el);
    // The bytes live inside the sandboxed srcdoc...
    expect(iframe.srcdoc).toContain("__pwned");
    // ...but no live <img> node was created in the mirror's own DOM, and
    // the sandbox attribute denies script execution.
    expect(el.querySelector("img")).toBeNull();
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.srcdoc).toContain("script-src 'none'");
  });

  test("renderHtml and the inline sink share one iframe shell", async () => {
    const { renderHtml, renderSandboxedMarkup } = await load();
    const elBinary = document.createElement("div");
    renderHtml(elBinary, encodeB64("<p>binary</p>"), {});
    const elInline = document.createElement("div");
    renderSandboxedMarkup(elInline, "<p>inline</p>", "html");
    // Both produce the same sandboxed-iframe structure (one sink).
    expect(findIframe(elBinary).getAttribute("sandbox")).toBe("");
    expect(findIframe(elInline).getAttribute("sandbox")).toBe("");
  });
});

describe("[S2/H.7] mirror sandbox — innerHTML escape hatch is gone", () => {
  test("renderHtml never writes raw payload to contentEl.innerHTML", async () => {
    const { renderHtml } = await load();
    const el = document.createElement("div");
    // Marker that would be a div with class="not-iframe" if innerHTML
    // injection happened.
    renderHtml(el, encodeB64('<div class="not-iframe">hi</div>'), {});
    expect(el.querySelector(".not-iframe")).toBeNull();
  });

  test("renderSvg never writes raw payload to contentEl.innerHTML", async () => {
    const { renderSvg } = await load();
    const el = document.createElement("div");
    renderSvg(el, encodeB64("<svg class='not-iframe-svg'/>"), {});
    expect(el.querySelector(".not-iframe-svg")).toBeNull();
  });
});
