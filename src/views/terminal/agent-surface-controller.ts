// AgentSurfaceController — the pi-agent-pane concern extracted out of the
// SurfaceManager god object (full_app_review_2026-05.md §3, H10). Same
// controller pattern as Browser/Telegram/Editor. Agent panes have no
// destroy hook (cleanup is the generic container.remove()).

import { htEvents } from "../../shared/event-bus";
import {
  type AgentPaneView,
  createAgentPaneView,
  agentPanelHandleEvent,
  agentPanelAddUserMessage,
  agentPanelFocusInput,
} from "./agent-panel";
import type { SurfaceView } from "./surface-manager";

export type AgentImage = {
  type: "image";
  data: string;
  mimeType: string;
  fileName?: string;
};

export interface AgentControllerDeps {
  /** NB: agent handlers look up by agentId (the agent surface's key). */
  getSurface: (id: string) => SurfaceView | undefined;
  focusSurface: (id: string) => void;
}

export class AgentSurfaceController {
  constructor(private deps: AgentControllerDeps) {}

  /** Create + wire an agent pane view. The caller attaches `view.container`
   *  to the DOM and wraps it in a SurfaceView. */
  createAgentView(surfaceId: string, agentId: string): AgentPaneView {
    return createAgentPaneView(surfaceId, agentId, {
      onSendPrompt: (aid, message, images) => {
        htEvents.emit("ht-agent-prompt", { agentId: aid, message, images });
      },
      onAbort: (aid) => {
        htEvents.emit("ht-agent-abort", { agentId: aid });
      },
      onSetModel: (aid, provider, modelId) => {
        htEvents.emit("ht-agent-set-model", {
          agentId: aid,
          provider,
          modelId,
        });
      },
      onSetThinking: (aid, level) => {
        htEvents.emit("ht-agent-set-thinking", { agentId: aid, level });
      },
      onNewSession: (aid) => {
        htEvents.emit("ht-agent-new-session", { agentId: aid });
      },
      onCompact: (aid) => {
        htEvents.emit("ht-agent-compact", { agentId: aid });
      },
      onClose: (sid) => {
        htEvents.emit("ht-close-surface", { surfaceId: sid });
      },
      onSplit: (sid, direction) => {
        htEvents.emit("ht-split", { surfaceId: sid, direction });
      },
      onFocus: (sid) => {
        this.deps.focusSurface(sid);
      },
      onGetModels: (aid) => {
        htEvents.emit("ht-agent-get-models", { agentId: aid });
      },
      onGetState: (aid) => {
        htEvents.emit("ht-agent-get-state", { agentId: aid });
      },
      onRestart: (sid, opts) => {
        htEvents.emit("ht-agent-restart", { surfaceId: sid, ...opts });
      },
    });
  }

  /** Route a pi agent event to the matching agent pane. */
  handleEvent(agentId: string, event: Record<string, unknown>): void {
    const view = this.deps.getSurface(agentId);
    if (!view?.agentView) return;
    agentPanelHandleEvent(view.agentView, event);
  }

  /** Echo a user message into an agent panel's transcript. */
  addUserMessage(agentId: string, text: string, images?: AgentImage[]): void {
    const view = this.deps.getSurface(agentId);
    if (!view?.agentView) return;
    agentPanelAddUserMessage(view.agentView, text, images);
  }

  /** Focus the agent panel input. */
  focusInput(agentId: string): void {
    const view = this.deps.getSurface(agentId);
    if (!view?.agentView) return;
    agentPanelFocusInput(view.agentView);
  }
}
