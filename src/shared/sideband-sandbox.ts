/**
 * Shared sideband HTML/SVG sandbox — used by BOTH the web mirror
 * (`src/web-client/panel-renderers.ts`) and the native webview
 * (`src/views/terminal/content-renderers.ts`, `panel.ts`).
 *
 * Sideband producers ship raw `html`/`svg` markup over fd 4. Rendering it
 * with `innerHTML` runs any embedded `<script>` / `onerror=` handler in
 * the host page's origin. On the web mirror (C2) that origin holds the
 * auth token + a live WebSocket; on the native webview (H4 —
 * full_app_review_2026-05.md §7.2) it holds the **Electrobun RPC bridge**,
 * which is strictly more powerful — injected script could drive the whole
 * RPC surface. The web mirror was sandboxed for C2 but the higher-
 * privilege native sink was left as a raw `innerHTML`.
 *
 * This module is the single sandbox implementation both surfaces share, so
 * the boundary can't drift. Display-only markup renders inside a
 * `<iframe sandbox>` (no `allow-scripts`, no `allow-same-origin`) carrying
 * a strict CSP — three independent defenses:
 *
 *   1. `<iframe sandbox="">` — the browser refuses to run script and
 *      refuses to read cookies / localStorage / the parent origin.
 *   2. `<meta http-equiv="Content-Security-Policy">` with `script-src
 *      'none'` / `default-src 'none'` — a second line of defence if a
 *      future browser bug weakens the sandbox.
 *   3. `script-src 'none'` blocks `<script>` even if the sandbox somehow
 *      allowed it.
 *
 * Inline styles are permitted (`style-src 'unsafe-inline'`) because
 * sideband producers ship presentation-heavy markup and inline styles
 * can't pivot to code execution; `img-src data: blob:` covers inline
 * sparklines / icons.
 *
 * NB: an iframe intercepts pointer events, so this path cannot forward DOM
 * events back to an *interactive* panel. Callers that need interactivity
 * must opt into the explicit, documented direct-DOM trust boundary instead
 * (see `renderSidebandMarkup` callers) — that path is unchanged.
 *
 * DOM-touching but framework-free; never import from the bun main process.
 */

export const SIDEBAND_HTML_CSP =
  "default-src 'none'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data: blob:; " +
  "script-src 'none'; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "frame-ancestors 'none';";

/** Wrap raw sideband markup in a strict-CSP shell for an iframe srcdoc. */
export function wrapInSandboxedShell(
  body: string,
  contentType: "html" | "svg",
): string {
  // Deliberately no <!doctype>: an iframe srcdoc renders in quirks mode
  // without one and modern CSS works either way; a minimal shell also
  // avoids nesting a producer's own <html>/<head> structure.
  const bodyMarkup =
    contentType === "svg"
      ? // Wrap raw SVG in a <body> so the iframe sizes correctly.
        `<body style="margin:0;padding:0;background:transparent">${body}</body>`
      : body;
  return (
    `<meta http-equiv="Content-Security-Policy" content="${SIDEBAND_HTML_CSP}">` +
    `<meta charset="utf-8">` +
    bodyMarkup
  );
}

/** Create-or-reuse the sandbox iframe inside `contentEl`. The reuse path
 *  matters — every frame of a streaming panel ships a fresh payload, and
 *  tearing the iframe down each time would burn cycles and lose scroll
 *  position. */
export function ensureSandboxIframe(contentEl: HTMLElement): HTMLIFrameElement {
  const existing = contentEl.querySelector(
    "iframe.sideband-sandbox",
  ) as HTMLIFrameElement | null;
  if (existing) return existing;
  contentEl.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.className = "sideband-sandbox";
  // Empty sandbox = most restrictive: no scripts, no same-origin, no
  // top-nav, no forms, no popups. We deliberately add NEITHER
  // `allow-scripts` (defeats the point) NOR `allow-same-origin` (would let
  // the frame read the parent's cookies / localStorage).
  iframe.setAttribute("sandbox", "");
  iframe.style.cssText =
    "width:100%;height:100%;border:0;background:transparent;display:block";
  iframe.setAttribute("aria-label", "Sideband panel content");
  contentEl.appendChild(iframe);
  return iframe;
}

/** The single html/svg sink: render already-decoded markup into the
 *  sandboxed iframe inside `contentEl`. */
export function renderSandboxedMarkup(
  contentEl: HTMLElement,
  markup: string,
  kind: "html" | "svg",
): void {
  const iframe = ensureSandboxIframe(contentEl);
  iframe.srcdoc = wrapInSandboxedShell(markup, kind);
}
