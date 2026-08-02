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
  claudePaneApplySessions,
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
      onListSessions: () => {
        htEvents.emit("ht-claude-agent-list-sessions", undefined);
      },
      onResume: (sessionId, fork) => {
        // Resume opens a NEW pane bound to the old session (the SDK
        // cannot swap sessions inside a live query stream).
        htEvents.emit("ht-claude-agent-create", {
          resume: sessionId,
          fork,
          split: true,
          direction: "right",
        });
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

  /** Session list reply — fills every open resume menu (cheap; usually
   *  exactly one pane has the menu open). */
  handleSessions(sessions: ClaudeAgentSessionWire[]): void {
    for (const view of this.deps.allSurfaces()) {
      if (view.claudeView) {
        claudePaneApplySessions(view.claudeView, sessions);
      }
    }
  }
}
