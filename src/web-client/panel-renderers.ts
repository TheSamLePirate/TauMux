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

/** Replace (or update) a blob-URL image inside `contentEl`. Covers
 *  `<meta type="image" format="png|jpeg|…">` + binary bytes. */
export const renderImage: PanelRenderer = (contentEl, data, meta, isBinary) => {
  const format = (meta["format"] as string | undefined) ?? "png";
  const mime = IMAGE_MIME_BY_FORMAT[format] ?? "image/png";
  const bytes = decodeB64(data, isBinary);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const img = contentEl.querySelector("img") as HTMLImageElement | null;
  if (img) {
    img.src = url;
  } else {
    contentEl.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:contain">`;
  }
};

export const renderSvg: PanelRenderer = (contentEl, data, _meta, isBinary) => {
  contentEl.innerHTML = decodeB64Text(data, isBinary);
};

export const renderHtml: PanelRenderer = (contentEl, data, _meta, isBinary) => {
  contentEl.innerHTML = decodeB64Text(data, isBinary);
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
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" });
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
