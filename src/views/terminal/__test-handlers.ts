/**
 * Tier 2 test-only webview IPC (doc/native-e2e-plan.md §6).
 *
 * Dispatch table for `__test.*` actions. The bun side calls
 * `requestWebview("__test.readWebviewState", {})` (or keydown, readDialog,
 * …); that arrives here as a `socketAction`, we compute a value, and
 * respond via `rpc.send("webviewResponse", { reqId, result })` — the same
 * reqId-keyed pending map that `readScreen` already uses.
 *
 * **Runtime gate.** The handler dispatcher only wires itself into the
 * socketAction table when `window.__htTestMode__ === true`. Bun flips
 * that flag by sending `enableTestMode` once at startup when both:
 *   - `HYPERTERM_TEST_MODE=1`
 *   - `HT_CONFIG_DIR` lives under the system tmp prefix
 * hold. Production never sets those, so the flag stays false and the
 * registration path is never taken.
 */

import type { SurfaceManager } from "./surface-manager";
import type { CommandPalette } from "./command-palette";
import type { SettingsPanel } from "./settings-panel";
import type { ProcessManagerPanel } from "./process-manager";
import type { AppSettings } from "../../shared/settings";
import { DEFAULT_SETTINGS, mergeSettings } from "../../shared/settings";
import {
  readActivePromptDialog,
  submitActivePromptDialog,
  cancelActivePromptDialog,
} from "./prompt-dialog";

declare global {
  interface Window {
    __htTestMode__?: boolean;
  }
}

// Intentionally loose — matches the pattern in `socket-actions.ts`. The
// Electroview `.send` type is heavily generic over the RPC schema; casting
// through `any` keeps the test handlers from having to re-state that schema.

type RpcSend = (name: any, payload: any) => void;

export interface TestHandlerContext {
  surfaceManager: SurfaceManager;
  palette: CommandPalette;
  settingsPanel: SettingsPanel;
  processManagerPanel: ProcessManagerPanel;
  getCurrentSettings: () => AppSettings | null;
  applySettings: (s: AppSettings) => void;
  openCommandPalette: () => void;
  openSettings: () => void;
  toggleProcessManager: () => void;
  toggleSidebar: () => void;
  /** Opens the workspace-rename prompt. Matches the flow the right-click
   *  context menu uses in production; lets dialog specs drive the dialog
   *  without synthesising a context-menu event. */
  openRenameWorkspaceDialog: (workspaceId: string, name: string) => void;
  /** Opens the surface-rename prompt. Same rationale. */
  openRenameSurfaceDialog: (surfaceId: string, title: string) => void;
  rpc: { send: RpcSend };
}

type Handler = (payload: Record<string, unknown>) => unknown;

function buildHandlers(ctx: TestHandlerContext): Record<string, Handler> {
  return {
    "__test.keydown": (p) => {
      // Dispatch on the focused element if any (palette input, prompt
      // dialog input, search bar input) so element-scoped listeners fire,
      // then bubble up to document. Falling back to document directly is
      // what the old behaviour did and still works for the global ⌘-key
      // shortcuts registered at index.ts:1317.
      const event = new KeyboardEvent("keydown", {
        key: String(p["key"] ?? ""),
        metaKey: p["meta"] === true,
        shiftKey: p["shift"] === true,
        ctrlKey: p["ctrl"] === true,
        altKey: p["alt"] === true,
        bubbles: true,
        cancelable: true,
      });
      const target =
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
          ? document.activeElement
          : document;
      target.dispatchEvent(event);
      return { ok: true };
    },

    "__test.dispatchEvent": (p) => {
      const type = String(p["type"] ?? "");
      if (!type) return { ok: false, reason: "type required" };
      window.dispatchEvent(new CustomEvent(type, { detail: p["detail"] }));
      return { ok: true };
    },

    "__test.readWebviewState": () => ({
      sidebarVisible: ctx.surfaceManager.isSidebarVisible(),
      paletteVisible: ctx.palette.isVisible(),
      paletteQuery: ctx.palette.isVisible()
        ? ctx.palette.getCurrentQuery()
        : "",
      settingsPanelVisible: ctx.settingsPanel.isVisible(),
      processManagerVisible: ctx.processManagerPanel.isVisible(),
      searchBarVisible: ctx.surfaceManager.isSearchBarVisible(),
      focusedSurfaceId: ctx.surfaceManager.getActiveSurfaceId(),
      activeSurfaceType: ctx.surfaceManager.getActiveSurfaceType(),
      activeWorkspaceId: ctx.surfaceManager.getActiveWorkspaceId(),
      fontSize: ctx.surfaceManager.getFontSize(),
    }),

    "__test.readPaletteCommands": () => {
      if (!ctx.palette.isVisible()) return [];
      return ctx.palette.getFilteredCommands().map((c) => ({
        id: c.id,
        label: c.label,
        category: c.category ?? null,
        description: c.description ?? null,
        shortcut: c.shortcut ?? null,
      }));
    },

    "__test.setPaletteQuery": (p) => {
      if (!ctx.palette.isVisible()) return { ok: false };
      ctx.palette.setQuery(String(p["query"] ?? ""));
      return { ok: true, query: ctx.palette.getCurrentQuery() };
    },

    "__test.executePalette": () => {
      const cmd = ctx.palette.executeSelected();
      if (!cmd) return { ok: false };
      return { ok: true, id: cmd.id, label: cmd.label };
    },

    "__test.readDialog": () => readActivePromptDialog(),
    "__test.submitDialog": (p) => ({
      ok: submitActivePromptDialog(String(p["value"] ?? "")),
    }),
    "__test.cancelDialog": () => ({ ok: cancelActivePromptDialog() }),
    "__test.openRenameWorkspaceDialog": (p) => {
      const id = String(p["workspaceId"] ?? "");
      const name = String(p["name"] ?? "Workspace");
      if (!id) return { ok: false, reason: "workspaceId required" };
      ctx.openRenameWorkspaceDialog(id, name);
      return { ok: true };
    },
    "__test.openRenameSurfaceDialog": (p) => {
      const id = String(p["surfaceId"] ?? "");
      const title = String(p["title"] ?? "Pane");
      if (!id) return { ok: false, reason: "surfaceId required" };
      ctx.openRenameSurfaceDialog(id, title);
      return { ok: true };
    },

    "__test.readSettingsField": (p) => {
      const key = String(p["key"] ?? "");
      const s = ctx.getCurrentSettings();
      if (!s) return null;
      if (!(key in s)) return null;
      return (s as unknown as Record<string, unknown>)[key] ?? null;
    },

    "__test.setSettingsField": (p) => {
      const key = String(p["key"] ?? "");
      const value = p["value"];
      const base = ctx.getCurrentSettings() ?? DEFAULT_SETTINGS;
      const partial = { [key]: value } as Partial<AppSettings>;
      const merged = mergeSettings(base, partial);
      ctx.applySettings(merged);
      ctx.rpc.send("updateSettings", { settings: partial });
      return { ok: true };
    },

    "__test.openPalette": () => {
      ctx.openCommandPalette();
      return { ok: true };
    },
    "__test.openSettings": () => {
      ctx.openSettings();
      return { ok: true };
    },
    "__test.toggleProcessManager": () => {
      ctx.toggleProcessManager();
      return { ok: true };
    },
    "__test.toggleSidebar": () => {
      ctx.toggleSidebar();
      return { ok: true };
    },

    "__test.getWindowId": () => {
      // Electrobun exposes this on the Window type; typed in its global
      // declarations (node_modules/electrobun/.../api/browser/global.d.ts).
      const w = window as unknown as { __electrobunWindowId?: number };
      return w.__electrobunWindowId ?? null;
    },
    "__test.getWindowBounds": () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    }),
  };
}

/**
 * Creates a router that, given a socket action name, returns a handler
 * for it — or `null` if the action is not a `__test.*` method. Callers
 * should fall through to the normal dispatcher on `null`.
 *
 * The router itself is a no-op (returns null for everything) when
 * `window.__htTestMode__` is not set — that's the runtime gate.
 */
export function createTestActionRouter(
  ctx: TestHandlerContext,
): (action: string, payload: Record<string, unknown>) => boolean {
  const handlers = buildHandlers(ctx);
  return (action, payload) => {
    if (!window.__htTestMode__) return false;
    const handler = handlers[action];
    if (!handler) return false;
    const reqId =
      typeof payload["reqId"] === "string" ? payload["reqId"] : null;
    let result: unknown;
    try {
      result = handler(payload);
    } catch (err) {
      result = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (reqId) {
      ctx.rpc.send("webviewResponse", { reqId, result });
    }
    return true;
  };
}

/** Exposed for unit testing and for an M11 build-output assertion that
 *  greps for the string `"__test."` in release bundles. If this array is
 *  ever renamed, update `scripts/assert-no-test-in-bundle.ts` too. */
export const TEST_HANDLER_NAMES: readonly string[] = [
  "__test.keydown",
  "__test.dispatchEvent",
  "__test.readWebviewState",
  "__test.readPaletteCommands",
  "__test.setPaletteQuery",
  "__test.executePalette",
  "__test.readDialog",
  "__test.submitDialog",
  "__test.cancelDialog",
  "__test.openRenameWorkspaceDialog",
  "__test.openRenameSurfaceDialog",
  "__test.readSettingsField",
  "__test.setSettingsField",
  "__test.openPalette",
  "__test.openSettings",
  "__test.toggleProcessManager",
  "__test.toggleSidebar",
  "__test.getWindowId",
  "__test.getWindowBounds",
];
