/**
 * Triple-A A1 — typed contract for webview-side socket actions.
 *
 * Before this module existed, the bun-side `dispatch(action: string,
 * payload: Record<string, unknown>)` in `src/bun/index.ts` (~180 LOC)
 * cast every payload field at the use site (`payload["surfaceId"] as
 * string | undefined`). The same actions also have typed RPC handlers
 * — the dispatcher bypassed all of that typing.
 *
 * The fix: declare the discriminated union here, expose a
 * `ActionPayloadByAction` lookup the dispatcher uses to narrow each
 * `case` body. Adding a new action without declaring its payload shape
 * is now a TS error.
 *
 * The runtime envelope still arrives untyped at the boundary (the
 * socket protocol delivers JSON). The cast inside each case is
 * contractually safe because the `switch (action)` above it is the
 * discriminator — same pattern as `protocol-dispatcher.ts`.
 */

export type WebviewActionEnvelope =
  | { action: "createSurface"; payload: CreateSurfacePayload }
  | { action: "splitSurface"; payload: SplitSurfacePayload }
  | { action: "closeSurface"; payload: CloseSurfacePayload }
  | { action: "renameSurface"; payload: RenameSurfacePayload }
  | { action: "runScript"; payload: RunScriptPayload }
  | { action: "notification"; payload: NotificationPayload }
  | { action: "setStatus"; payload: SidebarActionPayload }
  | { action: "clearStatus"; payload: SidebarActionPayload }
  | { action: "setProgress"; payload: SidebarActionPayload }
  | { action: "clearProgress"; payload: SidebarActionPayload }
  | { action: "log"; payload: SidebarActionPayload }
  | { action: "createBrowserSurface"; payload: CreateBrowserSurfacePayload }
  | { action: "createAgentSurface"; payload: CreateAgentSurfacePayload }
  | { action: "splitAgentSurface"; payload: SplitAgentSurfacePayload }
  | { action: "splitBrowserSurface"; payload: SplitBrowserSurfacePayload }
  | { action: "createEditorSurface"; payload: EditorSurfacePayload }
  | { action: "splitEditorSurface"; payload: SplitEditorSurfacePayload }
  | { action: "openExternal"; payload: OpenExternalPayload };

export type WebviewActionKind = WebviewActionEnvelope["action"];

/** Maps each `action` literal to its declared payload shape. The
 *  dispatcher uses this to give each `case` body a typed `p` without
 *  resorting to `any` or hand-cast `as` chains. */
export type ActionPayloadByAction = {
  [E in WebviewActionEnvelope as E["action"]]: E["payload"];
};

// ---------------------------------------------------------------------------
// Per-action payloads. Fields stay optional where the runtime is
// permissive (e.g. `surfaceId` / `surface_id` snake-case aliases the
// CLI bridge sends). Tightening these is a deliberate per-action
// effort owned by P7 polish; the contract is the discrimination.
// ---------------------------------------------------------------------------

export interface CreateSurfacePayload {
  cwd?: string;
}

export interface SplitSurfacePayload {
  direction: "horizontal" | "vertical";
  surfaceId?: string;
  /** Snake-case alias the `ht` CLI sometimes sends. */
  surface_id?: string;
  cwd?: string;
}

export interface CloseSurfacePayload {
  surfaceId?: string;
}

export interface RenameSurfacePayload {
  surfaceId?: unknown;
  title?: unknown;
}

export interface RunScriptPayload {
  workspaceId?: string;
  cwd?: string;
  command?: string;
  scriptKey?: string;
}

export interface NotificationPayload {
  /** Newly-created notification entry (server emits on add). */
  latest?: Record<string, unknown>;
  /** Id of a single dismissed notification (server emits on remove). */
  dismissed?: string;
  /** Empty array signals "clear all". */
  notifications?: unknown[];
}

/** Sidebar status / progress / log actions all share the same payload
 *  surface (they're forwarded to the webview as a single `sidebarAction`
 *  event). The dispatcher routes `setStatus` to the plan-status bridge
 *  in addition to the broadcast. */
export interface SidebarActionPayload {
  key?: unknown;
  value?: unknown;
  workspaceId?: string;
  /** Snake-case alias from the `ht` CLI. */
  workspace_id?: string;
  surfaceId?: string;
  surface_id?: string;
  [extra: string]: unknown;
}

export interface CreateBrowserSurfacePayload {
  url?: string;
}

export interface CreateAgentSurfacePayload {
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
}

export interface SplitAgentSurfacePayload extends CreateAgentSurfacePayload {
  direction?: "horizontal" | "vertical";
}

export interface SplitBrowserSurfacePayload {
  direction?: "horizontal" | "vertical";
  url?: string;
}

export interface EditorSurfacePayload {
  path?: string;
  cwd?: string;
  create?: boolean;
}

export interface SplitEditorSurfacePayload extends EditorSurfacePayload {
  direction?: "horizontal" | "vertical";
}

export interface OpenExternalPayload {
  url?: unknown;
}
