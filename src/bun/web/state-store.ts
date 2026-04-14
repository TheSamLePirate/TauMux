import type { SurfaceMetadata, SidebandMetaMessage } from "../../shared/types";
import type {
  LogEntry,
  NotificationEntry,
  PanelState,
  SidebarProgressEntry,
  SidebarStatusEntry,
} from "../../shared/web-protocol";

// Max entries kept per category. Clients get the same bounded view the
// native sidebar shows, so these match the webview's own caps.
const MAX_NOTIFICATIONS = 50;
const MAX_LOGS = 200;

/**
 * Server-side cache of the sidebar / metadata / panel state that used to
 * live only in the native webview. Every broadcast passes through here
 * so the web server can serve a complete snapshot to new clients.
 */
export class WebStateStore {
  private metadata: Record<string, SurfaceMetadata> = {};
  private panels: Record<string, PanelState> = {};
  private notifications: NotificationEntry[] = [];
  private logs: LogEntry[] = [];
  private status: Record<string, Record<string, SidebarStatusEntry>> = {};
  private progress: Record<string, SidebarProgressEntry> = {};
  private notifCounter = 0;

  setMetadata(surfaceId: string, metadata: SurfaceMetadata): void {
    this.metadata[surfaceId] = metadata;
  }

  forgetSurface(surfaceId: string): void {
    delete this.metadata[surfaceId];
    for (const id in this.panels) {
      if (this.panels[id]!.surfaceId === surfaceId) delete this.panels[id];
    }
  }

  applySidebandMeta(surfaceId: string, meta: SidebandMetaMessage): void {
    const id = meta.id;
    if (!id) return;
    if (meta.type === "clear") {
      delete this.panels[id];
      return;
    }
    const existing = this.panels[id];
    if (meta.type === "update" && existing) {
      this.panels[id] = {
        surfaceId: existing.surfaceId,
        meta: { ...existing.meta, ...meta },
      };
      return;
    }
    this.panels[id] = { surfaceId, meta };
  }

  addNotification(entry: Omit<NotificationEntry, "id" | "at">): void {
    const n: NotificationEntry = {
      id: `n:${++this.notifCounter}`,
      at: Date.now(),
      title: entry.title,
      body: entry.body,
      surfaceId: entry.surfaceId,
    };
    this.notifications.push(n);
    if (this.notifications.length > MAX_NOTIFICATIONS) {
      this.notifications.splice(
        0,
        this.notifications.length - MAX_NOTIFICATIONS,
      );
    }
  }

  clearNotifications(): void {
    this.notifications = [];
  }

  applySidebarAction(
    action: string,
    payload: Record<string, unknown>,
    activeWorkspaceId: string | null,
  ): void {
    const wsIdRaw = payload["workspaceId"];
    const wsId =
      (typeof wsIdRaw === "string" && wsIdRaw) || activeWorkspaceId || "";
    if (!wsId) return;
    if (action === "setStatus") {
      const key = payload["key"];
      if (typeof key !== "string" || !key) return;
      if (!this.status[wsId]) this.status[wsId] = {};
      this.status[wsId][key] = {
        value: String(payload["value"] ?? ""),
        icon:
          typeof payload["icon"] === "string"
            ? (payload["icon"] as string)
            : undefined,
        color:
          typeof payload["color"] === "string"
            ? (payload["color"] as string)
            : undefined,
      };
    } else if (action === "clearStatus") {
      const key = payload["key"];
      if (typeof key === "string" && this.status[wsId]) {
        delete this.status[wsId][key];
      }
    } else if (action === "setProgress") {
      this.progress[wsId] = {
        value: Number(payload["value"] ?? 0),
        label:
          typeof payload["label"] === "string"
            ? (payload["label"] as string)
            : undefined,
      };
    } else if (action === "clearProgress") {
      delete this.progress[wsId];
    } else if (action === "log") {
      const level = payload["level"];
      const entry: LogEntry = {
        level:
          level === "error" ||
          level === "warning" ||
          level === "success" ||
          level === "info"
            ? level
            : "info",
        message: String(payload["message"] ?? ""),
        source:
          typeof payload["source"] === "string"
            ? (payload["source"] as string)
            : undefined,
        at: Date.now(),
      };
      this.logs.push(entry);
      if (this.logs.length > MAX_LOGS) {
        this.logs.splice(0, this.logs.length - MAX_LOGS);
      }
    }
  }

  forgetWorkspace(workspaceId: string): void {
    delete this.status[workspaceId];
    delete this.progress[workspaceId];
  }

  getMetadata(): Record<string, SurfaceMetadata> {
    return this.metadata;
  }

  getPanels(): Record<string, PanelState> {
    return this.panels;
  }

  getNotifications(): NotificationEntry[] {
    return this.notifications;
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  getStatus(): Record<string, Record<string, SidebarStatusEntry>> {
    return this.status;
  }

  getProgress(): Record<string, SidebarProgressEntry> {
    return this.progress;
  }
}
