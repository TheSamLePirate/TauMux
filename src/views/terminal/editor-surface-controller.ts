// EditorSurfaceController — the editor-pane concern extracted out of the
// SurfaceManager god object (full_app_review_2026-05.md §3, H10). Same
// controller pattern as Browser/Telegram.

import { htEvents } from "../../shared/event-bus";
import type { EditorFileSnapshot, EditorSaveResult } from "../../shared/types";
import {
  type EditorPaneViewRef,
  createEditorPaneView,
  editorPaneApplySnapshot,
  editorPaneApplySaveResult,
  saveEditor,
  reloadEditor,
  destroyEditorPaneView,
} from "./editor-pane";
import type { SurfaceView } from "./surface-manager";

export interface EditorControllerDeps {
  getSurface: (id: string) => SurfaceView | undefined;
  getFocusedSurfaceId: () => string | null;
  focusSurface: (id: string) => void;
  updateSidebar: () => void;
}

export class EditorSurfaceController {
  constructor(private deps: EditorControllerDeps) {}

  /** Create + wire an editor pane view. The caller attaches
   *  `view.container` to the DOM and wraps it in a SurfaceView. */
  createEditorView(surfaceId: string, path?: string): EditorPaneViewRef {
    const editorView = createEditorPaneView(surfaceId, path, {
      onRead: (sid, filePath, create) => {
        htEvents.emit("ht-editor-read-file", {
          surfaceId: sid,
          path: filePath,
          create,
        });
      },
      onSave: (sid, filePath, content, expectedMtimeMs) => {
        htEvents.emit("ht-editor-save-file", {
          surfaceId: sid,
          path: filePath,
          content,
          expectedMtimeMs,
        });
      },
      onReload: (sid, filePath) => {
        htEvents.emit("ht-editor-reload-file", {
          surfaceId: sid,
          path: filePath,
        });
      },
      onClose: (sid) => {
        htEvents.emit("ht-close-surface", { surfaceId: sid });
      },
      onSplit: (_sid, direction) => {
        htEvents.emit("ht-split-editor", {
          path: editorView.path ?? undefined,
          direction,
        });
      },
      onFocus: (sid) => this.deps.focusSurface(sid),
    });
    return editorView;
  }

  /** Detach the pane (called from removeSurface). */
  destroyView(view: EditorPaneViewRef): void {
    destroyEditorPaneView(view);
  }

  /** Apply a file snapshot from the bun side; sync the surface title. */
  applySnapshot(snapshot: EditorFileSnapshot): void {
    const surface = this.deps.getSurface(snapshot.surfaceId);
    const view = surface?.editorView;
    if (view && surface) {
      editorPaneApplySnapshot(view, snapshot);
      surface.title = view.title;
      surface.titleEl.textContent = view.title;
      this.deps.updateSidebar();
    }
  }

  /** Apply a save result (mtime refresh / dirty-flag clear). */
  applySaveResult(result: EditorSaveResult): void {
    const view = this.deps.getSurface(result.surfaceId)?.editorView;
    if (view) editorPaneApplySaveResult(view, result);
  }

  /** Save the focused-or-named editor surface. Returns false if no editor. */
  save(surfaceId?: string | null): boolean {
    const id = surfaceId ?? this.deps.getFocusedSurfaceId();
    const view = id ? this.deps.getSurface(id)?.editorView : null;
    if (!view) return false;
    saveEditor(view);
    return true;
  }

  /** Reload the focused-or-named editor surface. Returns false if none. */
  reload(surfaceId?: string | null): boolean {
    const id = surfaceId ?? this.deps.getFocusedSurfaceId();
    const view = id ? this.deps.getSurface(id)?.editorView : null;
    if (!view) return false;
    reloadEditor(view);
    return true;
  }
}
