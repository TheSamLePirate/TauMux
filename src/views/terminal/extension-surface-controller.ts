// ExtensionSurfaceController — the extension-pane concern, mirroring the
// Editor/Telegram controllers. Wires pane callbacks to the shared htEvents
// bus (which the webview index forwards to bun) and routes host→frontend
// bridge payloads back into the pane's iframe.

import { htEvents } from "../../shared/event-bus";
import type {
  ExtensionHostPayload,
  ExtensionSurfaceHandle,
} from "../../shared/extension-types";
import {
  createExtensionPaneView,
  destroyExtensionPaneView,
  type ExtensionPaneViewRef,
} from "./extension-pane";
import type { SurfaceView } from "./surface-manager";

export interface ExtensionControllerDeps {
  getSurface: (id: string) => SurfaceView | undefined;
  focusSurface: (id: string) => void;
}

export class ExtensionSurfaceController {
  constructor(private deps: ExtensionControllerDeps) {}

  /** Create + wire an extension pane view. The caller attaches
   *  `view.container` to the DOM and wraps it in a SurfaceView. */
  createExtensionView(
    surfaceId: string,
    handle: ExtensionSurfaceHandle,
  ): ExtensionPaneViewRef {
    return createExtensionPaneView(surfaceId, handle, {
      onFocus: (sid) => this.deps.focusSurface(sid),
      onClose: (sid) => htEvents.emit("ht-close-surface", { surfaceId: sid }),
      onSplit: (_sid, direction) =>
        htEvents.emit("ht-split-extension", {
          extensionId: handle.extensionId,
          direction,
        }),
      onFrontendMessage: (sid, payload) =>
        htEvents.emit("ht-extension-frontend-message", {
          surfaceId: sid,
          payload,
        }),
    });
  }

  /** Detach the pane (called from removeSurface). */
  destroyView(view: ExtensionPaneViewRef): void {
    destroyExtensionPaneView(view);
  }

  /** Route a host→frontend bridge payload (from bun's
   *  `extensionBackendMessage`) into the pane's iframe. */
  applyBackendMessage(surfaceId: string, payload: ExtensionHostPayload): void {
    this.deps.getSurface(surfaceId)?.extensionView?.handleHostPayload(payload);
  }
}
