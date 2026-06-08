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
      // Metadata poll cadence follows window state (W2-METADATA-BLUR):
      //   hidden/occluded            → 3000 ms (minimized; nobody watching
      //                                 the native window — ht/web may be live
      //                                 but staleness there is acceptable)
      //   visible but unfocused      → 1800 ms (user tabbed to another app but
      //                                 τ-mux is still on screen / mirrored —
      //                                 back off to save idle CPU without
      //                                 going as stale as the hidden case)
      //   visible + focused          → 1000 ms (full rate, user is looking)
      // `focused` is optional: older webviews omit it, collapsing to the
      // prior visible→1000 / hidden→3000 behaviour.
      const rate = !payload.visible
        ? 3000
        : payload.focused === false
          ? 1800
          : 1000;
      ctx.metadataPoller.setPollRate(rate);
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
