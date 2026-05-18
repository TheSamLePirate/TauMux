import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "viewportSize"
  | "resize"
  | "focusSurface"
  | "windowVisibility"
  | "toggleMaximize";

/** Viewport sizing + focus changes. The first `resize` after webview
 *  ready also drives the initial settings / diagnostics / layout
 *  hydration — this matches the historical inline behaviour exactly. */
export function registerViewportWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    viewportSize: (payload) => {
      ctx.app.webServer?.setNativeViewport(payload.width, payload.height);
    },
    resize: (payload) => {
      if (!ctx.app.initialResizeReceived) {
        ctx.app.initialResizeReceived = true;
        // Send settings now that the webview is ready
        ctx.rpc.send("restoreSettings", {
          settings: ctx.settingsManager.get(),
        });
        // Static runtime paths for the Settings → Advanced panel. Sent
        // once; the panel caches them. logPath is null when the file tee
        // failed to open (read-only home, full disk, etc).
        ctx.rpc.send("restoreDiagnostics", {
          logPath: ctx.loggerHandle.currentPath,
          socketPath: ctx.socketPath,
          configDir: ctx.configDir,
        });
        // Tier 2: flip the webview's test-mode flag before any test fixture
        // tries to exercise a `__test.*` RPC. Under the dual-fact gate this
        // is a no-op for production.
        if (ctx.htTestMode) {
          ctx.rpc.send("enableTestMode", { enabled: true });
        }
        // Re-send the web-mirror status — the boot-time send at module
        // load happens before the webview has registered RPC handlers,
        // so the sidebar dot was stuck on "Offline" (its CSS default)
        // even when auto-start had brought the server up.
        ctx.sendWebServerStatus();
        if (!ctx.tryRestoreLayout(payload.cols, payload.rows)) {
          ctx.createWorkspaceSurface(payload.cols, payload.rows);
        }
      } else {
        ctx.sessions.resize(payload.surfaceId, payload.cols, payload.rows);
        ctx.app.webServer?.broadcast({
          type: "resize",
          surfaceId: payload.surfaceId,
          cols: payload.cols,
          rows: payload.rows,
        });
      }
    },
    focusSurface: (payload) => {
      ctx.app.focusedSurfaceId = payload.surfaceId;
      ctx.app.webServer?.broadcast({
        type: "focusChanged",
        surfaceId: payload.surfaceId,
      });
    },
    windowVisibility: (payload) => {
      // Slow down metadata polling while the window is hidden — still
      // useful (ht CLI + web mirror clients may be live) but not critical.
      ctx.metadataPoller.setPollRate(payload.visible ? 1000 : 3000);
    },
    toggleMaximize: () => {
      if (ctx.mainWindow.isMaximized()) {
        ctx.mainWindow.unmaximize();
      } else {
        ctx.mainWindow.maximize();
      }
    },
  };
}
