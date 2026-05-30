// H4 (full_app_review_2026-05.md §7.2) — the NATIVE webview html/svg
// sink. The native webview holds the Electrobun RPC bridge, so a sideband
// producer that could `innerHTML` raw markup here got full-privilege
// script execution. Display-only markup now renders inside the shared
// sandboxed iframe; only an opt-in `interactive` panel keeps the direct
// path (it needs DOM event forwarding). These tests pin both branches and
// the shared shell contract.

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

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function findIframe(el: HTMLElement): HTMLIFrameElement | null {
  return el.querySelector("iframe.sideband-sandbox");
}

// ── Shared shell contract ─────────────────────────────────────

describe("shared sideband-sandbox shell", () => {
  test("wrapInSandboxedShell embeds a strict CSP with script-src none", async () => {
    const { wrapInSandboxedShell, SIDEBAND_HTML_CSP } =
      await import("../src/shared/sideband-sandbox");
    const shell = wrapInSandboxedShell("<b>hi</b>", "html");
    expect(shell).toContain("Content-Security-Policy");
    expect(shell).toContain(SIDEBAND_HTML_CSP);
    expect(SIDEBAND_HTML_CSP).toContain("script-src 'none'");
    expect(SIDEBAND_HTML_CSP).toContain("default-src 'none'");
  });

  test("svg is wrapped in a sizing <body>", async () => {
    const { wrapInSandboxedShell } =
      await import("../src/shared/sideband-sandbox");
    expect(wrapInSandboxedShell("<svg/>", "svg")).toContain("<body");
  });

  test("renderSandboxedMarkup mounts a locked-down iframe, not raw innerHTML", async () => {
    const { renderSandboxedMarkup } =
      await import("../src/shared/sideband-sandbox");
    const el = document.createElement("div");
    const payload = `<img src=x onerror="window.__pwned=1">`;
    renderSandboxedMarkup(el, payload, "html");

    const iframe = findIframe(el);
    expect(iframe).not.toBeNull();
    // Most-restrictive sandbox: no allow-scripts, no allow-same-origin.
    expect(iframe!.getAttribute("sandbox")).toBe("");
    // The hostile <img> is NOT a live node in the host DOM — it lives only
    // inside the sandboxed iframe's srcdoc attribute string.
    expect(el.querySelector("img")).toBeNull();
    expect(iframe!.srcdoc).toContain("onerror");
  });

  test("the iframe is reused across frames (no teardown churn)", async () => {
    const { renderSandboxedMarkup } =
      await import("../src/shared/sideband-sandbox");
    const el = document.createElement("div");
    renderSandboxedMarkup(el, "<b>1</b>", "html");
    const first = findIframe(el);
    renderSandboxedMarkup(el, "<b>2</b>", "html");
    expect(findIframe(el)).toBe(first);
    expect(el.querySelectorAll("iframe").length).toBe(1);
  });
});

// ── Native binary renderers (content-renderers.ts) ────────────

describe("native html/svg renderers", () => {
  async function renderers() {
    return await import("../src/views/terminal/content-renderers");
  }

  test("non-interactive html is sandboxed in an iframe", async () => {
    const { getRenderer } = await renderers();
    const el = document.createElement("div") as HTMLDivElement;
    const r = getRenderer("html")!;
    r.mount(el, bytes(`<img src=x onerror="alert(1)">`), {
      id: "p1",
      type: "html",
    } as never);
    const iframe = findIframe(el);
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("sandbox")).toBe("");
    expect(el.querySelector("img")).toBeNull();
  });

  test("non-interactive svg is sandboxed in an iframe", async () => {
    const { getRenderer } = await renderers();
    const el = document.createElement("div") as HTMLDivElement;
    getRenderer("svg")!.mount(el, bytes(`<svg onload="alert(1)"></svg>`), {
      id: "p2",
      type: "svg",
    } as never);
    const iframe = findIframe(el);
    expect(iframe).not.toBeNull();
    expect(el.querySelector("svg")).toBeNull();
  });

  test("an INTERACTIVE html panel keeps the direct DOM path (documented boundary)", async () => {
    const { getRenderer } = await renderers();
    const el = document.createElement("div") as HTMLDivElement;
    getRenderer("html")!.mount(el, bytes(`<button id="x">go</button>`), {
      id: "p3",
      type: "html",
      interactive: true,
    } as never);
    // Direct DOM so the panel's contentEl event listeners can forward
    // clicks; no sandbox iframe.
    expect(findIframe(el)).toBeNull();
    expect(el.querySelector("#x")).not.toBeNull();
  });
});

// ── Native inline `meta.data` panel sink (panel.ts) ───────────

describe("native Panel inline-data markup sink", () => {
  async function makePanel(meta: Record<string, unknown>) {
    const { Panel } = await import("../src/views/terminal/panel");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const panel = new Panel(meta as never, container, () => {});
    return { panel, container };
  }

  test("inline html (non-interactive) is sandboxed", async () => {
    const { container } = await makePanel({
      id: "ip1",
      type: "html",
      data: `<img src=x onerror="alert(1)">`,
    });
    const content = container.querySelector(".panel-content") as HTMLElement;
    expect(findIframe(content)).not.toBeNull();
    expect(content.querySelector("img")).toBeNull();
  });

  test("inline html (interactive) uses the direct documented path", async () => {
    const { container } = await makePanel({
      id: "ip2",
      type: "html",
      interactive: true,
      data: `<button id="b">x</button>`,
    });
    const content = container.querySelector(".panel-content") as HTMLElement;
    expect(findIframe(content)).toBeNull();
    expect(content.querySelector("#b")).not.toBeNull();
  });
});
