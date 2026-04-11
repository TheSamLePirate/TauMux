import type { ElectrobunRPCSchema } from "electrobun/bun";
import type { AppSettings } from "./settings";

// === Pane Layout Types (shared between webview, bun, and web clients) ===

export interface PaneSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PaneNode, PaneNode];
}

export interface PaneLeaf {
  type: "leaf";
  surfaceId: string;
}

export type PaneNode = PaneSplit | PaneLeaf;

export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// === Layout Persistence Types ===

export interface PersistedWorkspace {
  name: string;
  color: string;
  layout: PaneNode;
  focusedSurfaceId: string | null;
}

export interface PersistedLayout {
  activeWorkspaceIndex: number;
  workspaces: PersistedWorkspace[];
  sidebarVisible: boolean;
}

// === Sideband Protocol Types ===

export type ContentType =
  | "image"
  | "svg"
  | "html"
  | "canvas2d"
  | "update"
  | "clear";
export type PositionType = "inline" | "float" | "overlay" | "fixed";

export interface SidebandMetaMessage {
  id: string;
  type: ContentType;
  format?: string;
  position?: PositionType;
  anchor?: "cursor" | { row: number };
  x?: number;
  y?: number;
  width?: number | "auto";
  height?: number | "auto";
  interactive?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  byteLength?: number;
  zIndex?: number;
  opacity?: number;
  borderRadius?: number;
  data?: string;
}

export interface PanelEvent {
  id: string;
  event: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  button?: number;
  buttons?: number;
  deltaX?: number;
  deltaY?: number;
  type?: string;
  cols?: number;
  rows?: number;
  pxWidth?: number;
  pxHeight?: number;
}

export interface WorkspaceContextMenuRequest {
  kind: "workspace";
  workspaceId: string;
  name: string;
  color?: string;
}

export interface SurfaceContextMenuRequest {
  kind: "surface";
  surfaceId: string;
  title: string;
  workspaceId?: string;
}

export type NativeContextMenuRequest =
  | WorkspaceContextMenuRequest
  | SurfaceContextMenuRequest;

// === RPC Schema ===
// bun.messages = what bun RECEIVES from webview
// webview.messages = what webview RECEIVES from bun

export interface HyperTermRPC extends ElectrobunRPCSchema {
  bun: {
    requests: Record<string, never>;
    messages: {
      // Clipboard (webview → bun)
      clipboardWrite: { text: string };
      clipboardPaste: { surfaceId: string };

      // Terminal I/O (routed by surfaceId)
      writeStdin: { surfaceId: string; data: string };
      resize: { surfaceId: string; cols: number; rows: number };
      viewportSize: { width: number; height: number };

      // Surface lifecycle
      createSurface: { cwd?: string };
      splitSurface: { direction: "horizontal" | "vertical" };
      closeSurface: { surfaceId: string };
      focusSurface: { surfaceId: string };

      // Panels
      panelEvent: PanelEvent & { surfaceId: string };

      // Read screen response (webview → bun)
      readScreenResponse: { reqId: string; content: string };

      // Workspace state sync (webview → bun for socket API)
      workspaceStateSync: {
        workspaces: {
          id: string;
          name: string;
          color: string;
          surfaceIds: string[];
          focusedSurfaceId: string | null;
          layout: PaneNode;
        }[];
        activeWorkspaceId: string | null;
      };

      // Sidebar
      sidebarToggle: { visible: boolean };

      // Notifications
      clearNotifications: void;

      // Native menus
      showContextMenu: NativeContextMenuRequest;

      // Web mirror
      toggleWebServer: void;

      // Window
      toggleMaximize: void;

      // Settings
      updateSettings: { settings: Partial<AppSettings> };
    };
  };
  webview: {
    requests: {
      readScreen: {
        params: {
          surfaceId: string;
          lines?: number;
          scrollback?: boolean;
        };
        response: string;
      };
    };
    messages: {
      // Terminal I/O (routed by surfaceId)
      writeStdout: { surfaceId: string; data: string };

      // Surface lifecycle
      surfaceCreated: {
        surfaceId: string;
        title: string;
        splitFrom?: string;
        direction?: "horizontal" | "vertical";
      };
      surfaceClosed: { surfaceId: string };

      // Sideband (routed by surfaceId)
      sidebandMeta: SidebandMetaMessage & { surfaceId: string };
      sidebandData: { surfaceId: string; id: string; data: string };

      // Web server status
      webServerStatus: { running: boolean; port: number; url?: string };

      // Layout persistence
      restoreLayout: {
        layout: PersistedLayout;
        surfaceMapping: Record<string, string>;
      };

      // Settings
      restoreSettings: { settings: AppSettings };
      settingsChanged: { settings: AppSettings };

      // Socket API dispatched actions (bun → webview)
      socketAction: { action: string; payload: Record<string, unknown> };
    };
  };
}
