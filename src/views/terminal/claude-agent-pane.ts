/**
 * claude-agent-pane.ts — DOM construction for the native Claude Code
 * pane (august-plan M3/WS5; full-feature v2 in M4).
 *
 * Structure mirrors telegram-pane.ts / agent-panel.ts: a `surface-bar`
 * row, a header toolbar, a transcript, a composer. No terminal, no PTY —
 * turns flow over the claudeAgent* RPC messages.
 *
 * v2 feature set:
 *   - markdown assistant messages (shared `mdLite`) with an O(N)
 *     streaming live-element (the pi pane's pattern);
 *   - collapsible thinking blocks, streamed live;
 *   - tool cards with status (running → ok/error), expandable input AND
 *     matched output (`tool_use_id`), copy affordances;
 *   - inline "waiting for approval" row driven by synthetic
 *     `__tau_permission` events from the bun host;
 *   - in-place NEW SESSION and RESUME (bun rebinds the agent under the
 *     same surface id and replays history via `claudeAgentHistory`);
 *   - model switcher + permission-mode switcher, cost / token / elapsed
 *     meters, stick-to-bottom autoscroll with a jump pill, an empty
 *     state with the session browser inlined.
 *
 * `digestClaudeEvent` (event → ops) is pure so tests drive the whole
 * rendering contract without a DOM; the SDK grows message types faster
 * than we do, so unknown types MUST digest to [] (never throw).
 */

import { createIcon, type IconName } from "./icons";
import type { ClaudeAgentSessionWire } from "../../shared/types";
import { autoResize, escapeHtml, fmtK, mdLite } from "./agent-panel-utils";

// ---------------------------------------------------------------------------
// Pure: SDK event → transcript ops
// ---------------------------------------------------------------------------

export type ClaudeTranscriptOp =
  | {
      kind: "meta";
      model?: string;
      sessionId?: string;
      mode?: string;
      cwd?: string;
    }
  | { kind: "user-text"; text: string }
  | { kind: "assistant-delta"; text: string }
  | { kind: "assistant-final"; text: string }
  | { kind: "thinking-delta"; text: string }
  | { kind: "thinking-final"; text: string }
  | {
      kind: "tool-start";
      id: string;
      name: string;
      summary: string;
      input: string;
    }
  | { kind: "tool-result"; id: string; output: string; isError: boolean }
  | {
      kind: "perm";
      status: "pending" | "resolved";
      toolName: string;
      behavior?: string;
    }
  | {
      kind: "result";
      costUsd: number | null;
      durationMs: number | null;
      tokens: number | null;
      isError: boolean;
    };

function rec(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}

function blocksToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<Record<string, unknown>>)
    .filter((b) => b["type"] === "text" && typeof b["text"] === "string")
    .map((b) => b["text"] as string)
    .join("");
}

/** tool_result content → display text (string or text blocks). */
export function extractToolOutput(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .map((b) =>
        b["type"] === "text" && typeof b["text"] === "string"
          ? (b["text"] as string)
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
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
  if (name === "Task" || name === "Agent") {
    const d = input["description"] ?? input["prompt"];
    if (typeof d === "string") return truncate(d, 120);
  }
  const pattern = input["pattern"] ?? input["query"] ?? input["url"];
  if (typeof pattern === "string") return truncate(pattern, 120);
  const keys = Object.keys(input);
  return keys.length ? truncate(JSON.stringify(input), 120) : "";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function digestClaudeEvent(event: unknown): ClaudeTranscriptOp[] {
  const m = rec(event);
  const type = m["type"];

  if (type === "system" && m["subtype"] === "init") {
    return [
      {
        kind: "meta",
        model: typeof m["model"] === "string" ? m["model"] : undefined,
        sessionId:
          typeof m["session_id"] === "string" ? m["session_id"] : undefined,
        mode:
          typeof m["permissionMode"] === "string"
            ? m["permissionMode"]
            : undefined,
        cwd: typeof m["cwd"] === "string" ? m["cwd"] : undefined,
      },
    ];
  }

  if (type === "__tau_permission") {
    const status = m["status"] === "resolved" ? "resolved" : "pending";
    return [
      {
        kind: "perm",
        status,
        toolName: String(m["toolName"] ?? "tool"),
        behavior: typeof m["behavior"] === "string" ? m["behavior"] : undefined,
      },
    ];
  }

  if (type === "user") {
    const msg = rec(m["message"]);
    const content = msg["content"];
    const ops: ClaudeTranscriptOp[] = [];
    if (Array.isArray(content)) {
      for (const raw of content as unknown[]) {
        const b = rec(raw);
        if (b["type"] === "tool_result") {
          ops.push({
            kind: "tool-result",
            id: String(b["tool_use_id"] ?? ""),
            output: extractToolOutput(b["content"]),
            isError: b["is_error"] === true,
          });
        } else if (b["type"] === "text" && typeof b["text"] === "string") {
          ops.push({ kind: "user-text", text: b["text"] });
        }
      }
    } else if (typeof content === "string" && content) {
      ops.push({ kind: "user-text", text: content });
    }
    return ops;
  }

  if (type === "assistant") {
    const msg = rec(m["message"]);
    const content = msg["content"];
    const ops: ClaudeTranscriptOp[] = [];
    let text = "";
    if (Array.isArray(content)) {
      for (const raw of content as unknown[]) {
        const b = rec(raw);
        if (b["type"] === "text" && typeof b["text"] === "string") {
          text += b["text"];
        } else if (b["type"] === "thinking") {
          const t = b["thinking"];
          if (typeof t === "string" && t) {
            ops.push({ kind: "thinking-final", text: t });
          }
        } else if (b["type"] === "tool_use") {
          const input = rec(b["input"]);
          ops.push({
            kind: "tool-start",
            id: String(b["id"] ?? ""),
            name: String(b["name"] ?? "tool"),
            summary: toolSummary(String(b["name"] ?? ""), input),
            input: JSON.stringify(input, null, 2),
          });
        }
      }
    } else {
      text = blocksToText(content);
    }
    // Emit the text op even when empty IF there was a streaming phase —
    // the view uses it to finalize the live element. Pure tool-use
    // messages with no text still finalize via `assistant-final: ""`.
    ops.push({ kind: "assistant-final", text });
    return ops;
  }

  if (type === "stream_event") {
    const ev = rec(m["event"]);
    if (ev["type"] === "content_block_delta") {
      const delta = rec(ev["delta"]);
      if (delta["type"] === "text_delta" && typeof delta["text"] === "string") {
        return [{ kind: "assistant-delta", text: delta["text"] }];
      }
      if (
        delta["type"] === "thinking_delta" &&
        typeof delta["thinking"] === "string"
      ) {
        return [{ kind: "thinking-delta", text: delta["thinking"] }];
      }
      return [];
    }
    if (ev["type"] === "content_block_start") {
      const block = rec(ev["content_block"]);
      if (block["type"] === "tool_use") {
        return [
          {
            kind: "tool-start",
            id: String(block["id"] ?? ""),
            name: String(block["name"] ?? "tool"),
            summary: "",
            input: "",
          },
        ];
      }
    }
    return [];
  }

  if (type === "result") {
    const usage = rec(m["usage"]);
    const inTok =
      typeof usage["input_tokens"] === "number"
        ? (usage["input_tokens"] as number)
        : 0;
    const outTok =
      typeof usage["output_tokens"] === "number"
        ? (usage["output_tokens"] as number)
        : 0;
    return [
      {
        kind: "result",
        costUsd:
          typeof m["total_cost_usd"] === "number"
            ? (m["total_cost_usd"] as number)
            : null,
        durationMs:
          typeof m["duration_ms"] === "number"
            ? (m["duration_ms"] as number)
            : null,
        tokens: inTok + outTok > 0 ? inTok + outTok : null,
        isError: m["subtype"] !== "success",
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface ClaudePaneCallbacks {
  onPrompt: (surfaceId: string, text: string) => void;
  onInterrupt: (surfaceId: string) => void;
  onSetMode: (surfaceId: string, mode: string) => void;
  onSetModel: (surfaceId: string, model: string | undefined) => void;
  onListSessions: () => void;
  /** In-place resume (fork=true resumes into a new session id). */
  onResume: (surfaceId: string, sessionId: string, fork: boolean) => void;
  /** In-place fresh session. */
  onNewSession: (surfaceId: string) => void;
  onClose: (surfaceId: string) => void;
  onFocus: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => void;
}

export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;

/** Model switcher entries: wire id → label. "" = session default. */
export const MODEL_CHOICES: ReadonlyArray<readonly [string, string]> = [
  ["", "default model"],
  ["claude-opus-5", "Opus"],
  ["claude-sonnet-5", "Sonnet"],
  ["claude-haiku-4-5-20251001", "Haiku"],
];

const MAX_TOOL_OUTPUT_CHARS = 4000;

interface ToolCardRefs {
  card: HTMLDivElement;
  statusEl: HTMLSpanElement;
  summaryEl: HTMLElement;
  bodyEl: HTMLDivElement;
  inputPre: HTMLPreElement;
  outputPre: HTMLPreElement | null;
  name: string;
}

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
  stateDotEl: HTMLSpanElement;
  modelSelectEl: HTMLSelectElement;
  modeSelectEl: HTMLSelectElement;
  costPillEl: HTMLSpanElement;
  tokenPillEl: HTMLSpanElement;
  timePillEl: HTMLSpanElement;
  cwdEl: HTMLSpanElement;
  resumeMenuEl: HTMLDivElement;
  jumpBtn: HTMLButtonElement;
  welcomeEl: HTMLDivElement;

  _live: {
    assistantEl: HTMLDivElement | null;
    assistantText: string;
    thinkingEl: HTMLDivElement | null;
    thinkingText: string;
  };
  _tools: Map<string, ToolCardRefs>;
  _permRowEl: HTMLDivElement | null;
  /** Locally-echoed sends awaiting their SDK user-message replay. */
  _pendingLocalUser: string[];
  _stick: boolean;
  _streaming: boolean;
  _turnStartedAt: number;
  _timer: ReturnType<typeof setInterval> | null;
  _exited: boolean;
  _sessionId: string | null;
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

function pill(cls: string, title: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `claude-pane-pill ${cls}`;
  el.title = title;
  return el;
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

  // ── Header toolbar ──
  const toolbar = document.createElement("div");
  toolbar.className = "claude-pane-toolbar";

  const stateDotEl = document.createElement("span");
  stateDotEl.className = "claude-state-dot claude-state-idle";
  stateDotEl.title = "idle";
  toolbar.appendChild(stateDotEl);

  const modelSelectEl = document.createElement("select");
  modelSelectEl.className = "claude-pane-select claude-pane-model-select";
  modelSelectEl.setAttribute("aria-label", "Model");
  for (const [value, label] of MODEL_CHOICES) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    modelSelectEl.appendChild(opt);
  }
  modelSelectEl.addEventListener("change", () => {
    callbacks.onSetModel(surfaceId, modelSelectEl.value || undefined);
  });
  toolbar.appendChild(modelSelectEl);

  const modeSelectEl = document.createElement("select");
  modeSelectEl.className = "claude-pane-select";
  modeSelectEl.setAttribute("aria-label", "Permission mode");
  for (const mode of PERMISSION_MODES) {
    const opt = document.createElement("option");
    opt.value = mode;
    opt.textContent = mode;
    modeSelectEl.appendChild(opt);
  }
  modeSelectEl.addEventListener("change", () => {
    modeSelectEl.classList.toggle(
      "claude-mode-bypass",
      modeSelectEl.value === "bypassPermissions",
    );
    callbacks.onSetMode(surfaceId, modeSelectEl.value);
  });
  toolbar.appendChild(modeSelectEl);

  const cwdEl = document.createElement("span");
  cwdEl.className = "claude-pane-cwd";
  toolbar.appendChild(cwdEl);

  const spacer = document.createElement("div");
  spacer.className = "claude-pane-toolbar-spacer";
  toolbar.appendChild(spacer);

  const tokenPillEl = pill("claude-pane-tokens", "Context tokens (last turn)");
  const costPillEl = pill("claude-pane-cost", "Session cost");
  const timePillEl = pill("claude-pane-time", "Turn duration");
  toolbar.append(tokenPillEl, costPillEl, timePillEl);

  const newBtn = document.createElement("button");
  newBtn.className = "claude-pane-btn";
  newBtn.textContent = "New";
  newBtn.title = "Start a fresh session in this pane";
  newBtn.addEventListener("click", () => callbacks.onNewSession(surfaceId));
  toolbar.appendChild(newBtn);

  const resumeBtn = document.createElement("button");
  resumeBtn.className = "claude-pane-btn";
  resumeBtn.textContent = "Sessions";
  resumeBtn.title = "Resume a previous Claude Code session in this pane";
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

  // ── Sessions dropdown ──
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

  // Empty state.
  const welcomeEl = document.createElement("div");
  welcomeEl.className = "claude-pane-welcome";
  const welcomeMark = document.createElement("div");
  welcomeMark.className = "claude-welcome-mark";
  welcomeMark.appendChild(createIcon("bolt", "", 30));
  welcomeEl.appendChild(welcomeMark);
  welcomeEl.innerHTML +=
    `<div class="claude-welcome-title">Claude Code</div>` +
    `<div class="claude-welcome-sub">A native session in this pane — ` +
    `streamed answers, tool cards, approvals in the τ-mux modal.</div>`;
  const welcomeBtns = document.createElement("div");
  welcomeBtns.className = "claude-welcome-actions";
  const browseBtn = document.createElement("button");
  browseBtn.className = "claude-pane-btn";
  browseBtn.textContent = "Browse sessions";
  browseBtn.addEventListener("click", () => {
    resumeMenuEl.style.display = "block";
    callbacks.onListSessions();
  });
  welcomeBtns.appendChild(browseBtn);
  welcomeEl.appendChild(welcomeBtns);
  transcriptEl.appendChild(welcomeEl);

  // Jump-to-bottom pill.
  const jumpBtn = document.createElement("button");
  jumpBtn.className = "claude-pane-jump";
  jumpBtn.textContent = "↓ latest";
  jumpBtn.style.display = "none";
  container.appendChild(jumpBtn);

  // ── Composer ──
  const composerWrap = document.createElement("div");
  composerWrap.className = "claude-pane-composer";
  const composerEl = document.createElement("textarea");
  composerEl.className = "claude-pane-input";
  composerEl.placeholder = "Prompt Claude Code…";
  composerEl.rows = 1;
  composerWrap.appendChild(composerEl);
  const sendBtn = document.createElement("button");
  sendBtn.className = "claude-pane-btn claude-pane-send";
  sendBtn.textContent = "Send";
  composerWrap.appendChild(sendBtn);
  container.appendChild(composerWrap);
  const hint = document.createElement("div");
  hint.className = "claude-pane-hint";
  hint.textContent =
    "Enter to send · Shift+Enter newline · Esc interrupt · sending mid-turn queues";
  container.appendChild(hint);

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
    stateDotEl,
    modelSelectEl,
    modeSelectEl,
    costPillEl,
    tokenPillEl,
    timePillEl,
    cwdEl,
    resumeMenuEl,
    jumpBtn,
    welcomeEl,
    _live: {
      assistantEl: null,
      assistantText: "",
      thinkingEl: null,
      thinkingText: "",
    },
    _tools: new Map(),
    _permRowEl: null,
    _pendingLocalUser: [],
    _stick: true,
    _streaming: false,
    _turnStartedAt: 0,
    _timer: null,
    _exited: false,
    _sessionId: null,
  };

  // Autoscroll bookkeeping: stick to the bottom until the user scrolls
  // away; a jump pill brings them back.
  transcriptEl.addEventListener("scroll", () => {
    const nearBottom =
      transcriptEl.scrollTop + transcriptEl.clientHeight >=
      transcriptEl.scrollHeight - 48;
    view._stick = nearBottom;
    jumpBtn.style.display = nearBottom ? "none" : "block";
  });
  jumpBtn.addEventListener("click", () => {
    view._stick = true;
    jumpBtn.style.display = "none";
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  });

  const send = () => {
    const text = composerEl.value.trim();
    if (!text || view._exited) return;
    composerEl.value = "";
    autoResize(composerEl);
    // Optimistic local echo — the SDK's user-message replay is deduped
    // against this in the user-text op handler.
    view._pendingLocalUser.push(text);
    appendUserBubble(view, text);
    beginTurn(view);
    callbacks.onPrompt(surfaceId, text);
  };
  sendBtn.addEventListener("click", send);
  composerEl.addEventListener("input", () => autoResize(composerEl));
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

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function hideWelcome(view: ClaudePaneView): void {
  if (view.welcomeEl.parentElement) view.welcomeEl.remove();
}

function maybeScroll(view: ClaudePaneView): void {
  if (view._stick) {
    view.transcriptEl.scrollTop = view.transcriptEl.scrollHeight;
  }
}

function setState(
  view: ClaudePaneView,
  state: "idle" | "working" | "waiting" | "ended",
): void {
  view.stateDotEl.className = `claude-state-dot claude-state-${state}`;
  view.stateDotEl.title = state;
}

function beginTurn(view: ClaudePaneView): void {
  if (view._streaming) return;
  view._streaming = true;
  view._turnStartedAt = Date.now();
  view.interruptBtn.disabled = false;
  setState(view, "working");
  view.timePillEl.textContent = "0s";
  if (view._timer) clearInterval(view._timer);
  view._timer = setInterval(() => {
    const sec = Math.round((Date.now() - view._turnStartedAt) / 1000);
    view.timePillEl.textContent =
      sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }, 1000);
}

function endTurn(view: ClaudePaneView): void {
  view._streaming = false;
  view.interruptBtn.disabled = true;
  setState(view, view._exited ? "ended" : "idle");
  if (view._timer) {
    clearInterval(view._timer);
    view._timer = null;
  }
}

function appendUserBubble(view: ClaudePaneView, text: string): void {
  hideWelcome(view);
  finalizeLive(view);
  const el = document.createElement("div");
  el.className = "claude-msg claude-msg-user";
  el.textContent = text;
  view.transcriptEl.appendChild(el);
  maybeScroll(view);
}

/** Close any open streaming elements (assistant text / thinking). */
function finalizeLive(view: ClaudePaneView): void {
  const live = view._live;
  if (live.assistantEl) {
    live.assistantEl.classList.remove("claude-msg-live");
    live.assistantEl.querySelector(".claude-cursor")?.remove();
  }
  live.assistantEl = null;
  live.assistantText = "";
  if (live.thinkingEl) live.thinkingEl.classList.remove("claude-think-live");
  live.thinkingEl = null;
  live.thinkingText = "";
}

function ensureAssistantLive(view: ClaudePaneView): HTMLDivElement {
  const live = view._live;
  if (live.assistantEl) return live.assistantEl;
  hideWelcome(view);
  const el = document.createElement("div");
  el.className = "claude-msg claude-msg-assistant claude-msg-live";
  const content = document.createElement("div");
  content.className = "claude-msg-content";
  const cursor = document.createElement("span");
  cursor.className = "claude-cursor";
  content.appendChild(cursor);
  el.appendChild(content);
  view.transcriptEl.appendChild(el);
  live.assistantEl = el;
  return el;
}

/** O(N) streaming: innerHTML update on the SAME content element per
 *  delta (the pi pane's pattern — rebuilding the subtree per token is
 *  O(N²) on long streams). */
function renderAssistantLive(view: ClaudePaneView): void {
  const el = ensureAssistantLive(view);
  const content = el.querySelector(".claude-msg-content") as HTMLDivElement;
  content.innerHTML = mdLite(view._live.assistantText);
  const cursor = document.createElement("span");
  cursor.className = "claude-cursor";
  content.appendChild(cursor);
  maybeScroll(view);
}

function ensureThinkingLive(view: ClaudePaneView): HTMLDivElement {
  const live = view._live;
  if (live.thinkingEl) return live.thinkingEl;
  hideWelcome(view);
  const el = buildThinkingBlock("");
  el.classList.add("claude-think-live");
  view.transcriptEl.appendChild(el);
  live.thinkingEl = el;
  return el;
}

function buildThinkingBlock(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "claude-think";
  const head = document.createElement("button");
  head.className = "claude-think-head";
  head.innerHTML = `<span class="claude-think-star"></span> Thinking <span class="claude-think-chev">›</span>`;
  const body = document.createElement("div");
  body.className = "claude-think-body";
  body.style.display = "none";
  body.textContent = text;
  head.addEventListener("click", () => {
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
    el.classList.toggle("claude-think-open", !open);
  });
  el.append(head, body);
  return el;
}

function buildToolCard(
  view: ClaudePaneView,
  op: Extract<ClaudeTranscriptOp, { kind: "tool-start" }>,
): ToolCardRefs {
  hideWelcome(view);
  finalizeLive(view);
  const card = document.createElement("div");
  card.className = "claude-tool";

  const head = document.createElement("button");
  head.className = "claude-tool-head";
  const statusEl = document.createElement("span");
  statusEl.className = "claude-tool-status claude-tool-running";
  const nameEl = document.createElement("span");
  nameEl.className = "claude-tool-name";
  nameEl.textContent = op.name;
  const summaryEl = document.createElement("code");
  summaryEl.className = "claude-tool-summary";
  summaryEl.textContent = op.summary;
  const chev = document.createElement("span");
  chev.className = "claude-tool-chev";
  chev.textContent = "›";
  head.append(statusEl, nameEl, summaryEl, chev);
  card.appendChild(head);

  const bodyEl = document.createElement("div");
  bodyEl.className = "claude-tool-body";
  bodyEl.style.display = "none";
  const inputPre = document.createElement("pre");
  inputPre.className = "claude-tool-pre claude-tool-input";
  inputPre.textContent = op.input;
  bodyEl.appendChild(buildPreSection("input", inputPre));
  card.appendChild(bodyEl);

  head.addEventListener("click", () => {
    const open = bodyEl.style.display !== "none";
    bodyEl.style.display = open ? "none" : "block";
    card.classList.toggle("claude-tool-open", !open);
  });

  view.transcriptEl.appendChild(card);
  maybeScroll(view);
  const refs: ToolCardRefs = {
    card,
    statusEl,
    summaryEl,
    bodyEl,
    inputPre,
    outputPre: null,
    name: op.name,
  };
  if (op.id) view._tools.set(op.id, refs);
  return refs;
}

function buildPreSection(label: string, pre: HTMLPreElement): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "claude-tool-section";
  const head = document.createElement("div");
  head.className = "claude-tool-section-head";
  const lab = document.createElement("span");
  lab.textContent = label;
  const copy = document.createElement("button");
  copy.className = "claude-tool-copy";
  copy.textContent = "copy";
  copy.addEventListener("click", (e) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(pre.textContent ?? "");
    copy.textContent = "copied";
    setTimeout(() => (copy.textContent = "copy"), 1200);
  });
  head.append(lab, copy);
  wrap.append(head, pre);
  return wrap;
}

function applyToolResult(
  view: ClaudePaneView,
  op: Extract<ClaudeTranscriptOp, { kind: "tool-result" }>,
): void {
  const refs = view._tools.get(op.id);
  if (!refs) return; // result for a card we never saw (subagent noise)
  refs.statusEl.className = `claude-tool-status ${
    op.isError ? "claude-tool-error" : "claude-tool-ok"
  }`;
  if (refs.outputPre) {
    refs.outputPre.textContent = capOutput(op.output);
    return;
  }
  const outputPre = document.createElement("pre");
  outputPre.className = "claude-tool-pre claude-tool-output";
  outputPre.textContent = capOutput(op.output);
  refs.outputPre = outputPre;
  refs.bodyEl.appendChild(buildPreSection("output", outputPre));
  if (op.isError) refs.card.classList.add("claude-tool-failed");
}

function capOutput(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT_CHARS) return s;
  return s.slice(0, MAX_TOOL_OUTPUT_CHARS) + `\n… (${s.length} chars total)`;
}

function applyPerm(
  view: ClaudePaneView,
  op: Extract<ClaudeTranscriptOp, { kind: "perm" }>,
): void {
  if (op.status === "pending") {
    setState(view, "waiting");
    if (!view._permRowEl) {
      const el = document.createElement("div");
      el.className = "claude-perm-row";
      view.transcriptEl.appendChild(el);
      view._permRowEl = el;
    }
    view._permRowEl.textContent = `Waiting for approval: ${op.toolName} — answer the modal (or Telegram)`;
    maybeScroll(view);
  } else {
    if (view._permRowEl) {
      if (op.behavior === "deny" || op.behavior === "timeout") {
        view._permRowEl.textContent =
          op.behavior === "deny"
            ? `Denied: ${op.toolName}`
            : `Approval timed out: ${op.toolName}`;
        view._permRowEl.classList.add("claude-perm-denied");
        view._permRowEl = null; // keep the record in the transcript
      } else {
        view._permRowEl.remove();
        view._permRowEl = null;
      }
    }
    if (view._streaming) setState(view, "working");
  }
}

function appendResultRow(
  view: ClaudePaneView,
  op: Extract<ClaudeTranscriptOp, { kind: "result" }>,
): void {
  finalizeLive(view);
  const meta: string[] = [];
  if (op.durationMs != null) meta.push(`${(op.durationMs / 1000).toFixed(1)}s`);
  if (op.costUsd != null) {
    const c = `$${op.costUsd.toFixed(op.costUsd < 0.01 ? 3 : 2)}`;
    meta.push(c);
    view.costPillEl.textContent = c;
  }
  if (op.tokens != null) {
    meta.push(`${fmtK(op.tokens)} tok`);
    view.tokenPillEl.textContent = `${fmtK(op.tokens)} tok`;
  }
  if (op.isError || meta.length) {
    const line = document.createElement("div");
    line.className = `claude-msg-result${op.isError ? " claude-msg-error" : ""}`;
    line.textContent = op.isError
      ? `turn failed${meta.length ? ` · ${meta.join(" · ")}` : ""}`
      : meta.join(" · ");
    view.transcriptEl.appendChild(line);
  }
  endTurn(view);
  maybeScroll(view);
}

function applyMeta(
  view: ClaudePaneView,
  op: Extract<ClaudeTranscriptOp, { kind: "meta" }>,
): void {
  if (op.model) {
    const has = [...view.modelSelectEl.options].some(
      (o) => o.value === op.model,
    );
    if (!has) {
      const opt = document.createElement("option");
      opt.value = op.model;
      opt.textContent = op.model;
      view.modelSelectEl.appendChild(opt);
    }
    view.modelSelectEl.value = op.model;
  }
  if (op.mode) view.modeSelectEl.value = op.mode;
  if (op.cwd) {
    const parts = op.cwd.split("/").filter(Boolean);
    view.cwdEl.textContent = parts[parts.length - 1] ?? op.cwd;
    view.cwdEl.title = op.cwd;
  }
  if (op.sessionId) view._sessionId = op.sessionId;
}

// ---------------------------------------------------------------------------
// Public appliers
// ---------------------------------------------------------------------------

export function claudePaneApplyOps(
  view: ClaudePaneView,
  ops: ClaudeTranscriptOp[],
): void {
  for (const op of ops) {
    switch (op.kind) {
      case "meta":
        applyMeta(view, op);
        break;
      case "user-text": {
        // Dedupe the SDK's replay of a locally-echoed send.
        const pendingIdx = view._pendingLocalUser.indexOf(op.text);
        if (pendingIdx !== -1) {
          view._pendingLocalUser.splice(pendingIdx, 1);
          break;
        }
        appendUserBubble(view, op.text);
        break;
      }
      case "assistant-delta":
        beginTurn(view);
        view._live.assistantText += op.text;
        renderAssistantLive(view);
        break;
      case "assistant-final": {
        const live = view._live;
        if (live.assistantEl) {
          const content = live.assistantEl.querySelector(
            ".claude-msg-content",
          ) as HTMLDivElement;
          content.innerHTML = mdLite(op.text || live.assistantText);
          live.assistantEl.classList.remove("claude-msg-live");
          live.assistantEl = null;
          live.assistantText = "";
        } else if (op.text) {
          hideWelcome(view);
          const el = document.createElement("div");
          el.className = "claude-msg claude-msg-assistant";
          const content = document.createElement("div");
          content.className = "claude-msg-content";
          content.innerHTML = mdLite(op.text);
          el.appendChild(content);
          view.transcriptEl.appendChild(el);
        }
        maybeScroll(view);
        break;
      }
      case "thinking-delta": {
        beginTurn(view);
        const el = ensureThinkingLive(view);
        view._live.thinkingText += op.text;
        const body = el.querySelector(".claude-think-body") as HTMLDivElement;
        body.textContent = view._live.thinkingText;
        maybeScroll(view);
        break;
      }
      case "thinking-final": {
        const live = view._live;
        if (live.thinkingEl) {
          const body = live.thinkingEl.querySelector(
            ".claude-think-body",
          ) as HTMLDivElement;
          body.textContent = op.text;
          live.thinkingEl.classList.remove("claude-think-live");
          live.thinkingEl = null;
          live.thinkingText = "";
        } else {
          hideWelcome(view);
          view.transcriptEl.appendChild(buildThinkingBlock(op.text));
        }
        break;
      }
      case "tool-start": {
        beginTurn(view);
        const existing = op.id ? view._tools.get(op.id) : undefined;
        if (existing) {
          // Final assistant message fills in the streamed placeholder.
          if (op.summary) existing.summaryEl.textContent = op.summary;
          if (op.input) existing.inputPre.textContent = op.input;
        } else {
          buildToolCard(view, op);
        }
        break;
      }
      case "tool-result":
        applyToolResult(view, op);
        break;
      case "perm":
        applyPerm(view, op);
        break;
      case "result":
        appendResultRow(view, op);
        break;
    }
  }
}

export function claudePaneApplyEvent(
  view: ClaudePaneView,
  event: unknown,
): void {
  claudePaneApplyOps(view, digestClaudeEvent(event));
}

/** Replay a resumed session's persisted transcript (SessionMessage[]). */
export function claudePaneApplyHistory(
  view: ClaudePaneView,
  sessionId: string,
  messages: unknown[],
): void {
  claudePaneReset(view);
  const divider = document.createElement("div");
  divider.className = "claude-session-divider";
  divider.textContent = `resumed session ${sessionId.slice(0, 8)}`;
  view.transcriptEl.appendChild(divider);
  hideWelcome(view);
  for (const msg of messages) {
    // History has no stream events / results — user + assistant only.
    claudePaneApplyOps(view, digestClaudeEvent(msg));
  }
  endTurn(view);
  view._stick = true;
  view.transcriptEl.scrollTop = view.transcriptEl.scrollHeight;
}

/** Clear the transcript for an in-place session swap. */
export function claudePaneReset(view: ClaudePaneView): void {
  finalizeLive(view);
  view._tools.clear();
  view._permRowEl = null;
  view._pendingLocalUser = [];
  view._exited = false;
  view._sessionId = null;
  view.composerEl.disabled = false;
  view.sendBtn.disabled = false;
  view.costPillEl.textContent = "";
  view.tokenPillEl.textContent = "";
  view.timePillEl.textContent = "";
  view.transcriptEl.replaceChildren();
  endTurn(view);
}

export function claudePaneApplyExit(
  view: ClaudePaneView,
  error: string | null,
): void {
  view._exited = true;
  endTurn(view);
  setState(view, "ended");
  view.composerEl.disabled = true;
  view.sendBtn.disabled = true;
  const line = document.createElement("div");
  line.className = `claude-msg-result${error ? " claude-msg-error" : ""}`;
  line.textContent = error
    ? `session ended: ${error} — use New to restart`
    : "session ended — use New or Sessions to continue";
  view.transcriptEl.appendChild(line);
  maybeScroll(view);
}

/** Fill the sessions dropdown from a claudeAgentSessions push. */
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
    const row = document.createElement("div");
    row.className = "claude-resume-row";
    const main = document.createElement("button");
    main.className = "claude-resume-main";
    const title = document.createElement("span");
    title.className = "claude-resume-title";
    title.textContent = s.summary || s.firstPrompt || s.sessionId.slice(0, 8);
    const meta = document.createElement("span");
    meta.className = "claude-resume-meta";
    const when = s.lastModified
      ? new Date(s.lastModified).toLocaleString()
      : "";
    meta.textContent = [s.gitBranch, when].filter(Boolean).join(" · ");
    main.append(title, meta);
    main.addEventListener("click", () => {
      view.resumeMenuEl.style.display = "none";
      view.callbacks.onResume(view.id, s.sessionId, false);
    });
    const forkBtn = document.createElement("button");
    forkBtn.className = "claude-resume-fork";
    forkBtn.textContent = "fork";
    forkBtn.title = "Resume as a new session id (leaves the original intact)";
    forkBtn.addEventListener("click", () => {
      view.resumeMenuEl.style.display = "none";
      view.callbacks.onResume(view.id, s.sessionId, true);
    });
    row.append(main, forkBtn);
    view.resumeMenuEl.appendChild(row);
  }
}

export function destroyClaudePaneView(view: ClaudePaneView): void {
  if (view._timer) clearInterval(view._timer);
  for (const fn of view._cleanup) {
    try {
      fn();
    } catch {
      /* listener already gone */
    }
  }
  view.container.remove();
}

// Re-exported so tests can lock the escaping path used by mdLite.
export { escapeHtml };
