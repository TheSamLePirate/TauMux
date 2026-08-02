// ClaudeSurfaceController — the Claude-pane concern kept out of the
// SurfaceManager god object (same extraction pattern as
// TelegramSurfaceController). SurfaceManager keeps the generic surface
// machinery and delegates Claude-specific work here.

import { htEvents } from "../../shared/event-bus";
import type { ClaudeAgentSessionWire } from "../../shared/types";
import {
  type ClaudePaneView,
  claudePaneApplyEvent,
  claudePaneApplyExit,
  claudePaneApplyHistory,
  claudePaneApplySessions,
  claudePaneReset,
  createClaudePaneView,
  destroyClaudePaneView,
} from "./claude-agent-pane";
import type { SurfaceView } from "./surface-manager";

export interface ClaudeControllerDeps {
  getSurface: (id: string) => SurfaceView | undefined;
  allSurfaces: () => Iterable<SurfaceView>;
  focusSurface: (id: string) => void;
  /** Pulse the glow ring on an unfocused pane whose turn just ended. */
  notifyGlow: (surfaceId: string) => void;
  getFocusedSurfaceId: () => string | null;
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

  destroyView(view: ClaudePaneView): void {
    destroyClaudePaneView(view);
  }

  /** Route one SDK event to its pane; glow on turn end when unfocused. */
  handleEvent(surfaceId: string, event: unknown): void {
    const view = this.deps.getSurface(surfaceId);
    if (!view?.claudeView) return;
    claudePaneApplyEvent(view.claudeView, event);
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
