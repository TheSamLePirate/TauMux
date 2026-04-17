import type { Handler, HandlerDeps } from "./types";
import { getMainWindowId } from "../accessory-mode";

/**
 * Tier 2 `__test.*` handlers (doc/native-e2e-plan.md §6).
 *
 * Every method here is a thin pipe: take params, call
 * `requestWebview("__test.<name>", params)`, and return whatever the webview
 * resolves with. The real logic lives in `src/views/terminal/__test-handlers.ts`;
 * bun-side we only:
 *   - gate on the dual-fact test-mode check,
 *   - name the methods so they appear in `system.capabilities`,
 *   - let the typed socket RPC client import them like any other method.
 *
 * Production builds never enable the gate, so `registerTestHandlers` returns
 * an empty table and none of these method names land in the dispatch map.
 */
export function registerTestHandlers(
  deps: HandlerDeps,
  options: { enabled: boolean },
): Record<string, Handler> {
  if (!options.enabled) return {};

  const pipe =
    (method: string): Handler =>
    (params) => {
      if (!deps.requestWebview) {
        throw new Error(
          `${method}: no webview bridge available in this process`,
        );
      }
      return deps.requestWebview(method, params);
    };

  return {
    "__test.keydown": pipe("__test.keydown"),
    "__test.dispatchEvent": pipe("__test.dispatchEvent"),
    "__test.readWebviewState": pipe("__test.readWebviewState"),
    "__test.readPaletteCommands": pipe("__test.readPaletteCommands"),
    "__test.setPaletteQuery": pipe("__test.setPaletteQuery"),
    "__test.executePalette": pipe("__test.executePalette"),
    "__test.readDialog": pipe("__test.readDialog"),
    "__test.submitDialog": pipe("__test.submitDialog"),
    "__test.cancelDialog": pipe("__test.cancelDialog"),
    "__test.openRenameWorkspaceDialog": pipe(
      "__test.openRenameWorkspaceDialog",
    ),
    "__test.openRenameSurfaceDialog": pipe("__test.openRenameSurfaceDialog"),
    "__test.readSettingsField": pipe("__test.readSettingsField"),
    "__test.setSettingsField": pipe("__test.setSettingsField"),
    "__test.openPalette": pipe("__test.openPalette"),
    "__test.openSettings": pipe("__test.openSettings"),
    "__test.toggleProcessManager": pipe("__test.toggleProcessManager"),
    "__test.toggleSidebar": pipe("__test.toggleSidebar"),
    // Resolve the CGWindowID bun-side via NSApp's mainWindow.windowNumber —
    // more reliable than the webview's `window.__electrobunWindowId` (which
    // is Electrobun's internal id, not the macOS window number screencapture
    // wants). Falls back to the webview path if FFI is unavailable.
    "__test.getWindowId": () => {
      const id = getMainWindowId();
      if (id !== null) return id;
      return deps.requestWebview?.("__test.getWindowId", {}) ?? null;
    },
    "__test.getWindowBounds": pipe("__test.getWindowBounds"),
  };
}
