/**
 * Web-mirror panel renderer registry.
 *
 * Before this module existed, ~70 lines at the bottom of
 * src/web-client/main.ts defined a tiny registry-of-content-type →
 * renderer functions and hard-coded four renderers (image, svg, html,
 * canvas2d) inline inside the boot closure.
 *
 * Moving it out does two things:
 *   1. Each renderer becomes a named top-level function, which is
 *      diff-friendly and unit-testable.
 *   2. `registerWebRenderer` + the default registry is available as
 *      a stable surface for future plugins / user-added renderers
 *      without touching the boot closure.
 *
 * Renderers are stateless: given a content element, the binary or
 * base64 payload, the metadata record, and a flag for which format
 * the payload is in, they mutate the content element. They never
 * reach back into the store.
 */

export type PanelRenderer = (
  contentEl: HTMLElement,
  data: unknown,
  meta: Record<string, unknown>,
  isBinary?: boolean,
) => void;

/** base64 (string) or raw Uint8Array → bytes. */
export function decodeB64(data: unknown, isBinary?: boolean): Uint8Array {
  if (isBinary) return data as Uint8Array;
  const binary = atob(data as string);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** base64 (string) or Uint8Array carrying UTF-8 → string. */
export function decodeB64Text(data: unknown, isBinary?: boolean): string {
  if (isBinary) return new TextDecoder().decode(data as Uint8Array);
  return atob(data as string);
}

const IMAGE_MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

// Blob URLs created for a panel's content element. At ~30 fps the webcam
// demo burns through ~1800 URLs/minute; without explicit revocation the
// browser holds onto the backing blobs until the page unloads. Tracked
// per contentEl so the main boot closure can revoke on panel teardown.
const panelBlobUrls = new WeakMap<HTMLElement, string>();

function swapPanelBlobUrl(el: HTMLElement, next: string): void {
  const prev = panelBlobUrls.get(el);
  panelBlobUrls.set(el, next);
  if (prev) URL.revokeObjectURL(prev);
}

/** Revoke the blob URL currently associated with a panel's content
 *  element. Safe to call on panels that never created one. */
export function releasePanelBlobUrl(el: HTMLElement): void {
  const prev = panelBlobUrls.get(el);
  if (prev) {
    URL.revokeObjectURL(prev);
    panelBlobUrls.delete(el);
  }
}

/** Replace (or update) a blob-URL image inside `contentEl`. Covers
 *  `<meta type="image" format="png|jpeg|…">` + binary bytes. */
export const renderImage: PanelRenderer = (contentEl, data, meta, isBinary) => {
  const format = (meta["format"] as string | undefined) ?? "png";
  const mime = IMAGE_MIME_BY_FORMAT[format] ?? "image/png";
  const bytes = decodeB64(data, isBinary);
  // Pass the typed-array view, not `bytes.buffer` — for binary frames the
  // underlying ArrayBuffer is the full WebSocket frame (size prefix +
  // JSON header + payload), and `subarray` only narrows the view, not the
  // buffer. Blob([TypedArray]) respects byteOffset/byteLength; Blob
  // ([ArrayBuffer]) does not.
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  const url = URL.createObjectURL(blob);
  swapPanelBlobUrl(contentEl, url);
  const img = contentEl.querySelector("img") as HTMLImageElement | null;
  if (img) {
    img.src = url;
  } else {
    contentEl.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:contain">`;
  }
};

/**
 * Wrap sideband HTML/SVG in a strict-CSP HTML shell so the iframe srcdoc
 * never inherits the mirror page's privileges (Triple-A S2 / H.7).
 *
 * Before this module's mirror-side sandboxing, `renderHtml` / `renderSvg`
 * set `contentEl.innerHTML = payload` directly. Once a LAN peer
 * authenticated, anything that could write to fd 4 of any pane (a
 * careless `curl|sh`, a npm postinstall, a Homebrew formula) could
 * inject script that ran in the mirror page's origin — with access to
 * the auth token, localStorage, and the live WebSocket.
 *
 * The shell carries three independent defenses:
 *
 *   1. `<iframe sandbox>` (no `allow-scripts`, no `allow-same-origin`)
 *      — the browser refuses to run script and refuses to read cookies
 *      / localStorage / the parent origin.
 *   2. `<meta http-equiv="Content-Security-Policy" content="…">` —
 *      `script-src 'none'`, `default-src 'none'`. A second line of
 *      defence in case a future browser bug weakens the sandbox.
 *   3. `script-src 'none'` blocks `<script>` even if the sandbox
 *      somehow allowed it.
 *
 * Inline styles are intentionally permitted (`style-src 'unsafe-inline'`)
 * because sideband producers ship presentation-heavy markup; inline
 * styles can't pivot to code execution. `img-src data: blob:` is
 * needed for sparklines / icons producers ship in-line.
 */
const SIDEBAND_HTML_CSP =
  "default-src 'none'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data: blob:; " +
  "script-src 'none'; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "frame-ancestors 'none';";

function wrapInSandboxedShell(
  body: string,
  contentType: "html" | "svg",
): string {
  // The shell deliberately omits a <!doctype>: an iframe srcdoc renders
  // in quirks mode without one, and modern CSS works either way. Keeping
  // the shell minimal also means a sideband producer that ships its own
  // `<html>` / `<head>` won't end up with a nested structure that
  // browsers render quirkily.
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

/** Create-or-reuse the sandbox iframe inside `contentEl`. The reuse
 *  path is important — every frame of a 30 fps stream creates a fresh
 *  payload, and tearing the iframe down on each one would burn cycles
 *  and lose any scroll position the panel maintained. */
function ensureSandboxIframe(contentEl: HTMLElement): HTMLIFrameElement {
  let iframe = contentEl.querySelector(
    "iframe.sideband-sandbox",
  ) as HTMLIFrameElement | null;
  if (iframe) return iframe;
  contentEl.innerHTML = "";
  iframe = document.createElement("iframe");
  iframe.className = "sideband-sandbox";
  // Empty sandbox attribute = most restrictive: no scripts, no
  // same-origin, no top-nav, no forms, no popups. We DO NOT add
  // `allow-scripts` because that defeats the entire point. We DO NOT
  // add `allow-same-origin` because that lets the iframe read the
  // parent's cookies / localStorage via document.cookie.
  iframe.setAttribute("sandbox", "");
  iframe.style.cssText =
    "width:100%;height:100%;border:0;background:transparent;display:block";
  iframe.setAttribute("aria-label", "Sideband panel content");
  contentEl.appendChild(iframe);
  return iframe;
}

export const renderSvg: PanelRenderer = (contentEl, data, _meta, isBinary) => {
  const payload = decodeB64Text(data, isBinary);
  const iframe = ensureSandboxIframe(contentEl);
  iframe.srcdoc = wrapInSandboxedShell(payload, "svg");
};

export const renderHtml: PanelRenderer = (contentEl, data, _meta, isBinary) => {
  const payload = decodeB64Text(data, isBinary);
  const iframe = ensureSandboxIframe(contentEl);
  iframe.srcdoc = wrapInSandboxedShell(payload, "html");
};

/** Render a PNG-encoded canvas frame into a <canvas> element inside
 *  `contentEl`. Reuses an existing canvas when dimensions match so
 *  repeated frames don't thrash the DOM. */
export const renderCanvas2d: PanelRenderer = (
  contentEl,
  data,
  _meta,
  isBinary,
) => {
  const bytes = decodeB64(data, isBinary);
  let canvas = contentEl.querySelector("canvas") as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement("canvas");
    contentEl.innerHTML = "";
    contentEl.appendChild(canvas);
  }
  // Same reasoning as renderImage: feed the TypedArray view, not the
  // underlying ArrayBuffer.
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: "image/png",
  });
  void createImageBitmap(blob).then((bitmap) => {
    if (canvas!.width !== bitmap.width) canvas!.width = bitmap.width;
    if (canvas!.height !== bitmap.height) canvas!.height = bitmap.height;
    canvas!.getContext("2d")!.drawImage(bitmap, 0, 0);
  });
};

/** Create a fresh registry pre-populated with the four built-in
 *  renderers. Callers can append more with the returned `register`
 *  function before or after boot. */
export function createPanelRendererRegistry(): {
  register: (type: string, fn: PanelRenderer) => void;
  get: (type: string) => PanelRenderer | undefined;
} {
  const renderers: Record<string, PanelRenderer> = {
    image: renderImage,
    svg: renderSvg,
    html: renderHtml,
    canvas2d: renderCanvas2d,
  };
  return {
    register: (type, fn) => {
      renderers[type] = fn;
    },
    get: (type) => renderers[type],
  };
}
