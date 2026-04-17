/**
 * DOM builders for agent-panel chat messages and tool calls. These are
 * input-in / node-out so they can be reasoned about and reused without
 * the panel's view/state. `createMsgEl`, `buildToolCallEl`,
 * `buildToolActions`, `buildImageGallery`, and `appendWelcome` live
 * here; functions that mutate panel state (addSystemMessage,
 * renderAllMessages, renderToolCall, …) stay in agent-panel.ts.
 */

import {
  dispatch,
  escapeHtml,
  formatTime,
  highlightDiff,
  type ImageAttachment,
  mdLite,
  parseToolArgs,
} from "./agent-panel-utils";

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool" | "bash";
  content: string;
  thinking?: string;
  toolName?: string;
  isError?: boolean;
  timestamp: number;
  /** For bash messages */
  command?: string;
  exitCode?: number;
  truncated?: boolean;
  fullOutputPath?: string | null;
  images?: ImageAttachment[];
  toolArgs?: unknown;
}

export interface ToolCallState {
  id: string;
  name: string;
  args: string;
  rawArgs?: unknown;
  result?: string;
  isError?: boolean;
  isRunning: boolean;
  collapsed: boolean;
  startTime: number;
}

export function appendWelcome(parent: HTMLDivElement): void {
  const el = document.createElement("div");
  el.className = "agent-welcome";
  el.innerHTML = `
    <div class="agent-welcome-glyph">\u2726</div>
    <div class="agent-welcome-title">Pi Agent</div>
    <div class="agent-welcome-desc">AI coding assistant with full tool access, image prompts, session browsing, tree branching, and the HyperTerm Canvas skill.</div>
    <div class="agent-welcome-shortcuts">
      <div class="agent-welcome-shortcut"><kbd>/</kbd><span>Commands</span></div>
      <div class="agent-welcome-shortcut"><kbd>Enter</kbd><span>Send</span></div>
      <div class="agent-welcome-shortcut"><kbd>Ctrl+P</kbd><span>Model</span></div>
      <div class="agent-welcome-shortcut"><kbd>Shift+Tab</kbd><span>Thinking</span></div>
      <div class="agent-welcome-shortcut"><kbd>Alt+Enter</kbd><span>Follow-up</span></div>
      <div class="agent-welcome-shortcut"><kbd>Paste</kbd><span>Image</span></div>
      <div class="agent-welcome-shortcut"><kbd>Esc</kbd><span>Abort</span></div>
    </div>
    <div class="agent-welcome-actions">
      <button class="agent-welcome-btn" data-cmd="/help">Show commands</button>
      <button class="agent-welcome-btn" data-cmd="/session">Session info</button>
      <button class="agent-welcome-btn" data-cmd="/resume">Resume</button>
      <button class="agent-welcome-btn" data-cmd="/tree">Tree</button>
    </div>
  `;
  parent.appendChild(el);

  // Wire welcome action buttons
  el.querySelectorAll(".agent-welcome-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = (btn as HTMLElement).dataset["cmd"];
      if (cmd) {
        const input = parent
          .closest(".agent-body")
          ?.querySelector(".agent-input") as HTMLTextAreaElement | null;
        if (input) {
          input.value = cmd;
          input.dispatchEvent(new Event("input"));
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        }
      }
    });
  });
}

export function createMsgEl(agentId: string, msg: ChatMessage): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `agent-msg agent-msg-${msg.role}`;

  // Timestamp
  const time = document.createElement("span");
  time.className = "agent-msg-time";
  time.textContent = formatTime(msg.timestamp);

  if (msg.role === "tool") {
    const hdr = document.createElement("div");
    hdr.className = `agent-tc-inline-hdr${msg.isError ? " agent-tc-inline-err" : ""}`;
    hdr.textContent = `${msg.isError ? "\u2717" : "\u2713"} ${msg.toolName ?? "tool"}`;
    hdr.appendChild(time);
    el.appendChild(hdr);
    if (msg.content) {
      const body = document.createElement("pre");
      body.className = "agent-tc-inline-body";
      body.textContent = msg.content.slice(0, 2000);
      el.appendChild(body);
    }
    el.appendChild(buildToolActions(agentId, msg.toolArgs, msg.content));
    if (msg.images?.length) el.appendChild(buildImageGallery(msg.images));
    return el;
  }

  if (msg.role === "bash") {
    const hdr = document.createElement("div");
    hdr.className = `agent-tc-inline-hdr${msg.exitCode !== 0 ? " agent-tc-inline-err" : ""}`;
    hdr.innerHTML = `<span class="agent-bash-prompt">$</span> ${escapeHtml(msg.command ?? "bash")}`;
    hdr.appendChild(time);
    el.appendChild(hdr);
    if (msg.content) {
      const body = document.createElement("pre");
      body.className = "agent-tc-inline-body";
      body.textContent = msg.content.slice(0, 4000);
      el.appendChild(body);
    }
    if (msg.truncated && msg.fullOutputPath) {
      const note = document.createElement("div");
      note.className = "agent-dialog-opt-desc";
      note.textContent = `Full output saved to ${msg.fullOutputPath}`;
      el.appendChild(note);
    }
    el.appendChild(
      buildToolActions(
        agentId,
        { command: msg.command, fullOutputPath: msg.fullOutputPath },
        msg.content,
      ),
    );
    return el;
  }

  if (msg.thinking) {
    const details = document.createElement("details");
    details.className = "agent-think-block";
    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="agent-think-icon">\u25c8</span> Thinking`;
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "agent-think-body";
    body.textContent = msg.thinking;
    details.appendChild(body);
    el.appendChild(details);
  }

  if (msg.role === "user") {
    el.appendChild(time);
  }

  if (msg.images?.length) {
    el.appendChild(buildImageGallery(msg.images));
  }

  const content = document.createElement("div");
  content.className = "agent-msg-content";
  if (msg.role === "assistant") {
    content.innerHTML = mdLite(msg.content);
  } else if (msg.role === "system") {
    content.innerHTML = `<pre class="agent-sys-pre">${escapeHtml(msg.content)}</pre>`;
  } else {
    content.textContent = msg.content;
  }
  el.appendChild(content);
  return el;
}

/** Build the header + body + actions for a live tool call. Stateless
 *  given `agentId` + tool-call state; the toggle button mutates the
 *  passed-in `tc.collapsed` directly. */
export function buildToolCallEl(
  agentId: string,
  tc: ToolCallState,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `agent-tc${tc.isRunning ? " agent-tc-run" : ""}${tc.isError ? " agent-tc-err" : " agent-tc-ok"}`;
  el.dataset["tcid"] = tc.id;

  const hdr = document.createElement("div");
  hdr.className = "agent-tc-hdr";

  const icon = document.createElement("span");
  icon.className = "agent-tc-icon";
  icon.textContent = tc.isRunning ? "\u27f3" : tc.isError ? "\u2717" : "\u2713";
  hdr.appendChild(icon);

  const name = document.createElement("span");
  name.className = "agent-tc-name";
  name.textContent = tc.name;
  hdr.appendChild(name);

  if (tc.args) {
    const args = document.createElement("span");
    args.className = "agent-tc-args";
    args.textContent =
      tc.args.length > 80 ? tc.args.slice(0, 77) + "\u2026" : tc.args;
    args.title = tc.args;
    hdr.appendChild(args);
  }

  if (!tc.isRunning) {
    const elapsed = document.createElement("span");
    elapsed.className = "agent-tc-elapsed";
    elapsed.textContent = `${((Date.now() - tc.startTime) / 1000).toFixed(1)}s`;
    hdr.appendChild(elapsed);
  }

  const toggle = document.createElement("button");
  toggle.className = "agent-tc-toggle";
  toggle.textContent = tc.collapsed ? "\u25b8" : "\u25be";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    tc.collapsed = !tc.collapsed;
    const body = el.querySelector(".agent-tc-body") as HTMLDivElement | null;
    if (body) body.classList.toggle("agent-tc-body-hidden", tc.collapsed);
    toggle.textContent = tc.collapsed ? "\u25b8" : "\u25be";
  });
  hdr.appendChild(toggle);

  el.appendChild(hdr);

  if (tc.result !== undefined) {
    const body = document.createElement("pre");
    body.className = `agent-tc-body${tc.collapsed ? " agent-tc-body-hidden" : ""}`;
    if (tc.name === "Edit" || tc.name === "Write") {
      body.innerHTML = highlightDiff(tc.result.slice(0, 4000));
    } else {
      body.textContent = tc.result.slice(0, 4000);
    }
    el.appendChild(body);
  }

  el.appendChild(buildToolActions(agentId, tc.rawArgs, tc.result));

  return el;
}

export function buildToolActions(
  agentId: string,
  args: unknown,
  result?: string,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "agent-tool-actions";

  const addBtn = (label: string, title: string, onClick: () => void) => {
    const btn = document.createElement("button");
    btn.className = "agent-tool-action-btn";
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    row.appendChild(btn);
  };

  const parsed = parseToolArgs(args);
  if (parsed.command) {
    addBtn("Rerun", "Run this command again via pi bash", () => {
      dispatch("ht-agent-bash", { agentId, command: parsed.command });
    });
    addBtn("Copy cmd", "Copy command", () => {
      void navigator.clipboard.writeText(parsed.command ?? "");
    });
  }
  if (parsed.path) {
    addBtn("Copy path", "Copy affected path", () => {
      void navigator.clipboard.writeText(parsed.path ?? "");
    });
  }
  if (result) {
    addBtn("Copy output", "Copy tool output", () => {
      void navigator.clipboard.writeText(result);
    });
  }

  row.classList.toggle("agent-tool-actions-empty", row.children.length === 0);
  return row;
}

export function buildImageGallery(images: ImageAttachment[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "agent-image-gallery";
  for (const img of images) {
    const image = document.createElement("img");
    image.className = "agent-image-thumb";
    image.src = `data:${img.mimeType};base64,${img.data}`;
    image.alt = img.fileName ?? img.mimeType;
    wrap.appendChild(image);
  }
  return wrap;
}
