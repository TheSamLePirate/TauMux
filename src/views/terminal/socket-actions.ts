/**
 * Socket-API action dispatcher.
 *
 * Before this module existed, `src/views/terminal/index.ts` had a
 * 250-line `handleSocketAction` switch at module scope that routed
 * 30+ action strings (workspace/surface/browser/agent/status/log/
 * notification/toast/…) into SurfaceManager methods, RPC sends, and
 * local UI helpers.
 *
 * Move it into a single factory that returns a dispatch map. Callers
 * hand over a `SocketActionContext` containing the ambient
 * SurfaceManager, the rpc handle, and a handful of webview-local
 * helpers (sidebar sync, toast, prompts, clipboard ops).
 *
 * The result:
 *   - index.ts shrinks by ~250 lines
 *   - each action handler is a named function in a map, which makes
 *     diffs, per-action tests, and adding new actions trivial
 *   - the context-bundle pattern mirrors DialogDeps / SlashDeps /
 *     ResponseDeps from the agent-panel split, so callers recognise
 *     the shape
 */

import { showToast } from "./toast";
import { playNotificationSound } from "./sounds";
import type { SurfaceManager } from "./surface-manager";

type RpcSend = (name: any, payload: any) => void;

export interface SocketActionContext {
  surfaceManager: SurfaceManager;
  rpc: { send: RpcSend };
  toggleSidebar: () => void;
  openCommandPalette: () => void;
  toggleProcessManager: () => void;
  openSettings: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  selectAll: () => void;
  promptRenameWorkspace: (id: string, name: string) => void;
  promptRenameSurface: (id: string, title: string) => void;
  setSidebarVisibleProgrammatic: (visible: boolean) => void;
  /** Fires an immediate `workspaceStateSync` to bun, bypassing the 100ms
   *  debounce. Used before `saveLayout` at shutdown so a just-made split
   *  actually makes it into `layout.json`. */
  flushWorkspaceStateSync: () => void;
  onActionComplete: () => void;
}

type Handler = (
  payload: Record<string, unknown>,
  ctx: SocketActionContext,
) => void;

/** Dispatch table of every socket-API action the webview responds to.
 *  Keys are action names as sent from bun; values are pure handlers
 *  that only touch state through the passed-in context. */
const SOCKET_ACTION_HANDLERS: Record<string, Handler> = {
  // ── Workspaces ──
  selectWorkspace: (p, { surfaceManager }) => {
    const id = p["workspaceId"] as string;
    if (id) surfaceManager.focusWorkspaceById(id);
  },
  closeWorkspace: (p, { surfaceManager }) => {
    const id = p["workspaceId"] as string;
    if (id) surfaceManager.closeWorkspaceById(id);
  },
  renameWorkspace: (p, { surfaceManager }) => {
    const id = p["workspaceId"] as string;
    const name = p["name"] as string;
    if (id && name) surfaceManager.renameWorkspace(id, name);
  },
  promptRenameWorkspace: (p, { promptRenameWorkspace }) => {
    const id = p["workspaceId"] as string;
    const name = (p["name"] as string) || "Workspace";
    if (id) promptRenameWorkspace(id, name);
  },
  promptRenameSurface: (p, ctx) => {
    const id = p["surfaceId"] as string;
    const title =
      (p["title"] as string) || ctx.surfaceManager.getSurfaceTitle(id) || id;
    if (id) ctx.promptRenameSurface(id, title);
  },
  renameSurface: (p, { surfaceManager }) => {
    const id = p["surfaceId"] as string;
    const title = p["title"] as string;
    if (id && title) surfaceManager.renameSurface(id, title);
  },
  setWorkspaceColor: (p, { surfaceManager }) => {
    const id = p["workspaceId"] as string;
    const color = p["color"] as string;
    if (id && color) surfaceManager.setWorkspaceColor(id, color);
  },
  nextWorkspace: (_p, { surfaceManager }) => surfaceManager.nextWorkspace(),
  prevWorkspace: (_p, { surfaceManager }) => surfaceManager.prevWorkspace(),

  // ── Sidebar / toolbar / panels ──
  toggleSidebar: (_p, { toggleSidebar }) => toggleSidebar(),
  setSidebar: (p, { setSidebarVisibleProgrammatic }) => {
    const vis = p["visible"] as boolean;
    setSidebarVisibleProgrammatic(vis);
  },
  toggleCommandPalette: (_p, { openCommandPalette }) => openCommandPalette(),
  toggleProcessManager: (_p, { toggleProcessManager }) =>
    toggleProcessManager(),
  openSettings: (_p, { openSettings }) => openSettings(),

  // ── Focus / clipboard ──
  focusSurface: (p, { surfaceManager }) => {
    const id = p["surfaceId"] as string;
    if (id) surfaceManager.focusSurface(id);
  },
  copySelection: (_p, { copySelection }) => copySelection(),
  pasteClipboard: (_p, { pasteClipboard }) => pasteClipboard(),
  selectAll: (_p, { selectAll }) => selectAll(),

  // ── Status / progress / logs / notifications ──
  setStatus: (p, { surfaceManager }) => {
    surfaceManager.setStatus(
      p["workspaceId"] as string | undefined,
      p["key"] as string,
      p["value"] as string,
      p["icon"] as string | undefined,
      p["color"] as string | undefined,
    );
  },
  clearStatus: (p, { surfaceManager }) => {
    surfaceManager.clearStatus(
      p["workspaceId"] as string | undefined,
      p["key"] as string,
    );
  },
  setProgress: (p, { surfaceManager }) => {
    surfaceManager.setProgress(
      p["workspaceId"] as string | undefined,
      p["value"] as number,
      p["label"] as string | undefined,
    );
  },
  clearProgress: (p, { surfaceManager }) => {
    surfaceManager.clearProgress(p["workspaceId"] as string | undefined);
  },
  notification: (p, { surfaceManager }) => {
    const notifs =
      (p["notifications"] as {
        id: string;
        title: string;
        body: string;
        time: number;
        surfaceId?: string | null;
      }[]) || [];
    surfaceManager.getSidebar().setNotifications(notifs);
    if (notifs.length === 0) {
      // Notifications cleared — stop all glows
      surfaceManager.clearGlow();
    } else {
      // Glow the source surface pane
      const notifSurfaceId = (p["surfaceId"] as string) ?? null;
      surfaceManager.notifyGlow(notifSurfaceId);
      // `latest` is only populated on create dispatches — not on
      // dismiss/clear rebroadcasts — so the sound only fires when a
      // genuinely new notification arrives.
      if (p["latest"]) playNotificationSound();
    }
  },
  log: (p, { surfaceManager }) => {
    surfaceManager.addLog(
      p["workspaceId"] as string | undefined,
      (p["level"] as string) || "info",
      (p["message"] as string) || "",
      p["source"] as string | undefined,
    );
  },

  // ── Layout sync flush (async — requires rpc response) ──
  // Bun calls this before `saveLayout()` at graceful-shutdown time. The
  // normal `workspaceStateSync` is debounced 100ms, so a just-made split
  // can land AFTER `saveLayout()` has already persisted the old state.
  // This handler bypasses the debounce and fires a sync immediately.
  forceLayoutSync: (p, { flushWorkspaceStateSync, rpc }) => {
    flushWorkspaceStateSync();
    rpc.send("webviewResponse", {
      reqId: p["reqId"] as string,
      result: { ok: true },
    });
  },

  // ── Screen read (async — requires rpc response) ──
  readScreen: (p, { surfaceManager, rpc }) => {
    const sid =
      (p["surfaceId"] as string) || surfaceManager.getActiveSurfaceId() || "";
    const content = surfaceManager.readScreen(
      sid,
      p["lines"] as number | undefined,
      p["scrollback"] as boolean | undefined,
    );
    rpc.send("readScreenResponse", {
      reqId: p["reqId"] as string,
      content,
    });
  },

  // ── Browser actions from socket API ──
  "browser.navigateTo": (p, { surfaceManager }) => {
    const id = p["surfaceId"] as string;
    const url = p["url"] as string;
    if (id && url) surfaceManager.browserNavigateTo(id, url);
  },
  "browser.goBack": (p, { surfaceManager }) => {
    surfaceManager.browserGoBack(p["surfaceId"] as string);
  },
  "browser.goForward": (p, { surfaceManager }) => {
    surfaceManager.browserGoForward(p["surfaceId"] as string);
  },
  "browser.reload": (p, { surfaceManager }) => {
    surfaceManager.browserReload(p["surfaceId"] as string);
  },
  "browser.evalJs": (p, { surfaceManager }) => {
    surfaceManager.browserEvalJs(
      p["surfaceId"] as string,
      p["script"] as string,
      p["reqId"] as string | undefined,
    );
  },
  "browser.findInPage": (p, { surfaceManager }) => {
    surfaceManager.browserFindInPage(
      p["surfaceId"] as string,
      p["query"] as string,
    );
  },
  "browser.stopFind": (p, { surfaceManager }) => {
    surfaceManager.browserStopFind(p["surfaceId"] as string);
  },
  "browser.toggleDevTools": (p, { surfaceManager }) => {
    surfaceManager.browserToggleDevTools(p["surfaceId"] as string);
  },
  "browser.getCookies": (p, { surfaceManager }) => {
    surfaceManager.browserGetCookies(
      p["surfaceId"] as string,
      p["reqId"] as string,
    );
  },

  // ── Toast ──
  showToast: (p) => {
    const message = (p["message"] as string) || "";
    const level =
      (p["level"] as "info" | "success" | "warning" | "error" | undefined) ??
      "info";
    if (message) showToast(message, level);
  },

  // ── Agent surface lifecycle ──
  agentSurfaceCreated: (p, { surfaceManager }) => {
    const sid = p["surfaceId"] as string;
    const aid = p["agentId"] as string;
    const splitFrom = p["splitFrom"] as string | undefined;
    const dir = p["direction"] as "horizontal" | "vertical" | undefined;
    if (!sid || !aid) return;
    if (splitFrom && dir) {
      surfaceManager.addAgentSurfaceAsSplit(sid, aid, splitFrom, dir);
    } else {
      surfaceManager.addAgentSurface(sid, aid);
    }
  },
  agentEvent: (p, { surfaceManager }) => {
    const agentId = p["agentId"] as string;
    const event = p["event"] as Record<string, unknown>;
    if (agentId && event) {
      surfaceManager.handleAgentEvent(agentId, event);
    }
  },
  agentSurfaceClosed: (p, { surfaceManager }) => {
    const sid = p["surfaceId"] as string;
    if (sid) surfaceManager.removeAgentSurface(sid);
  },
};

/** Returned by `createSocketActionDispatcher` — callers invoke it for
 *  every inbound socket action payload. Unknown actions are silently
 *  ignored, matching the old switch's default-no-op behaviour. */
export type SocketActionDispatcher = (
  action: string,
  payload: Record<string, unknown>,
) => void;

/** Build a dispatcher bound to the given context. The dispatcher
 *  always calls `ctx.onActionComplete()` after the handler runs
 *  (even for unknown actions, mirroring the old fall-through
 *  `syncWorkspaceState / syncToolbarState` calls). */
export function createSocketActionDispatcher(
  ctx: SocketActionContext,
): SocketActionDispatcher {
  return (action, payload) => {
    SOCKET_ACTION_HANDLERS[action]?.(payload, ctx);
    ctx.onActionComplete();
  };
}

/** Exported for tests so they can assert the registered surface. */
export const SOCKET_ACTION_NAMES: readonly string[] = Object.keys(
  SOCKET_ACTION_HANDLERS,
);
