/**
 * Hover card for a clickable path in terminal output.
 *
 * The failure this exists to prevent is silent and infuriating: a
 * relative path resolved against the wrong directory. `src/index.ts`
 * looks identical in every pane, and if the cwd is stale you open the
 * wrong file and never find out why. Showing the *resolved absolute
 * path* on hover makes that visible before the click rather than after.
 *
 * Everything else on the card — size, mtime, an image preview — is
 * there because we already paid for the stat, and because "is this the
 * screenshot I meant?" is answerable in one glance and not otherwise.
 *
 * Pure DOM, no framework, appended to `document.body` so pane overflow
 * and the terminal's own stacking context cannot clip it.
 */

import { isPreviewablePath } from "../../shared/file-kind";
import type { ProbedPath } from "../../shared/types";

/** Gap between the pointer and the card, so the card never sits under
 *  the cursor and re-triggers a leave. */
const POINTER_OFFSET_PX = 14;

/** Hover cards that appear instantly on a fast pointer sweep are
 *  noise. This is the dwell time before one is shown. */
const SHOW_DELAY_MS = 260;

const MAX_THUMB_PX = 220;

export interface FileLinkTooltipDeps {
  /** Full image bytes for the preview, or null. Called at most once per
   *  hover, and only for images. */
  thumbnail: (path: string) => Promise<string | null>;
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  const mins = Math.round(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function kindLabel(probed: ProbedPath): string {
  if (probed.type === "directory") return "folder";
  if (probed.contentKind === "image") {
    return probed.imageMime?.replace("image/", "") ?? "image";
  }
  if (probed.contentKind === "svg") return "svg";
  return "text";
}

export class FileLinkTooltip {
  private el: HTMLDivElement | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  /** Identifies the hover a pending thumbnail belongs to, so a slow
   *  read cannot paint an image into a card the pointer already left. */
  private token = 0;
  private scrollListener: (() => void) | null = null;

  constructor(private deps: FileLinkTooltipDeps) {}

  show(
    probed: ProbedPath,
    detail: { line: number | null; column: number | null },
    event: MouseEvent,
  ): void {
    this.cancelPending();
    const token = ++this.token;
    const { clientX, clientY } = event;
    this.showTimer = setTimeout(() => {
      if (token !== this.token) return;
      this.render(probed, detail, clientX, clientY, token);
    }, SHOW_DELAY_MS);
  }

  hide(): void {
    this.cancelPending();
    this.token++;
    this.el?.remove();
    this.el = null;
    if (this.scrollListener) {
      window.removeEventListener("scroll", this.scrollListener, true);
      this.scrollListener = null;
    }
  }

  destroy(): void {
    this.hide();
  }

  private cancelPending(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  private render(
    probed: ProbedPath,
    detail: { line: number | null; column: number | null },
    x: number,
    y: number,
    token: number,
  ): void {
    this.el?.remove();
    const el = document.createElement("div");
    el.className = "file-link-tooltip";
    el.setAttribute("role", "tooltip");

    const pathEl = document.createElement("div");
    pathEl.className = "file-link-tooltip-path";
    pathEl.textContent = probed.resolved;
    el.appendChild(pathEl);

    const metaEl = document.createElement("div");
    metaEl.className = "file-link-tooltip-meta";
    const parts: string[] = [kindLabel(probed)];
    if (probed.type === "file") parts.push(humanBytes(probed.size));
    if (probed.mtimeMs) parts.push(relativeTime(probed.mtimeMs));
    if (detail.line !== null) {
      parts.push(
        detail.column !== null
          ? `line ${detail.line}, col ${detail.column}`
          : `line ${detail.line}`,
      );
    }
    metaEl.textContent = parts.join(" · ");
    el.appendChild(metaEl);

    const hintEl = document.createElement("div");
    hintEl.className = "file-link-tooltip-hint";
    hintEl.textContent =
      probed.type === "directory"
        ? "Click to reveal in the sidebar"
        : isPreviewablePath(probed.resolved)
          ? "Click to edit · ⌘click to preview · ⌥click for a new pane"
          : "Click to open · ⌥click for a new pane";
    el.appendChild(hintEl);

    if (probed.contentKind === "image" && probed.type === "file") {
      const shell = document.createElement("div");
      shell.className = "file-link-tooltip-thumb";
      el.appendChild(shell);
      void this.deps
        .thumbnail(probed.resolved)
        .then((dataUri) => {
          // The pointer may have moved on while we were reading bytes.
          if (token !== this.token || !dataUri) {
            shell.remove();
            this.position(x, y);
            return;
          }
          const img = document.createElement("img");
          img.src = dataUri;
          img.alt = "";
          img.draggable = false;
          img.style.maxWidth = `${MAX_THUMB_PX}px`;
          img.style.maxHeight = `${MAX_THUMB_PX}px`;
          img.addEventListener("load", () => {
            if (token !== this.token) return;
            metaEl.textContent = `${parts.join(" · ")} · ${img.naturalWidth}×${img.naturalHeight}`;
            this.position(x, y);
          });
          shell.appendChild(img);
        })
        .catch(() => shell.remove());
    }

    document.body.appendChild(el);
    this.el = el;
    this.position(x, y);

    // Scrolling the terminal moves the row out from under the card.
    // Capture phase so xterm's own scroller is covered.
    this.scrollListener = () => this.hide();
    window.addEventListener("scroll", this.scrollListener, true);
  }

  /** Flip the card above / left of the pointer when it would otherwise
   *  run off-screen. Re-run whenever the content resizes (the thumbnail
   *  arriving is the usual cause). */
  private position(x: number, y: number): void {
    const el = this.el;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + POINTER_OFFSET_PX;
    if (left + rect.width > vw - 8) left = x - POINTER_OFFSET_PX - rect.width;
    if (left < 8) left = 8;

    let top = y + POINTER_OFFSET_PX;
    if (top + rect.height > vh - 8) top = y - POINTER_OFFSET_PX - rect.height;
    if (top < 8) top = 8;

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }
}
