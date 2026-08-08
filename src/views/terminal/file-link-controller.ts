/**
 * Where a clicked path in terminal output lands.
 *
 * Extracted out of `SurfaceManager` for the same reason the browser /
 * telegram / editor controllers were (full_app_review_2026-05.md §3,
 * H10): the manager is a baselined god module, and "click a path" is a
 * self-contained concern with its own state — a probe cache, a hover
 * card, and a memory of which file pane is current.
 *
 * The routing policy lives here, and it is the whole point of the
 * feature:
 *
 *   - a directory reveals itself in the sidebar tree rather than
 *     opening a pane that could only say "Path is not a file";
 *   - a file already open just focuses its pane and moves the cursor —
 *     no re-read, so scroll position and undo history survive;
 *   - otherwise the most recently used *clean* file pane is retargeted,
 *     so walking a six-frame stack trace stays in one pane instead of
 *     shredding the layout into six;
 *   - only when there is nothing safe to reuse does a new pane appear.
 *     ⌥-click forces that case explicitly.
 *
 * A pane with unsaved edits is never retargeted. Silently replacing
 * someone's unsaved buffer to save a split is not a trade worth making.
 */

import { htEvents } from "../../shared/event-bus";
import { isPreviewablePath } from "../../shared/file-kind";
import type { ProbedPath } from "../../shared/types";
import { revealPosition, type EditorPaneViewRef } from "./editor-pane";
import { FileLinkService } from "./file-link-service";
import { FileLinkTooltip } from "./file-link-tooltip";
import { installFileLinks, type FileLinkTarget } from "./terminal-links";
import { showToast } from "./toast";

/** The slice of a pane view this controller reads. Structural rather
 *  than importing `SurfaceView`, which would re-couple the two modules. */
export interface FileLinkSurface {
  id: string;
  surfaceType: string;
  editorView?: EditorPaneViewRef | null;
}

/** Sends a `probeFilePaths` request over the RPC bridge. Null-safe at
 *  the call site: before index.ts injects one, links stay inert. */
export type FileLinkProbeSender = (request: {
  requestId: string;
  paths: string[];
  cwd?: string;
  thumbnails?: boolean;
}) => void;

export interface FileLinkControllerDeps {
  /** Surface ids of the active workspace, in creation order. */
  activeSurfaceIds: () => Iterable<string> | null;
  getSurface: (id: string) => FileLinkSurface | undefined;
  focusSurface: (id: string) => void;
  /** The pane's live cwd, for resolving relative references. */
  getCwd: (surfaceId: string) => string | undefined;
  /** Expand the sidebar file explorer to a directory. False when no
   *  workspace root contains it. */
  revealInSidebar: (path: string) => boolean;
}

export class FileLinkController {
  private service: FileLinkService;
  private tooltip: FileLinkTooltip;
  /** Last file pane the user touched — the retarget candidate. */
  private lastEditorSurfaceId: string | null = null;

  /** Set until index.ts wires the RPC bridge. A probe with no sender
   *  resolves to "missing", so links are simply inert before then —
   *  the correct degradation for a terminal that is already usable. */
  private sendProbe: FileLinkProbeSender = () => {};

  constructor(private deps: FileLinkControllerDeps) {
    this.service = new FileLinkService((request) => this.sendProbe(request));
    this.tooltip = new FileLinkTooltip({
      thumbnail: (path) => this.service.thumbnail(path),
    });
  }

  /** Wire the RPC bridge (index.ts, once). */
  setProbeSender(send: FileLinkProbeSender): void {
    this.sendProbe = send;
  }

  /** Install the link provider on a freshly created terminal. */
  attach(
    term: Parameters<typeof installFileLinks>[0],
    surfaceId: string,
  ): void {
    installFileLinks(term, {
      getCwd: () => this.deps.getCwd(surfaceId),
      probe: (paths, cwd) => this.service.probe(paths, cwd),
      open: (target) => this.open(target),
      hover: (target, event) =>
        this.tooltip.show(
          target.probed,
          { line: target.line, column: target.column },
          event,
        ),
      leave: () => this.tooltip.hide(),
    });
  }

  /** Answers from `webview.messages.filePathsProbed`. */
  applyProbeResult(payload: {
    requestId: string;
    entries: ProbedPath[];
  }): void {
    this.service.applyResult(payload);
  }

  /** Remember the current file pane so a click retargets the one the
   *  user was last looking at. */
  noteFocus(surfaceId: string, surfaceType: string): void {
    if (surfaceType === "editor") this.lastEditorSurfaceId = surfaceId;
  }

  open(target: FileLinkTarget): void {
    this.tooltip.hide();

    if (target.probed.type === "directory") {
      if (!this.deps.revealInSidebar(target.path)) {
        showToast(`${target.path} is outside the workspace folders`, "info");
      }
      return;
    }

    // ⌘-click on an HTML file means "show me the page", not "show me
    // the markup". Anything else ignores the modifier — there is no
    // sensible browser reading of a `.ts` file.
    if (target.preferBrowser && isPreviewablePath(target.path)) {
      htEvents.emit("ht-open-file-in-browser", { path: target.path });
      return;
    }

    const line = target.line ?? null;
    const column = target.column ?? null;

    if (!target.forceNewPane) {
      const open = this.find((v) => v.editorView?.path === target.path);
      if (open) {
        this.deps.focusSurface(open.id);
        if (line !== null && open.editorView) {
          revealPosition(open.editorView, line, column);
        }
        return;
      }

      const reusable = this.pickReusable();
      if (reusable) {
        this.deps.focusSurface(reusable.id);
        htEvents.emit("ht-editor-read-file", {
          surfaceId: reusable.id,
          path: target.path,
          line,
          column,
        });
        return;
      }
    }

    htEvents.emit("ht-open-file-in-editor", {
      path: target.path,
      line,
      column,
    });
  }

  /** First editor pane in the active workspace matching `predicate`. */
  private find(
    predicate: (view: FileLinkSurface) => boolean,
  ): FileLinkSurface | null {
    const ids = this.deps.activeSurfaceIds();
    if (!ids) return null;
    for (const id of ids) {
      const view = this.deps.getSurface(id);
      if (view?.surfaceType === "editor" && predicate(view)) return view;
    }
    return null;
  }

  /**
   * The pane a new file should load into, or null to split.
   *
   * Prefers the last one focused; falls back to any clean pane in the
   * workspace so the first click after a layout restore still reuses.
   */
  private pickReusable(): FileLinkSurface | null {
    const isClean = (v: FileLinkSurface): boolean =>
      v.surfaceType === "editor" && v.editorView?.dirty !== true;
    const last = this.lastEditorSurfaceId
      ? this.deps.getSurface(this.lastEditorSurfaceId)
      : undefined;
    if (last && isClean(last) && this.isActive(last.id)) return last;
    return this.find(isClean);
  }

  private isActive(id: string): boolean {
    const ids = this.deps.activeSurfaceIds();
    if (!ids) return false;
    for (const candidate of ids) if (candidate === id) return true;
    return false;
  }
}
