import type { SessionManager } from "./session-manager";

const VERSION = "0.0.1";

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
}

type Handler = (params: Record<string, unknown>) => unknown;

export function createRpcHandler(
  sessions: SessionManager,
  getState: () => AppState,
  dispatch: (action: string, payload: Record<string, unknown>) => void,
  requestWebview?: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>,
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
      return state.workspaces.map((ws) => ({
        workspace: ws.id,
        name: ws.name,
        color: ws.color,
        active: ws.id === state.activeWorkspaceId,
        surfaces: ws.surfaceIds.map((sid) => {
          const surface = sessions.getSurface(sid);
          return {
            id: sid,
            pid: surface?.pty.pid ?? null,
            title: surface?.title ?? "unknown",
            focused: sid === state.focusedSurfaceId,
          };
        }),
      }));
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
      return ws.surfaceIds.map((sid) => ({
        surface_id: sid,
        focused: sid === state.focusedSurfaceId,
      }));
    },

    // ── Notifications ──

    "notification.create": (params) => {
      const n: Notification = {
        id: `notif:${++notifCounter}`,
        title: (params["title"] as string) ?? "",
        subtitle: params["subtitle"] as string | undefined,
        body: (params["body"] as string) ?? "",
        time: Date.now(),
      };
      notifications.push(n);
      dispatch("notification", {
        notifications: notifications.map((x) => ({
          id: x.id,
          title: x.title,
          body: x.body,
          time: x.time,
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
  };

  return (method: string, params: Record<string, unknown>) => {
    const handler = methods[method];
    if (!handler) throw new Error(`Unknown method: ${method}`);
    return handler(params);
  };
}
