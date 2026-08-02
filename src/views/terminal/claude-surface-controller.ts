// ClaudeSurfaceController — the Claude-pane concern kept out of the
// SurfaceManager god object (same extraction pattern as
// TelegramSurfaceController). SurfaceManager keeps the generic surface
// machinery and delegates Claude-specific work here.

import { htEvents } from "../../shared/event-bus";
import type { ClaudeAgentSessionWire } from "../../shared/types";
import {
  type ClaudePaneView,
  claudePaneApplyEvent,
  digestClaudeEvent,
  claudePaneApplyExit,
  claudePaneApplyHistory,
  claudePaneApplySessions,
  claudePaneReset,
  claudePaneSetCwd,
  createClaudePaneView,
  destroyClaudePaneView,
} from "./claude-agent-pane";
import type { SurfaceView } from "./surface-manager";
import type { SurfaceMetadata } from "../../shared/types";

/** Minimal metadata snapshot for a Claude pane: it owns no process, so
 *  everything except the cwd is empty. Lets the sidebar card, cwd chip,
 *  and status bar show the session's real directory instead of
 *  "resolving…" — the metadata poller never emits for a pane with no
 *  pid, so nothing overwrites this. */
export function syntheticClaudeMetadata(
  cwd: string,
  now = Date.now(),
): SurfaceMetadata {
  return {
    pid: 0,
    foregroundPid: 0,
    cwd,
    tree: [],
    listeningPorts: [],
    git: null,
    packageJson: null,
    cargoToml: null,
    updatedAt: now,
  };
}

export interface ClaudeControllerDeps {
  getSurface: (id: string) => SurfaceView | undefined;
  allSurfaces: () => Iterable<SurfaceView>;
  focusSurface: (id: string) => void;
  /** Pulse the glow ring on an unfocused pane whose turn just ended. */
  notifyGlow: (surfaceId: string) => void;
  getFocusedSurfaceId: () => string | null;
  /** Publish the session's cwd as surface metadata so the sidebar card,
   *  cwd chip, and status bar show the real directory instead of
   *  "resolving…". Claude panes have no pid, so the metadata poller
   *  never produces a snapshot for them. */
  publishCwd: (surfaceId: string, cwd: string) => void;
}

export class ClaudeSurfaceController {
  constructor(private deps: ClaudeControllerDeps) {}

  createClaudeView(surfaceId: string): ClaudePaneView {
    return createClaudePaneView(surfaceId, {
      onPrompt: (sid, text) => {
        htEvents.emit("ht-claude-agent-prompt", { surfaceId: sid, text });
      },
      onInterrupt: (sid) => {
        htEvents.emit("ht-claude-agent-interrupt", { surfaceId: sid });
      },
      onSetMode: (sid, mode) => {
        htEvents.emit("ht-claude-agent-set-mode", { surfaceId: sid, mode });
      },
      onSetModel: (sid, model) => {
        htEvents.emit("ht-claude-agent-set-model", {
          surfaceId: sid,
          model,
        });
      },
      onListSessions: () => {
        htEvents.emit("ht-claude-agent-list-sessions", undefined);
      },
      // Pane v2 — resume swaps the session IN PLACE (bun rebinds the
      // agent under the same surface id and replays history).
      onResume: (sid, sessionId, fork) => {
        const view = this.deps.getSurface(sid)?.claudeView;
        if (view) claudePaneReset(view);
        htEvents.emit("ht-claude-agent-new-session", {
          surfaceId: sid,
          resume: sessionId,
          fork,
        });
      },
      onNewSession: (sid) => {
        const view = this.deps.getSurface(sid)?.claudeView;
        if (view) claudePaneReset(view);
        htEvents.emit("ht-claude-agent-new-session", { surfaceId: sid });
      },
      onClose: (sid) => {
        htEvents.emit("ht-claude-agent-close", { surfaceId: sid });
        htEvents.emit("ht-close-surface", { surfaceId: sid });
      },
      onSplit: (sid, direction) => {
        htEvents.emit("ht-split", { surfaceId: sid, direction });
      },
      onFocus: (sid) => this.deps.focusSurface(sid),
    });
  }

  /** Seed the pane's cwd from the create payload so it reads correctly
   *  before the first turn (the SDK only reports cwd on `init`). */
  setInitialCwd(surfaceId: string, cwd: string): void {
    const view = this.deps.getSurface(surfaceId);
    if (view?.claudeView) claudePaneSetCwd(view.claudeView, cwd);
    this.deps.publishCwd(surfaceId, cwd);
  }

  destroyView(view: ClaudePaneView): void {
    destroyClaudePaneView(view);
  }

  /** Route one SDK event to its pane; glow on turn end when unfocused. */
  handleEvent(surfaceId: string, event: unknown): void {
    const view = this.deps.getSurface(surfaceId);
    if (!view?.claudeView) return;
    claudePaneApplyEvent(view.claudeView, event);
    // The SDK's init message is the first place the session's real cwd
    // appears — mirror it into surface metadata for the sidebar.
    for (const op of digestClaudeEvent(event)) {
      if (op.kind === "meta" && op.cwd) this.deps.publishCwd(surfaceId, op.cwd);
    }
    const type = (event as { type?: string } | null)?.type;
    if (type === "result" && surfaceId !== this.deps.getFocusedSurfaceId()) {
      this.deps.notifyGlow(surfaceId);
    }
  }

  handleExit(surfaceId: string, error: string | null): void {
    const view = this.deps.getSurface(surfaceId);
    if (view?.claudeView) claudePaneApplyExit(view.claudeView, error);
  }

  /** Replayed transcript of a just-resumed session (pane v2). */
  handleHistory(
    surfaceId: string,
    sessionId: string,
    messages: unknown[],
  ): void {
    const view = this.deps.getSurface(surfaceId);
    if (view?.claudeView) {
      claudePaneApplyHistory(view.claudeView, sessionId, messages);
    }
  }

  /** Session list reply — fills every open sessions menu (cheap;
   *  usually exactly one pane has the menu open). */
  handleSessions(sessions: ClaudeAgentSessionWire[]): void {
    for (const view of this.deps.allSurfaces()) {
      if (view.claudeView) {
        claudePaneApplySessions(view.claudeView, sessions);
      }
    }
  }
}
