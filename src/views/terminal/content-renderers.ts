import type { SidebandContentMessage } from "../../shared/types";
import type { IconName } from "./icons";

const decoder = new TextDecoder();

// === Content Renderer Interface ===

export interface ContentRenderer {
  /** Set up initial DOM content when panel first receives data */
  mount(
    contentEl: HTMLDivElement,
    data: Uint8Array,
    meta: SidebandContentMessage,
  ): void;

  /** Replace content on subsequent data updates */
  update(
    contentEl: HTMLDivElement,
    data: Uint8Array,
    meta: SidebandContentMessage,
  ): void;

  /** Cleanup when panel is removed (revoke blob URLs, stop animations, etc.) */
  destroy?(contentEl: HTMLDivElement): void;

  /** Icon name for the panel title bar */
  icon: IconName;

  /** CSS class suffix: added as "panel-type-{cssClass}" */
  cssClass: string;
}

// === Registry ===

const renderers = new Map<string, ContentRenderer>();

export function registerRenderer(
  type: string,
  renderer: ContentRenderer,
): void {
  renderers.set(type, renderer);
}

export function getRenderer(type: string): ContentRenderer | undefined {
  return renderers.get(type);
}

export function getRendererIcon(type: string): IconName {
  return renderers.get(type)?.icon ?? "sparkles";
}

export function getRendererCssClass(type: string): string | undefined {
  return renderers.get(type)?.cssClass;
}

// === Built-in Renderers ===

// Per-panel blob URL tracking (keyed by contentEl)
const blobUrls = new WeakMap<HTMLDivElement, string>();

function revokeBlobUrl(el: HTMLDivElement): void {
  const url = blobUrls.get(el);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(el);
  }
}

function setBlobUrl(el: HTMLDivElement, url: string): void {
  blobUrls.set(el, url);
}

// -- Image Renderer --

function renderImage(
  contentEl: HTMLDivElement,
  data: Uint8Array,
  meta: SidebandContentMessage,
): void {
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };
  const mime = mimeMap[meta.format ?? "png"] ?? "image/png";
  const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
  const newUrl = URL.createObjectURL(blob);
  const oldUrl = blobUrls.get(contentEl);
  setBlobUrl(contentEl, newUrl);

  // Reuse existing <img> element to avoid blank flash between frames
  let img = contentEl.querySelector("img");
  if (img) {
    img.src = newUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  } else {
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    img = document.createElement("img");
    img.src = newUrl;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";
    img.draggable = false;
    contentEl.innerHTML = "";
    contentEl.appendChild(img);
  }
}

registerRenderer("image", {
  icon: "eye",
  cssClass: "image",
  mount: renderImage,
  update: renderImage,
  destroy: revokeBlobUrl,
});

// -- SVG Renderer --

function renderSvg(contentEl: HTMLDivElement, data: Uint8Array): void {
  revokeBlobUrl(contentEl);
  contentEl.innerHTML = decoder.decode(data);
}

registerRenderer("svg", {
  icon: "globe",
  cssClass: "svg",
  mount: renderSvg,
  update: renderSvg,
  destroy: revokeBlobUrl,
});

// -- HTML Renderer --

function renderHtml(contentEl: HTMLDivElement, data: Uint8Array): void {
  revokeBlobUrl(contentEl);
  contentEl.innerHTML = decoder.decode(data);
}

registerRenderer("html", {
  icon: "window",
  cssClass: "html",
  mount: renderHtml,
  update: renderHtml,
  destroy: revokeBlobUrl,
});

// -- Canvas2D Renderer --
// Reuse the same <canvas> element across frames to avoid DOM churn
// and event listener disruption from innerHTML replacement.

function mountCanvas2d(contentEl: HTMLDivElement, data: Uint8Array): void {
  revokeBlobUrl(contentEl);
  const canvas = document.createElement("canvas");
  contentEl.innerHTML = "";
  contentEl.appendChild(canvas);
  drawToCanvas(canvas, data);
}

function updateCanvas2d(contentEl: HTMLDivElement, data: Uint8Array): void {
  let canvas = contentEl.querySelector("canvas");
  if (!canvas) {
    // Fallback: mount if canvas was removed
    canvas = document.createElement("canvas");
    contentEl.innerHTML = "";
    contentEl.appendChild(canvas);
  }
  drawToCanvas(canvas, data);
}

function drawToCanvas(canvas: HTMLCanvasElement, data: Uint8Array): void {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: "image/png" });
  createImageBitmap(blob).then((bitmap) => {
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(bitmap, 0, 0);
  });
}

registerRenderer("canvas2d", {
  icon: "chart",
  cssClass: "canvas",
  mount: mountCanvas2d,
  update: updateCanvas2d,
  destroy: revokeBlobUrl,
});
