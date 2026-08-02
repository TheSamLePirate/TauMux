/**
 * claude-agent-pane.ts — DOM construction for the native Claude Code
 * pane (august-plan M3 / WS5).
 *
 * Mirrors telegram-pane.ts structurally: a `surface-bar` row, a header
 * toolbar (model · permission mode · cost/ctx meters · interrupt), a
 * transcript region, and a composer. No terminal, no PTY — turns flow
 * over the claudeAgent* RPC messages; the pane renders the SDKMessage
 * types it knows and ignores the rest (the SDK grows message types
 * faster than we do — unknown ≠ error).
 *
 * `digestClaudeEvent` is a pure function (event → transcript ops) so
 * tests drive it without DOM; the view applies ops to DOM nodes.
 */

import { createIcon, type IconName } from "./icons";
import type { ClaudeAgentSessionWire } from "../../shared/types";

export interface ClaudePaneCallbacks {
  onPrompt: (surfaceId: string, text: string) => void;
  onInterrupt: (surfaceId: string) => void;
  onSetMode: (surfaceId: string, mode: string) => void;
  onListSessions: () => void;
  onResume: (sessionId: string, fork: boolean) => void;
  onClose: (surfaceId: string) => void;
  onFocus: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => void;
}

/** One transcript mutation derived from an SDK event. */
export type ClaudeTranscriptOp =
  | { kind: "user-text"; text: string }
  | { kind: "assistant-text"; text: string; append: boolean }
  | { kind: "tool-start"; toolName: string; summary: string }
  | {
      kind: "result";
      costUsd: number | null;
      durationMs: number | null;
      isError: boolean;
    }
  | { kind: "meta"; model?: string; sessionId?: string; mode?: string }
  | { kind: "none" };

/** Pure: map one SDKMessage (as untyped JSON) to a transcript op. */
export function digestClaudeEvent(event: unknown): ClaudeTranscriptOp {
  const m = (event ?? {}) as Record<string, unknown>;
  const type = m["type"];

  if (type === "system" && m["subtype"] === "init") {
    return {
      kind: "meta",
      model: typeof m["model"] === "string" ? m["model"] : undefined,
      sessionId:
        typeof m["session_id"] === "string" ? m["session_id"] : undefined,
      mode:
        typeof m["permissionMode"] === "string"
          ? m["permissionMode"]
          : undefined,
    };
  }

  if (type === "user") {
    // Echo of our own turn (or a replay on resume).
    const msg = (m["message"] ?? {}) as Record<string, unknown>;
    const text = blocksToText(msg["content"]);
    // Tool results also arrive as user messages — skip those (the tool
    // card already showed the call; results are usually huge).
    if (
      !text ||
      (Array.isArray(msg["content"]) &&
        (msg["content"] as Array<Record<string, unknown>>).some(
          (b) => b["type"] === "tool_result",
        ))
    ) {
      return { kind: "none" };
    }
    return { kind: "user-text", text };
  }

  if (type === "assistant") {
    const msg = (m["message"] ?? {}) as Record<string, unknown>;
    const content = msg["content"];
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (block["type"] === "tool_use") {
          return {
            kind: "tool-start",
            toolName: String(block["name"] ?? "tool"),
            summary: toolSummary(
              String(block["name"] ?? ""),
              (block["input"] ?? {}) as Record<string, unknown>,
            ),
          };
        }
      }
    }
    const text = blocksToText(content);
    if (!text) return { kind: "none" };
    // Full assistant message — replaces whatever partials accumulated.
    return { kind: "assistant-text", text, append: false };
  }

  if (type === "stream_event") {
    // Partial streaming: text deltas append to the open assistant bubble.
    const ev = (m["event"] ?? {}) as Record<string, unknown>;
    if (ev["type"] === "content_block_delta") {
      const delta = (ev["delta"] ?? {}) as Record<string, unknown>;
      if (delta["type"] === "text_delta" && typeof delta["text"] === "string") {
        return { kind: "assistant-text", text: delta["text"], append: true };
      }
    }
    return { kind: "none" };
  }

  if (type === "result") {
    return {
      kind: "result",
      costUsd:
        typeof m["total_cost_usd"] === "number" ? m["total_cost_usd"] : null,
      durationMs:
        typeof m["duration_ms"] === "number" ? m["duration_ms"] : null,
      isError: m["subtype"] !== "success",
    };
  }

  return { kind: "none" };
}

function blocksToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<Record<string, unknown>>)
    .filter((b) => b["type"] === "text" && typeof b["text"] === "string")
    .map((b) => b["text"] as string)
    .join("");
}

/** One-line summary of a tool call for the card header. */
export function toolSummary(
  name: string,
  input: Record<string, unknown>,
): string {
  if (name === "Bash" && typeof input["command"] === "string") {
    return `$ ${truncate(input["command"], 120)}`;
  }
  const path = input["file_path"];
  if (typeof path === "string") return truncate(path, 120);
  const keys = Object.keys(input);
  return keys.length ? truncate(JSON.stringify(input), 120) : "";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;

export interface ClaudePaneView {
  id: string;
  surfaceType: "claude";
  container: HTMLDivElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
  callbacks: ClaudePaneCallbacks;
  _cleanup: (() => void)[];

  transcriptEl: HTMLDivElement;
  composerEl: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  interruptBtn: HTMLButtonElement;
  modelPillEl: HTMLSpanElement;
  costPillEl: HTMLSpanElement;
  modeSelectEl: HTMLSelectElement;
  resumeMenuEl: HTMLDivElement;
  /** Currently-open assistant bubble for streaming appends. */
  _openAssistantEl: HTMLDivElement | null;
  /** Session over — composer disabled. */
  _exited: boolean;
}

function makeActionBtn(
  label: string,
  icon: IconName,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "surface-bar-btn";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.appendChild(createIcon(icon, "", 12));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

export function createClaudePaneView(
  surfaceId: string,
  callbacks: ClaudePaneCallbacks,
): ClaudePaneView {
  const container = document.createElement("div");
  container.className = "surface-container surface-claude";
  container.dataset["surfaceId"] = surfaceId;
  container.dataset["surfaceType"] = "claude";
  container.style.display = "none";

  // ── Surface bar ──
  const bar = document.createElement("div");
  bar.className = "surface-bar";
  const barTitleWrap = document.createElement("div");
  barTitleWrap.className = "surface-bar-title-wrap";
  barTitleWrap.appendChild(createIcon("bolt", "surface-bar-icon", 12));
  const barTitle = document.createElement("span");
  barTitle.className = "surface-bar-title";
  barTitle.textContent = "Claude Code";
  barTitleWrap.appendChild(barTitle);
  bar.appendChild(barTitleWrap);

  const chipsEl = document.createElement("div");
  chipsEl.className = "surface-bar-chips";
  bar.appendChild(chipsEl);

  const barActions = document.createElement("div");
  barActions.className = "surface-bar-actions";
  barActions.append(
    makeActionBtn("Split Right", "splitHorizontal", () =>
      callbacks.onSplit(surfaceId, "horizontal"),
    ),
    makeActionBtn("Split Down", "splitVertical", () =>
      callbacks.onSplit(surfaceId, "vertical"),
    ),
  );
  const closeBtn = makeActionBtn("Close", "close", () =>
    callbacks.onClose(surfaceId),
  );
  closeBtn.classList.add("surface-bar-close");
  barActions.appendChild(closeBtn);
  bar.appendChild(barActions);
  container.appendChild(bar);

  // ── Toolbar: model · mode · cost · interrupt · resume ──
  const toolbar = document.createElement("div");
  toolbar.className = "claude-pane-toolbar";

  const modelPillEl = document.createElement("span");
  modelPillEl.className = "claude-pane-pill claude-pane-model";
  modelPillEl.textContent = "starting…";
  toolbar.appendChild(modelPillEl);

  const modeSelectEl = document.createElement("select");
  modeSelectEl.className = "claude-pane-mode-select";
  modeSelectEl.setAttribute("aria-label", "Permission mode");
  for (const mode of PERMISSION_MODES) {
    const opt = document.createElement("option");
    opt.value = mode;
    opt.textContent = mode;
    modeSelectEl.appendChild(opt);
  }
  modeSelectEl.addEventListener("change", () => {
    callbacks.onSetMode(surfaceId, modeSelectEl.value);
  });
  toolbar.appendChild(modeSelectEl);

  const costPillEl = document.createElement("span");
  costPillEl.className = "claude-pane-pill claude-pane-cost";
  costPillEl.textContent = "";
  toolbar.appendChild(costPillEl);

  const spacer = document.createElement("div");
  spacer.className = "claude-pane-toolbar-spacer";
  toolbar.appendChild(spacer);

  const resumeBtn = document.createElement("button");
  resumeBtn.className = "claude-pane-btn";
  resumeBtn.textContent = "Sessions";
  resumeBtn.title = "Resume a previous Claude Code session";
  toolbar.appendChild(resumeBtn);

  const interruptBtn = document.createElement("button");
  interruptBtn.className = "claude-pane-btn claude-pane-interrupt";
  interruptBtn.textContent = "Stop";
  interruptBtn.title = "Interrupt the current turn (Esc)";
  interruptBtn.disabled = true;
  interruptBtn.addEventListener("click", () =>
    callbacks.onInterrupt(surfaceId),
  );
  toolbar.appendChild(interruptBtn);

  container.appendChild(toolbar);

  // ── Resume dropdown (hidden until Sessions is clicked) ──
  const resumeMenuEl = document.createElement("div");
  resumeMenuEl.className = "claude-pane-resume-menu";
  resumeMenuEl.style.display = "none";
  container.appendChild(resumeMenuEl);
  resumeBtn.addEventListener("click", () => {
    const open = resumeMenuEl.style.display !== "none";
    resumeMenuEl.style.display = open ? "none" : "block";
    if (!open) callbacks.onListSessions();
  });

  // ── Transcript ──
  const transcriptEl = document.createElement("div");
  transcriptEl.className = "claude-pane-transcript";
  container.appendChild(transcriptEl);

  // ── Composer ──
  const composerWrap = document.createElement("div");
  composerWrap.className = "claude-pane-composer";
  const composerEl = document.createElement("textarea");
  composerEl.className = "claude-pane-input";
  composerEl.placeholder =
    "Prompt Claude Code… (Enter to send, Shift+Enter for newline)";
  composerEl.rows = 2;
  composerWrap.appendChild(composerEl);
  const sendBtn = document.createElement("button");
  sendBtn.className = "claude-pane-btn claude-pane-send";
  sendBtn.textContent = "Send";
  composerWrap.appendChild(sendBtn);
  container.appendChild(composerWrap);

  const view: ClaudePaneView = {
    id: surfaceId,
    surfaceType: "claude",
    container,
    titleEl: barTitle,
    chipsEl,
    title: "Claude Code",
    callbacks,
    _cleanup: [],
    transcriptEl,
    composerEl,
    sendBtn,
    interruptBtn,
    modelPillEl,
    costPillEl,
    modeSelectEl,
    resumeMenuEl,
    _openAssistantEl: null,
    _exited: false,
  };

  const send = () => {
    const text = composerEl.value.trim();
    if (!text || view._exited) return;
    composerEl.value = "";
    callbacks.onPrompt(surfaceId, text);
  };
  sendBtn.addEventListener("click", send);
  composerEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") {
      callbacks.onInterrupt(surfaceId);
    }
  });
  container.addEventListener("mousedown", () => callbacks.onFocus(surfaceId));

  return view;
}

/** Apply one SDK event to the pane DOM. */
export function claudePaneApplyEvent(
  view: ClaudePaneView,
  event: unknown,
): void {
  const op = digestClaudeEvent(event);
  switch (op.kind) {
    case "meta":
      if (op.model) view.modelPillEl.textContent = op.model;
      if (op.mode) view.modeSelectEl.value = op.mode;
      break;
    case "user-text":
      view._openAssistantEl = null;
      appendBubble(view, "claude-msg-user", op.text);
      view.interruptBtn.disabled = false;
      break;
    case "assistant-text": {
      if (op.append && view._openAssistantEl) {
        view._openAssistantEl.textContent += op.text;
      } else if (op.append) {
        view._openAssistantEl = appendBubble(
          view,
          "claude-msg-assistant",
          op.text,
        );
      } else {
        // Authoritative full message replaces the streaming bubble.
        if (view._openAssistantEl) {
          view._openAssistantEl.textContent = op.text;
        } else {
          appendBubble(view, "claude-msg-assistant", op.text);
        }
        view._openAssistantEl = null;
      }
      view.interruptBtn.disabled = false;
      scrollToBottom(view);
      break;
    }
    case "tool-start": {
      view._openAssistantEl = null;
      const card = document.createElement("div");
      card.className = "claude-msg claude-msg-tool";
      const name = document.createElement("span");
      name.className = "claude-tool-name";
      name.textContent = op.toolName;
      card.appendChild(name);
      if (op.summary) {
        const sum = document.createElement("code");
        sum.className = "claude-tool-summary";
        sum.textContent = op.summary;
        card.appendChild(sum);
      }
      view.transcriptEl.appendChild(card);
      scrollToBottom(view);
      break;
    }
    case "result": {
      view._openAssistantEl = null;
      view.interruptBtn.disabled = true;
      const meta: string[] = [];
      if (op.durationMs != null)
        meta.push(`${(op.durationMs / 1000).toFixed(1)}s`);
      if (op.costUsd != null) {
        meta.push(`$${op.costUsd.toFixed(op.costUsd < 0.01 ? 3 : 2)}`);
        view.costPillEl.textContent = `$${op.costUsd.toFixed(op.costUsd < 0.01 ? 3 : 2)}`;
      }
      if (op.isError || meta.length) {
        const line = document.createElement("div");
        line.className = `claude-msg claude-msg-result${op.isError ? " claude-msg-error" : ""}`;
        line.textContent = op.isError
          ? `turn failed${meta.length ? ` · ${meta.join(" · ")}` : ""}`
          : meta.join(" · ");
        view.transcriptEl.appendChild(line);
      }
      scrollToBottom(view);
      break;
    }
    case "none":
      break;
  }
}

/** Session stream ended. */
export function claudePaneApplyExit(
  view: ClaudePaneView,
  error: string | null,
): void {
  view._exited = true;
  view.interruptBtn.disabled = true;
  view.composerEl.disabled = true;
  view.sendBtn.disabled = true;
  const line = document.createElement("div");
  line.className = `claude-msg claude-msg-result${error ? " claude-msg-error" : ""}`;
  line.textContent = error ? `session ended: ${error}` : "session ended";
  view.transcriptEl.appendChild(line);
}

/** Fill the resume dropdown from a claudeAgentSessions push. */
export function claudePaneApplySessions(
  view: ClaudePaneView,
  sessions: ClaudeAgentSessionWire[],
): void {
  view.resumeMenuEl.replaceChildren();
  if (sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "claude-resume-empty";
    empty.textContent = "No previous sessions found.";
    view.resumeMenuEl.appendChild(empty);
    return;
  }
  for (const s of sessions) {
    const row = document.createElement("button");
    row.className = "claude-resume-row";
    const title = document.createElement("span");
    title.className = "claude-resume-title";
    title.textContent = s.summary || s.firstPrompt || s.sessionId.slice(0, 8);
    row.appendChild(title);
    const meta = document.createElement("span");
    meta.className = "claude-resume-meta";
    const when = s.lastModified
      ? new Date(s.lastModified).toLocaleString()
      : "";
    meta.textContent = [s.gitBranch, when].filter(Boolean).join(" · ");
    row.appendChild(meta);
    row.addEventListener("click", () => {
      view.resumeMenuEl.style.display = "none";
      view.callbacks.onResume(s.sessionId, false);
    });
    view.resumeMenuEl.appendChild(row);
  }
}

export function destroyClaudePaneView(view: ClaudePaneView): void {
  for (const fn of view._cleanup) {
    try {
      fn();
    } catch {
      /* listener already gone */
    }
  }
  view.container.remove();
}

function appendBubble(
  view: ClaudePaneView,
  cls: string,
  text: string,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `claude-msg ${cls}`;
  el.textContent = text;
  view.transcriptEl.appendChild(el);
  scrollToBottom(view);
  return el;
}

function scrollToBottom(view: ClaudePaneView): void {
  view.transcriptEl.scrollTop = view.transcriptEl.scrollHeight;
}
