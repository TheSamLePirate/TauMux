import { Electroview } from "electrobun/view";
import type { HyperTermRPC } from "../../shared/types";
import { SurfaceManager } from "./surface-manager";
import { CommandPalette } from "./command-palette";

// Declared before rpc so handlers can reference it; assigned after rpc is created.
// eslint-disable-next-line prefer-const
let surfaceManager: SurfaceManager;

const rpc = Electroview.defineRPC<HyperTermRPC>({
  handlers: {
    messages: {
      writeStdout: (payload) => {
        surfaceManager.writeToSurface(payload.surfaceId, payload.data);
      },
      surfaceCreated: (payload) => {
        if (payload.splitFrom && payload.direction) {
          surfaceManager.addSurfaceAsSplit(
            payload.surfaceId,
            payload.title,
            payload.splitFrom,
            payload.direction,
          );
        } else {
          surfaceManager.addSurface(payload.surfaceId, payload.title);
        }
      },
      surfaceClosed: (payload) => {
        surfaceManager.removeSurface(payload.surfaceId);
      },
      sidebandMeta: (payload) => {
        surfaceManager.handleSidebandMeta(payload.surfaceId, payload);
      },
      sidebandData: (payload) => {
        surfaceManager.handleSidebandData(
          payload.surfaceId,
          payload.id,
          payload.data,
        );
      },
      socketAction: (payload) => {
        handleSocketAction(payload.action, payload.payload);
      },
    },
    requests: {
      readScreen: (params) => {
        return surfaceManager.readScreen(
          params.surfaceId,
          params.lines,
          params.scrollback,
        );
      },
    },
  },
});

surfaceManager = new SurfaceManager(
  document.getElementById("terminal-container")!,
  document.getElementById("sidebar")!,
  (surfaceId, data) => rpc.send("writeStdin", { surfaceId, data }),
  (surfaceId, cols, rows) => rpc.send("resize", { surfaceId, cols, rows }),
  (surfaceId, event) => rpc.send("panelEvent", { ...event, surfaceId }),
);

new Electroview({ rpc });

let resizeTimer: ReturnType<typeof setTimeout> | null = null;

function handleResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => surfaceManager.resizeAll(), 200);
}

const resizeObserver = new ResizeObserver(handleResize);
resizeObserver.observe(document.getElementById("terminal-container")!);

setTimeout(() => {
  rpc.send("resize", { surfaceId: "__init__", cols: 80, rows: 24 });
}, 300);

const palette = new CommandPalette();
palette.setCommands([
  {
    id: "new-workspace",
    category: "Workspace",
    label: "New Workspace",
    description: "Open a fresh shell workspace.",
    shortcut: "\u2318N",
    action: () => rpc.send("createSurface", {}),
  },
  {
    id: "split-right",
    category: "Layout",
    label: "Split Right",
    description: "Create a new pane to the right of the current one.",
    shortcut: "\u2318D",
    action: () => rpc.send("splitSurface", { direction: "horizontal" }),
  },
  {
    id: "split-down",
    category: "Layout",
    label: "Split Down",
    description: "Create a new pane below the current one.",
    shortcut: "\u2318\u21e7D",
    action: () => rpc.send("splitSurface", { direction: "vertical" }),
  },
  {
    id: "close-pane",
    category: "Layout",
    label: "Close Pane",
    description: "Close the currently focused terminal pane.",
    shortcut: "\u2318W",
    action: () => {
      const id = surfaceManager.getActiveSurfaceId();
      if (id) rpc.send("closeSurface", { surfaceId: id });
    },
  },
  {
    id: "toggle-sidebar",
    category: "View",
    label: "Toggle Sidebar",
    description: "Show or hide workspace navigation and activity.",
    shortcut: "\u2318B",
    action: () => surfaceManager.toggleSidebar(),
  },
  {
    id: "focus-left",
    category: "Navigation",
    label: "Focus Pane Left",
    description: "Move focus to the pane on the left.",
    shortcut: "\u2318\u2325\u2190",
    action: () => surfaceManager.focusDirection("left"),
  },
  {
    id: "focus-right",
    category: "Navigation",
    label: "Focus Pane Right",
    description: "Move focus to the pane on the right.",
    shortcut: "\u2318\u2325\u2192",
    action: () => surfaceManager.focusDirection("right"),
  },
  {
    id: "focus-up",
    category: "Navigation",
    label: "Focus Pane Up",
    description: "Move focus to the pane above.",
    shortcut: "\u2318\u2325\u2191",
    action: () => surfaceManager.focusDirection("up"),
  },
  {
    id: "focus-down",
    category: "Navigation",
    label: "Focus Pane Down",
    description: "Move focus to the pane below.",
    shortcut: "\u2318\u2325\u2193",
    action: () => surfaceManager.focusDirection("down"),
  },
  {
    id: "next-workspace",
    category: "Workspace",
    label: "Next Workspace",
    description: "Jump to the next workspace in the stack.",
    shortcut: "\u2303\u2318]",
    action: () => surfaceManager.nextWorkspace(),
  },
  {
    id: "prev-workspace",
    category: "Workspace",
    label: "Previous Workspace",
    description: "Jump to the previous workspace.",
    shortcut: "\u2303\u2318[",
    action: () => surfaceManager.prevWorkspace(),
  },
  {
    id: "maximize",
    category: "Window",
    label: "Toggle Maximize",
    description: "Expand or restore the main window.",
    action: () => rpc.send("toggleMaximize"),
  },
]);

function syncSidebarState() {
  const collapsed = document
    .getElementById("sidebar")!
    .classList.contains("collapsed");
  document
    .getElementById("terminal-container")!
    .classList.toggle("sidebar-collapsed", collapsed);
}

window.addEventListener("ht-sidebar-toggle", () => {
  syncSidebarState();
  setTimeout(() => surfaceManager.resizeAll(), 200);
});

window.addEventListener("ht-surface-focused", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) {
    rpc.send("focusSurface", { surfaceId: detail.surfaceId });
  }
});

document.addEventListener("keydown", (e) => {
  if (e.metaKey && e.shiftKey && e.key === "p") {
    e.preventDefault();
    palette.toggle();
    return;
  }

  if (palette.isVisible()) return;

  if (e.metaKey && !e.shiftKey && e.key === "b") {
    e.preventDefault();
    surfaceManager.toggleSidebar();
    syncSidebarState();
    setTimeout(() => surfaceManager.resizeAll(), 200);
    return;
  }

  if (e.metaKey && !e.shiftKey && e.key === "n") {
    e.preventDefault();
    rpc.send("createSurface", {});
    return;
  }

  if (e.metaKey && !e.shiftKey && e.key === "d") {
    e.preventDefault();
    rpc.send("splitSurface", { direction: "horizontal" });
    return;
  }

  if (e.metaKey && e.shiftKey && e.key === "D") {
    e.preventDefault();
    rpc.send("splitSurface", { direction: "vertical" });
    return;
  }

  if (e.metaKey && !e.shiftKey && e.key === "w") {
    e.preventDefault();
    const id = surfaceManager.getActiveSurfaceId();
    if (id) rpc.send("closeSurface", { surfaceId: id });
    return;
  }

  if (e.metaKey && e.shiftKey && e.key === "W") {
    e.preventDefault();
    const id = surfaceManager.getActiveSurfaceId();
    if (id) rpc.send("closeSurface", { surfaceId: id });
    return;
  }

  if (e.metaKey && e.altKey && e.key === "ArrowLeft") {
    e.preventDefault();
    surfaceManager.focusDirection("left");
    return;
  }
  if (e.metaKey && e.altKey && e.key === "ArrowRight") {
    e.preventDefault();
    surfaceManager.focusDirection("right");
    return;
  }
  if (e.metaKey && e.altKey && e.key === "ArrowUp") {
    e.preventDefault();
    surfaceManager.focusDirection("up");
    return;
  }
  if (e.metaKey && e.altKey && e.key === "ArrowDown") {
    e.preventDefault();
    surfaceManager.focusDirection("down");
    return;
  }

  if (e.ctrlKey && e.metaKey && e.key === "]") {
    e.preventDefault();
    surfaceManager.nextWorkspace();
    return;
  }

  if (e.ctrlKey && e.metaKey && e.key === "[") {
    e.preventDefault();
    surfaceManager.prevWorkspace();
    return;
  }

  if (e.metaKey && !e.shiftKey && !e.ctrlKey && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    surfaceManager.focusWorkspaceByIndex(parseInt(e.key) - 1);
    return;
  }

  if (e.metaKey && e.key === "c") {
    const term = surfaceManager.getActiveTerm();
    if (term) {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
        term.clearSelection();
        e.preventDefault();
      }
    }
    return;
  }

  if (e.metaKey && e.key === "v") {
    e.preventDefault();
    const id = surfaceManager.getActiveSurfaceId();
    if (id) {
      navigator.clipboard.readText().then((text) => {
        if (text) rpc.send("writeStdin", { surfaceId: id, data: text });
      });
    }
  }
});

document.getElementById("titlebar")!.addEventListener("dblclick", () => {
  rpc.send("toggleMaximize");
});

window.addEventListener("ht-close-surface", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) {
    rpc.send("closeSurface", { surfaceId: detail.surfaceId });
  }
});

window.addEventListener("ht-new-workspace", () => {
  rpc.send("createSurface", {});
});

window.addEventListener("ht-clear-notifications", () => {
  rpc.send("clearNotifications");
});

window.addEventListener("ht-clear-logs", () => {
  surfaceManager.clearLogs();
});

window.addEventListener("ht-split", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId && detail?.direction) {
    surfaceManager.focusSurface(detail.surfaceId);
    rpc.send("splitSurface", { direction: detail.direction });
  }
});

function handleSocketAction(action: string, payload: Record<string, unknown>) {
  switch (action) {
    case "selectWorkspace": {
      const id = payload["workspaceId"] as string;
      if (id) surfaceManager.focusWorkspaceById(id);
      break;
    }
    case "closeWorkspace": {
      const id = payload["workspaceId"] as string;
      if (id) surfaceManager.closeWorkspaceById(id);
      break;
    }
    case "renameWorkspace": {
      const id = payload["workspaceId"] as string;
      const name = payload["name"] as string;
      if (id && name) surfaceManager.renameWorkspace(id, name);
      break;
    }
    case "nextWorkspace":
      surfaceManager.nextWorkspace();
      break;
    case "prevWorkspace":
      surfaceManager.prevWorkspace();
      break;
    case "focusSurface": {
      const id = payload["surfaceId"] as string;
      if (id) surfaceManager.focusSurface(id);
      break;
    }
    case "setStatus":
      surfaceManager.setStatus(
        payload["workspaceId"] as string | undefined,
        payload["key"] as string,
        payload["value"] as string,
        payload["icon"] as string | undefined,
        payload["color"] as string | undefined,
      );
      break;
    case "clearStatus":
      surfaceManager.clearStatus(
        payload["workspaceId"] as string | undefined,
        payload["key"] as string,
      );
      break;
    case "setProgress":
      surfaceManager.setProgress(
        payload["workspaceId"] as string | undefined,
        payload["value"] as number,
        payload["label"] as string | undefined,
      );
      break;
    case "clearProgress":
      surfaceManager.clearProgress(
        payload["workspaceId"] as string | undefined,
      );
      break;
    case "readScreen": {
      const sid =
        (payload["surfaceId"] as string) ||
        surfaceManager.getActiveSurfaceId() ||
        "";
      const content = surfaceManager.readScreen(
        sid,
        payload["lines"] as number | undefined,
        payload["scrollback"] as boolean | undefined,
      );
      rpc.send("readScreenResponse", {
        reqId: payload["reqId"] as string,
        content,
      });
      break;
    }
    case "notification": {
      const notifs =
        (payload["notifications"] as {
          id: string;
          title: string;
          body: string;
          time: number;
        }[]) || [];
      surfaceManager.getSidebar().setNotifications(notifs);
      break;
    }
    case "log": {
      surfaceManager.addLog(
        payload["workspaceId"] as string | undefined,
        (payload["level"] as string) || "info",
        (payload["message"] as string) || "",
        payload["source"] as string | undefined,
      );
      break;
    }
  }
  syncWorkspaceState();
}

function syncWorkspaceState() {
  const state = surfaceManager.getWorkspaceState();
  rpc.send("workspaceStateSync", state);
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSyncWorkspaceState() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncWorkspaceState, 100);
}

window.addEventListener("ht-workspace-changed", scheduleSyncWorkspaceState);
