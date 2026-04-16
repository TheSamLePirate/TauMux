import type { SessionManager } from "./session-manager";
import type { BrowserSurfaceManager } from "./browser-surface-manager";
import type { BrowserHistoryStore } from "./browser-history";
import type { CookieStore } from "./cookie-store";
import {
  parseJsonCookies,
  parseNetscapeCookies,
  exportAsJson,
  exportAsNetscape,
} from "./cookie-parsers";
import type { SurfaceMetadataPoller } from "./surface-metadata";
import type { PaneNode, PaneRect } from "../shared/types";

const VERSION = "0.0.1";

/** Compute normalized rects (0-1) from a PaneNode tree. */
function computeNormalizedRects(node: PaneNode): Map<string, PaneRect> {
  const result = new Map<string, PaneRect>();
  const GAP = 0.002; // small normalized gap
  computeNode(node, { x: 0, y: 0, w: 1, h: 1 }, result, GAP);
  return result;
}

function computeNode(
  node: PaneNode,
  bounds: PaneRect,
  result: Map<string, PaneRect>,
  gap: number,
): void {
  if (node.type === "leaf") {
    result.set(node.surfaceId, bounds);
    return;
  }
  const { direction, ratio, children } = node;
  const half = gap / 2;
  if (direction === "horizontal") {
    const splitX = bounds.x + bounds.w * ratio;
    computeNode(
      children[0],
      { x: bounds.x, y: bounds.y, w: splitX - bounds.x - half, h: bounds.h },
      result,
      gap,
    );
    computeNode(
      children[1],
      {
        x: splitX + half,
        y: bounds.y,
        w: bounds.x + bounds.w - splitX - half,
        h: bounds.h,
      },
      result,
      gap,
    );
  } else {
    const splitY = bounds.y + bounds.h * ratio;
    computeNode(
      children[0],
      { x: bounds.x, y: bounds.y, w: bounds.w, h: splitY - bounds.y - half },
      result,
      gap,
    );
    computeNode(
      children[1],
      {
        x: bounds.x,
        y: splitY + half,
        w: bounds.w,
        h: bounds.y + bounds.h - splitY - half,
      },
      result,
      gap,
    );
  }
}

export interface AppState {
  focusedSurfaceId: string | null;
  workspaces: WorkspaceSnapshot[];
  activeWorkspaceId: string | null;
}

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  color: string;
  surfaceIds: string[];
  focusedSurfaceId: string | null;
  layout: PaneNode;
  /** Persisted display title per surface id (pane rename). */
  surfaceTitles?: Record<string, string>;
  /** Live cwd per surface; persisted so restarts reopen shells in place. */
  surfaceCwds?: Record<string, string>;
  /** User-pinned cwd that drives the sidebar package.json card. */
  selectedCwd?: string;
  /** Persisted URL per browser surface id for restore. */
  surfaceUrls?: Record<string, string>;
  /** Surface type per surface id (only stored for "browser" or "agent"). */
  surfaceTypes?: Record<string, "terminal" | "browser" | "agent">;
}

type Handler = (params: Record<string, unknown>) => unknown;

const SNAPSHOT_SCRIPT = `
(function(){
  var counter=0;
  function snap(node,depth,max){
    if(depth>max||!node)return null;
    var tag=node.tagName?node.tagName.toLowerCase():null;
    var role=(node.getAttribute&&node.getAttribute('role'))||tag;
    var name=(node.getAttribute&&(node.getAttribute('aria-label')||node.getAttribute('alt')||node.getAttribute('title')||node.getAttribute('placeholder')))||'';
    var text=node.nodeType===3?(node.textContent||'').trim():'';
    var interactive=['a','button','input','select','textarea'].indexOf(tag)>=0;
    var children=[];
    var cn=node.childNodes||[];
    for(var i=0;i<cn.length;i++){var c=snap(cn[i],depth+1,max);if(c)children.push(c);}
    if(!role&&!text&&children.length===0)return null;
    var entry={role:role};
    if(name)entry.name=name;
    if(text)entry.text=text;
    if(interactive)entry.ref='e'+(++counter);
    if(children.length)entry.children=children;
    return entry;
  }
  return JSON.stringify(snap(document.body,0,8));
})()
`;

export function createRpcHandler(
  sessions: SessionManager,
  getState: () => AppState,
  dispatch: (action: string, payload: Record<string, unknown>) => void,
  requestWebview?: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>,
  metadataPoller?: SurfaceMetadataPoller,
  browserSurfaces?: BrowserSurfaceManager,
  browserHistory?: BrowserHistoryStore,
  pendingBrowserEvals?: Map<string, (v: string) => void>,
  cookieStore?: CookieStore,
): (
  method: string,
  params: Record<string, unknown>,
) => unknown | Promise<unknown> {
  // Notification storage
  interface Notification {
    id: string;
    title: string;
    subtitle?: string;
    body: string;
    time: number;
    surfaceId?: string;
  }

  const notifications: Notification[] = [];

  let notifCounter = 0;

  const KEY_MAP: Record<string, string> = {
    enter: "\r",
    tab: "\t",
    escape: "\x1b",
    backspace: "\x7f",
    delete: "\x1b[3~",
    up: "\x1b[A",
    down: "\x1b[B",
    right: "\x1b[C",
    left: "\x1b[D",
  };

  const methods: Record<string, Handler> = {
    "system.ping": () => "PONG",

    "system.version": () => `hyperterm-canvas ${VERSION}`,

    "system.identify": () => {
      const state = getState();
      return {
        focused_surface: state.focusedSurfaceId,
        active_workspace: state.activeWorkspaceId,
        socket_path: "/tmp/hyperterm.sock",
      };
    },

    "system.capabilities": () => ({
      protocol: "hyperterm-socket",
      version: 1,
      methods: Object.keys(methods).sort(),
    }),

    "system.tree": () => {
      const state = getState();
      return state.workspaces.map((ws) => {
        const rects = computeNormalizedRects(ws.layout);
        return {
          workspace: ws.id,
          name: ws.name,
          color: ws.color,
          active: ws.id === state.activeWorkspaceId,
          layout: ws.layout,
          surfaces: ws.surfaceIds.map((sid) => {
            const surface = sessions.getSurface(sid);
            const rect = rects.get(sid);
            return {
              id: sid,
              pid: surface?.pty.pid ?? null,
              title: surface?.title ?? "unknown",
              focused: sid === state.focusedSurfaceId,
              x: rect?.x ?? 0,
              y: rect?.y ?? 0,
              w: rect?.w ?? 1,
              h: rect?.h ?? 1,
            };
          }),
        };
      });
    },

    // ── Workspaces ──

    "workspace.list": () => {
      const state = getState();
      return state.workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        color: ws.color,
        active: ws.id === state.activeWorkspaceId,
        surface_count: ws.surfaceIds.length,
      }));
    },

    "workspace.current": () => {
      const state = getState();
      const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      return ws ?? null;
    },

    "workspace.create": (params) => {
      dispatch("createSurface", { cwd: params["cwd"] ?? undefined });
      return "OK";
    },

    "workspace.select": (params) => {
      dispatch("selectWorkspace", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
      });
      return "OK";
    },

    "workspace.close": (params) => {
      dispatch("closeWorkspace", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
      });
      return "OK";
    },

    "workspace.rename": (params) => {
      dispatch("renameWorkspace", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
        name: params["name"] ?? params["title"],
      });
      return "OK";
    },

    "workspace.next": () => {
      dispatch("nextWorkspace", {});
      return "OK";
    },

    "workspace.previous": () => {
      dispatch("prevWorkspace", {});
      return "OK";
    },

    // ── Surfaces ──

    "surface.list": () => {
      return sessions.getAllSurfaces().map((s) => ({
        id: s.id,
        pid: s.pty.pid,
        title: s.title,
        cwd: s.cwd,
      }));
    },

    "surface.metadata": (params) => {
      const id =
        (params["surface_id"] as string) ??
        (params["surface"] as string) ??
        getState().focusedSurfaceId;
      if (!id) return null;
      return metadataPoller?.getSnapshot(id) ?? null;
    },

    "surface.kill_pid": (params) => {
      const pid = Number(params["pid"]);
      if (!Number.isFinite(pid) || pid <= 0) throw new Error("pid required");
      const raw = (params["signal"] as string) || "SIGTERM";
      const signal = (
        raw.startsWith("SIG") ? raw : `SIG${raw}`
      ) as NodeJS.Signals;
      try {
        process.kill(pid, signal);
      } catch (err) {
        throw new Error(
          `kill failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return { pid, signal };
    },

    "surface.kill_port": (params) => {
      const id =
        (params["surface_id"] as string) ??
        (params["surface"] as string) ??
        getState().focusedSurfaceId;
      const port = Number(params["port"]);
      if (!Number.isFinite(port) || port <= 0) {
        throw new Error("port required");
      }
      if (!id) throw new Error("no surface");
      const meta = metadataPoller?.getSnapshot(id);
      if (!meta) throw new Error("no metadata yet — try again in a second");
      const entry = meta.listeningPorts.find((p) => p.port === port);
      if (!entry) {
        throw new Error(`no process listening on :${port} in this surface`);
      }
      const rawSignal = (params["signal"] as string) || "SIGTERM";
      const signal = rawSignal.startsWith("SIG")
        ? (rawSignal as NodeJS.Signals)
        : (`SIG${rawSignal}` as NodeJS.Signals);
      try {
        process.kill(entry.pid, signal);
      } catch (err) {
        throw new Error(
          `kill failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return { pid: entry.pid, port, signal };
    },

    "surface.open_port": (params) => {
      const id =
        (params["surface_id"] as string) ??
        (params["surface"] as string) ??
        getState().focusedSurfaceId;
      let port = Number(params["port"]);

      if (!Number.isFinite(port) || port <= 0) {
        if (!id) throw new Error("no surface");
        const meta = metadataPoller?.getSnapshot(id);
        if (!meta) throw new Error("no metadata yet — try again in a second");
        const uniquePorts = [
          ...new Set(meta.listeningPorts.map((p) => p.port)),
        ].sort((a, b) => a - b);
        if (uniquePorts.length === 0) {
          throw new Error("no listening ports in this surface");
        }
        if (uniquePorts.length > 1) {
          throw new Error(
            `multiple listening ports (${uniquePorts.join(", ")}); pass one explicitly`,
          );
        }
        port = uniquePorts[0];
      }

      const url = `http://localhost:${port}`;
      dispatch("openExternal", { url });
      return { url, port };
    },

    "surface.split": (params) => {
      const dir = params["direction"] as string;
      const direction =
        dir === "right" || dir === "horizontal"
          ? "horizontal"
          : dir === "down" || dir === "vertical"
            ? "vertical"
            : "horizontal";
      dispatch("splitSurface", { direction });
      return "OK";
    },

    "surface.close": (params) => {
      const id =
        (params["surface_id"] as string) ??
        (params["surface"] as string) ??
        getState().focusedSurfaceId;
      if (id) sessions.closeSurface(id);
      return "OK";
    },

    "surface.focus": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("focusSurface", { surfaceId: id });
      return "OK";
    },

    "surface.rename": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const title = (params["name"] as string) ?? (params["title"] as string);
      if (id && title) dispatch("renameSurface", { surfaceId: id, title });
      return "OK";
    },

    "surface.send_text": (params) => {
      const id =
        (params["surface_id"] as string) ??
        (params["surface"] as string) ??
        getState().focusedSurfaceId;
      const text = params["text"] as string;
      if (id && text) sessions.writeStdin(id, text);
      return "OK";
    },

    "surface.send_key": (params) => {
      const id =
        (params["surface_id"] as string) ??
        (params["surface"] as string) ??
        getState().focusedSurfaceId;
      const key = (params["key"] as string)?.toLowerCase();
      const seq = KEY_MAP[key];
      if (id && seq) sessions.writeStdin(id, seq);
      return "OK";
    },

    "surface.read_text": async (params) => {
      const id =
        (params["surface_id"] as string) ??
        (params["surface"] as string) ??
        getState().focusedSurfaceId;
      if (!id) return "";
      if (!requestWebview) return "";
      return await requestWebview("readScreen", {
        surfaceId: id,
        lines: params["lines"],
        scrollback: params["scrollback"],
      });
    },

    // ── Sidebar metadata ──

    "sidebar.set_status": (params) => {
      dispatch("setStatus", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
        key: params["key"],
        value: params["value"],
        icon: params["icon"],
        color: params["color"],
      });
      return "OK";
    },

    "sidebar.clear_status": (params) => {
      dispatch("clearStatus", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
        key: params["key"],
      });
      return "OK";
    },

    "sidebar.set_progress": (params) => {
      dispatch("setProgress", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
        value: params["value"],
        label: params["label"],
      });
      return "OK";
    },

    "sidebar.clear_progress": (params) => {
      dispatch("clearProgress", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
      });
      return "OK";
    },

    "sidebar.log": (params) => {
      dispatch("log", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
        level: params["level"] ?? "info",
        message: params["message"],
        source: params["source"],
      });
      return "OK";
    },

    // ── Panes ──

    "pane.list": () => {
      const state = getState();
      const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      if (!ws) return [];
      const rects = computeNormalizedRects(ws.layout);
      return ws.surfaceIds.map((sid) => {
        const rect = rects.get(sid);
        return {
          surface_id: sid,
          focused: sid === state.focusedSurfaceId,
          x: rect?.x ?? 0,
          y: rect?.y ?? 0,
          w: rect?.w ?? 1,
          h: rect?.h ?? 1,
        };
      });
    },

    // ── Notifications ──

    "notification.create": (params) => {
      const surfaceId = params["surface_id"] as string | undefined;
      const n: Notification = {
        id: `notif:${++notifCounter}`,
        title: (params["title"] as string) ?? "",
        subtitle: params["subtitle"] as string | undefined,
        body: (params["body"] as string) ?? "",
        time: Date.now(),
        surfaceId,
      };
      notifications.push(n);
      dispatch("notification", {
        surfaceId: surfaceId ?? null,
        latest: {
          id: n.id,
          title: n.title,
          body: n.body,
          surfaceId: surfaceId ?? null,
        },
        notifications: notifications.map((x) => ({
          id: x.id,
          title: x.title,
          body: x.body,
          time: x.time,
          surfaceId: x.surfaceId ?? null,
        })),
      });
      return "OK";
    },

    "notification.list": () => {
      return notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        time: n.time,
      }));
    },

    "notification.clear": () => {
      notifications.length = 0;
      dispatch("notification", { notifications: [] });
      return "OK";
    },

    // ── Browser ──

    // ── Agent ──

    "agent.create": () => {
      dispatch("createAgentSurface", {});
      return "OK";
    },

    "agent.create_split": (params) => {
      const dir = params["direction"] as string;
      const direction =
        dir === "down" || dir === "vertical" ? "vertical" : "horizontal";
      dispatch("splitAgentSurface", { direction });
      return "OK";
    },

    "browser.list": () => {
      return (browserSurfaces?.getAllSurfaces() ?? []).map((s) => ({
        id: s.id,
        url: s.url,
        title: s.title,
        zoom: s.zoom,
      }));
    },

    "browser.open": (params) => {
      dispatch("createBrowserSurface", { url: params["url"] ?? undefined });
      return "OK";
    },

    "browser.open_split": (params) => {
      const dir = params["direction"] as string;
      const direction =
        dir === "down" || dir === "vertical" ? "vertical" : "horizontal";
      dispatch("splitBrowserSurface", {
        direction,
        url: params["url"] ?? undefined,
      });
      return "OK";
    },

    "browser.navigate": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const url = params["url"] as string;
      if (id && url) {
        dispatch("browser.navigateTo", { surfaceId: id, url });
      }
      return "OK";
    },

    "browser.back": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.goBack", { surfaceId: id });
      return "OK";
    },

    "browser.forward": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.goForward", { surfaceId: id });
      return "OK";
    },

    "browser.reload": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.reload", { surfaceId: id });
      return "OK";
    },

    "browser.url": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) return null;
      return browserSurfaces?.getSurface(id)?.url ?? null;
    },

    "browser.eval": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const script = params["script"] as string;
      if (id && script) {
        dispatch("browser.evalJs", { surfaceId: id, script });
      }
      return "OK";
    },

    "browser.find": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const query = params["query"] as string;
      if (id && query) {
        dispatch("browser.findInPage", { surfaceId: id, query });
      }
      return "OK";
    },

    "browser.stop_find": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.stopFind", { surfaceId: id });
      return "OK";
    },

    "browser.devtools": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.toggleDevTools", { surfaceId: id });
      return "OK";
    },

    "browser.history": () => {
      return browserHistory?.getAll(100) ?? [];
    },

    "browser.clear_history": () => {
      browserHistory?.clear();
      return "OK";
    },

    // ── Cookie management ──

    "browser.cookie_list": (params) => {
      const domain = params["domain"] as string | undefined;
      if (domain) return cookieStore?.search(domain) ?? [];
      return cookieStore?.getAll(500) ?? [];
    },

    "browser.cookie_get": (params) => {
      const url = params["url"] as string;
      if (!url) throw new Error("url required");
      return cookieStore?.getForUrl(url) ?? [];
    },

    "browser.cookie_set": (params) => {
      const name = params["name"] as string;
      const value = params["value"] as string;
      const domain = params["domain"] as string;
      if (!name || !domain) throw new Error("name and domain required");
      cookieStore?.set({
        name,
        value: value ?? "",
        domain,
        path: (params["path"] as string) || "/",
        expires: Number(params["expires"] ?? 0),
        secure: !!params["secure"],
        httpOnly: !!params["httpOnly"],
        sameSite:
          (params["sameSite"] as string as "Strict" | "Lax" | "None" | "") ||
          "",
        source: "imported",
        updatedAt: Date.now(),
      });
      return "OK";
    },

    "browser.cookie_delete": (params) => {
      const domain = params["domain"] as string;
      const name = params["name"] as string;
      const path = (params["path"] as string) || "/";
      if (!domain || !name) throw new Error("domain and name required");
      return cookieStore?.delete(domain, path, name) ? "OK" : "NOT_FOUND";
    },

    "browser.cookie_clear": (params) => {
      const domain = params["domain"] as string | undefined;
      if (domain) {
        const count = cookieStore?.deleteForDomain(domain) ?? 0;
        return { deleted: count };
      }
      cookieStore?.clear();
      return "OK";
    },

    "browser.cookie_import": (params) => {
      const data = params["data"] as string;
      const format = (params["format"] as string) || "json";
      if (!data) throw new Error("data required");
      const cookies =
        format === "netscape"
          ? parseNetscapeCookies(data)
          : parseJsonCookies(data);
      const count = cookieStore?.importBulk(cookies) ?? 0;
      return { imported: count };
    },

    "browser.cookie_export": (params) => {
      const format = (params["format"] as string) || "json";
      const cookies = cookieStore?.exportAll() ?? [];
      if (format === "netscape") return exportAsNetscape(cookies);
      return exportAsJson(cookies);
    },

    "browser.cookie_capture": async (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      const reqId = `cookie:${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return new Promise<string>((resolve) => {
        pendingBrowserEvals?.set(reqId, (raw) => {
          try {
            const data = JSON.parse(raw);
            const url = data.url as string;
            const hostname = new URL(url).hostname;
            for (const c of data.cookies as Array<{
              name: string;
              value: string;
            }>) {
              cookieStore?.set({
                name: c.name,
                value: c.value,
                domain: hostname,
                path: "/",
                expires: 0,
                secure: url.startsWith("https"),
                httpOnly: false,
                sameSite: "",
                source: "captured",
                updatedAt: Date.now(),
              });
            }
            resolve(
              JSON.stringify({
                captured: (data.cookies as unknown[]).length,
                domain: hostname,
              }),
            );
          } catch (e) {
            resolve(`Error: ${e}`);
          }
        });
        dispatch("browser.getCookies", { surfaceId: id, reqId });
        setTimeout(() => {
          if (pendingBrowserEvals?.has(reqId)) {
            pendingBrowserEvals.delete(reqId);
            resolve("timeout");
          }
        }, 5000);
      });
    },

    "browser.snapshot": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      // Inject a DOM snapshot script that sends results via host-message → evalResult
      const snapshotScript = `
        (function() {
          var counter = 0;
          function snap(node, depth, max) {
            if (depth > max || !node) return null;
            var tag = node.tagName ? node.tagName.toLowerCase() : null;
            var role = (node.getAttribute && node.getAttribute("role")) || tag;
            var name = (node.getAttribute && (
              node.getAttribute("aria-label") ||
              node.getAttribute("alt") ||
              node.getAttribute("title") ||
              node.getAttribute("placeholder")
            )) || "";
            var text = node.nodeType === 3 ? (node.textContent || "").trim() : "";
            var interactive = ["a","button","input","select","textarea"].indexOf(tag) >= 0;
            var children = [];
            var cn = node.childNodes || [];
            for (var i = 0; i < cn.length; i++) {
              var c = snap(cn[i], depth + 1, max);
              if (c) children.push(c);
            }
            if (!role && !text && children.length === 0) return null;
            var entry = { role: role };
            if (name) entry.name = name;
            if (text) entry.text = text;
            if (interactive) entry.ref = "e" + (++counter);
            if (children.length) entry.children = children;
            return entry;
          }
          return JSON.stringify(snap(document.body, 0, 8));
        })()
      `;
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: snapshotScript,
        reqId: `snapshot:${Date.now()}`,
      });
      return "OK (snapshot dispatched — result returns asynchronously)";
    },

    "browser.close": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) browserSurfaces?.closeSurface(id);
      return "OK";
    },

    // ── Browser DOM Interaction ──
    // All DOM commands inject JS into the webview via dispatch("browser.evalJs", ...)
    // They use CSS selectors and return results via the evalResult mechanism.

    "browser.click": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `document.querySelector(${JSON.stringify(selector)})?.click()`,
      });
      if (params["snapshot_after"])
        dispatch("browser.evalJs", {
          surfaceId: id,
          script: SNAPSHOT_SCRIPT,
          reqId: `snap:${Date.now()}`,
        });
      return "OK";
    },

    "browser.dblclick": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.hover": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));e.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.focus": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
      });
      return "OK";
    },

    "browser.check": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e&&!e.checked){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.uncheck": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e&&e.checked){e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.scroll_into_view": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({behavior:'smooth',block:'center'})`,
      });
      return "OK";
    },

    "browser.type": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      const text = (params["text"] as string) ?? "";
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.focus();var t=${JSON.stringify(text)};for(var i=0;i<t.length;i++){e.dispatchEvent(new KeyboardEvent('keydown',{key:t[i],bubbles:true}));e.dispatchEvent(new KeyboardEvent('keypress',{key:t[i],bubbles:true}));e.dispatchEvent(new InputEvent('input',{data:t[i],inputType:'insertText',bubbles:true}));e.dispatchEvent(new KeyboardEvent('keyup',{key:t[i],bubbles:true}));}if('value' in e)e.value+=t;e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.fill": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      const text = (params["text"] as string) ?? "";
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.focus();e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.press": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const key = params["key"] as string;
      if (!id || !key) throw new Error("surface_id and key required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var k=${JSON.stringify(key)};document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true}));document.activeElement.dispatchEvent(new KeyboardEvent('keypress',{key:k,bubbles:true}));document.activeElement.dispatchEvent(new KeyboardEvent('keyup',{key:k,bubbles:true}));})()`,
      });
      return "OK";
    },

    "browser.select": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      const value = params["value"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.value=${JSON.stringify(value ?? "")};e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.scroll": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      const selector = params["selector"] as string | undefined;
      const dx = Number(params["dx"] ?? 0);
      const dy = Number(params["dy"] ?? 0);
      const target = selector
        ? `document.querySelector(${JSON.stringify(selector)})`
        : `window`;
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `${target}.scrollBy(${dx},${dy})`,
      });
      return "OK";
    },

    "browser.highlight": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){var prev=e.style.outline;e.style.outline='3px solid #ff0000';e.style.outlineOffset='2px';setTimeout(function(){e.style.outline=prev;e.style.outlineOffset='';},3000);}})()`,
      });
      return "OK";
    },

    // ── Browser Getters ──

    "browser.get": async (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const what = params["what"] as string;
      if (!id || !what) throw new Error("surface_id and what required");
      const selector = params["selector"] as string | undefined;
      const attr = params["attr"] as string | undefined;
      const prop = params["property"] as string | undefined;

      let script: string;
      switch (what) {
        case "title":
          script = `document.title`;
          break;
        case "url":
          script = `window.location.href`;
          break;
        case "text":
          script = selector
            ? `(document.querySelector(${JSON.stringify(selector)})?.textContent || '')`
            : `document.body.innerText`;
          break;
        case "html":
          script = selector
            ? `(document.querySelector(${JSON.stringify(selector)})?.innerHTML || '')`
            : `document.documentElement.outerHTML`;
          break;
        case "value":
          script = `(document.querySelector(${JSON.stringify(selector ?? "")})?.value || '')`;
          break;
        case "attr":
          script = `(document.querySelector(${JSON.stringify(selector ?? "")})?.getAttribute(${JSON.stringify(attr ?? "")}) || '')`;
          break;
        case "count":
          script = `document.querySelectorAll(${JSON.stringify(selector ?? "")}).length`;
          break;
        case "box":
          script = `(function(){var e=document.querySelector(${JSON.stringify(selector ?? "")});if(!e)return null;var r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height});})()`;
          break;
        case "styles":
          script = prop
            ? `getComputedStyle(document.querySelector(${JSON.stringify(selector ?? "")}))?.getPropertyValue(${JSON.stringify(prop)})`
            : `JSON.stringify(Object.fromEntries([...getComputedStyle(document.querySelector(${JSON.stringify(selector ?? "")}))].map(p=>[p,getComputedStyle(document.querySelector(${JSON.stringify(selector ?? "")})).getPropertyValue(p)])))`;
          break;
        default:
          throw new Error(`Unknown getter: ${what}`);
      }

      const reqId = `get:${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return new Promise<string>((resolve) => {
        pendingBrowserEvals?.set(reqId, resolve);
        dispatch("browser.evalJs", { surfaceId: id, script, reqId });
        setTimeout(() => {
          if (pendingBrowserEvals?.has(reqId)) {
            pendingBrowserEvals.delete(reqId);
            resolve("");
          }
        }, 5000);
      });
    },

    "browser.is": async (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const check = params["check"] as string;
      const selector = params["selector"] as string;
      if (!id || !check || !selector)
        throw new Error("surface_id, check, and selector required");

      let script: string;
      switch (check) {
        case "visible":
          script = `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'false';var r=e.getBoundingClientRect();var s=getComputedStyle(e);return String(r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none');})()`;
          break;
        case "enabled":
          script = `String(!document.querySelector(${JSON.stringify(selector)})?.disabled)`;
          break;
        case "checked":
          script = `String(!!document.querySelector(${JSON.stringify(selector)})?.checked)`;
          break;
        default:
          throw new Error(`Unknown check: ${check}`);
      }

      const reqId = `is:${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return new Promise<string>((resolve) => {
        pendingBrowserEvals?.set(reqId, resolve);
        dispatch("browser.evalJs", { surfaceId: id, script, reqId });
        setTimeout(() => {
          if (pendingBrowserEvals?.has(reqId)) {
            pendingBrowserEvals.delete(reqId);
            resolve("false");
          }
        }, 5000);
      });
    },

    // ── Browser Wait ──

    "browser.wait": async (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      const timeoutMs = Number(params["timeout_ms"] ?? 10000);
      const selector = params["selector"] as string | undefined;
      const text = params["text"] as string | undefined;
      const urlContains = params["url_contains"] as string | undefined;
      const loadState = params["load_state"] as string | undefined;
      const fn = params["function"] as string | undefined;

      let condition: string;
      if (selector) {
        condition = `!!document.querySelector(${JSON.stringify(selector)})`;
      } else if (text) {
        condition = `document.body.innerText.includes(${JSON.stringify(text)})`;
      } else if (urlContains) {
        condition = `window.location.href.includes(${JSON.stringify(urlContains)})`;
      } else if (loadState) {
        condition =
          loadState === "complete"
            ? `document.readyState === 'complete'`
            : `document.readyState === 'interactive' || document.readyState === 'complete'`;
      } else if (fn) {
        condition = `!!(${fn})`;
      } else {
        throw new Error(
          "One of selector, text, url_contains, load_state, or function required",
        );
      }

      const pollScript = `
        (function(){
          var start=Date.now();
          var timeout=${timeoutMs};
          function check(){
            try{if(${condition}){window.__electrobunSendToHost({type:'evalResult',reqId:__reqId,result:'true'});return;}}catch(e){}
            if(Date.now()-start>timeout){window.__electrobunSendToHost({type:'evalResult',reqId:__reqId,result:'timeout'});return;}
            setTimeout(check,200);
          }
          check();
        })()
      `;

      const reqId = `wait:${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const finalScript = pollScript.replace(/__reqId/g, JSON.stringify(reqId));

      return new Promise<string>((resolve) => {
        pendingBrowserEvals?.set(reqId, resolve);
        dispatch("browser.evalJs", { surfaceId: id, script: finalScript });
        setTimeout(() => {
          if (pendingBrowserEvals?.has(reqId)) {
            pendingBrowserEvals.delete(reqId);
            resolve("timeout");
          }
        }, timeoutMs + 2000);
      });
    },

    // ── Script/Style Injection ──

    "browser.addscript": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const script = params["script"] as string;
      if (!id || !script) throw new Error("surface_id and script required");
      dispatch("browser.evalJs", { surfaceId: id, script });
      return "OK";
    },

    "browser.addstyle": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const css = params["css"] as string;
      if (!id || !css) throw new Error("surface_id and css required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`,
      });
      return "OK";
    },

    // ── Console & Errors ──

    "browser.console_list": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      return browserSurfaces?.getConsoleLogs(id) ?? [];
    },

    "browser.console_clear": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      browserSurfaces?.clearConsoleLogs(id);
      return "OK";
    },

    "browser.errors_list": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      return browserSurfaces?.getErrors(id) ?? [];
    },

    "browser.errors_clear": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      browserSurfaces?.clearErrors(id);
      return "OK";
    },

    // ── Browser Identify ──

    "browser.identify": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) {
        const s = browserSurfaces?.getSurface(id);
        if (!s) throw new Error(`Unknown browser surface: ${id}`);
        return {
          id: s.id,
          url: s.url,
          title: s.title,
          zoom: s.zoom,
          partition: s.partition,
        };
      }
      // Return focused if it's a browser
      const state = getState();
      const fid = state.focusedSurfaceId;
      if (fid && browserSurfaces?.isBrowserSurface(fid)) {
        const s = browserSurfaces.getSurface(fid)!;
        return {
          id: s.id,
          url: s.url,
          title: s.title,
          zoom: s.zoom,
          partition: s.partition,
        };
      }
      return null;
    },
  };

  return (method: string, params: Record<string, unknown>) => {
    const handler = methods[method];
    if (!handler) throw new Error(`Unknown method: ${method}`);
    return handler(params);
  };
}
