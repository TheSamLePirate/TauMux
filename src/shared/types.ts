import type { ElectrobunRPCSchema } from "electrobun/bun";

// === Sideband Protocol Types ===

export type ContentType =
  | "image"
  | "svg"
  | "html"
  | "canvas2d"
  | "update"
  | "clear";
export type PositionType = "inline" | "float" | "overlay";

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

// === RPC Schema ===
// bun.messages = what bun RECEIVES from webview
// webview.messages = what webview RECEIVES from bun

export interface HyperTermRPC extends ElectrobunRPCSchema {
  bun: {
    requests: Record<string, never>;
    messages: {
      // Terminal I/O (routed by surfaceId)
      writeStdin: { surfaceId: string; data: string };
      resize: { surfaceId: string; cols: number; rows: number };

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
        }[];
        activeWorkspaceId: string | null;
      };

      // Notifications
      clearNotifications: void;

      // Window
      toggleMaximize: void;
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

      // Socket API dispatched actions (bun → webview)
      socketAction: { action: string; payload: Record<string, unknown> };
    };
  };
}
