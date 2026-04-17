/**
 * Agent-panel slash-command menu + dispatcher.
 *
 * All slash-command UI + execution lives here so the main panel file
 * doesn't carry the commands list, the menu renderer, and the 100-line
 * `/cmd` switch. The module is stateless: callers pass the view (state
 * + DOM) and a `SlashDeps` bundle that lets slash commands talk back
 * to the panel's private renderers without importing them directly.
 *
 * Exports:
 *   BUILTIN_COMMANDS       — the static command list, merged with
 *                            pi-provided commands in get_commands.
 *   handleSlashInput       — on every keystroke, show/hide + filter
 *                            the menu based on whether the buffer
 *                            begins with "/".
 *   getFilteredCommands    — pure filter over the state's command list.
 *   renderSlashMenu        — rebuild the dropdown DOM.
 *   hideSlashMenu          — hide + clear state flag.
 *   executeSlashCommand    — parse the input and route to the right
 *                            callback / dispatch / dialog.
 *   executeBuiltinCommand  — helper for programmatic invocations
 *                            (e.g. welcome screen's quick-action
 *                            buttons): seed the input and then run.
 */

import { autoResize, dispatch } from "./agent-panel-utils";
import type { DialogDeps } from "./agent-panel-dialogs";
import {
  showHelpMessage,
  showHotkeysMessage,
  showSessionStats,
  showSettingsDialog,
  showSwitchSessionDialog,
} from "./agent-panel-dialogs";
import type {
  AgentPaneView,
  AgentPanelCallbacks,
  AgentPanelState,
  SlashCommand,
} from "./agent-panel";

/** Callbacks the slash dispatcher needs to reach back into the panel.
 *  Extends DialogDeps because several `/cmd` paths open modals, and
 *  those helpers want their own DialogDeps bundle — rather than having
 *  the caller build two, we carry both together. */
export interface SlashDeps extends DialogDeps {
  renderAllMessages: () => void;
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "/model", description: "Switch model", source: "builtin" },
  { name: "/new", description: "Start a new session", source: "builtin" },
  {
    name: "/resume",
    description: "Open another session by path",
    source: "builtin",
  },
  { name: "/name", description: "Set session display name", source: "builtin" },
  {
    name: "/session",
    description: "Show session info & stats",
    source: "builtin",
  },
  {
    name: "/compact",
    description: "Compact context window",
    source: "builtin",
  },
  {
    name: "/copy",
    description: "Copy last assistant message",
    source: "builtin",
  },
  { name: "/export", description: "Export session to HTML", source: "builtin" },
  {
    name: "/fork",
    description: "Fork from a previous message",
    source: "builtin",
  },
  { name: "/tree", description: "Navigate session tree", source: "builtin" },
  {
    name: "/settings",
    description: "Thinking, steering, retry settings",
    source: "builtin",
  },
  {
    name: "/hotkeys",
    description: "Show keyboard shortcuts",
    source: "builtin",
  },
  { name: "/clear", description: "Clear chat display", source: "builtin" },
  { name: "/help", description: "Show available commands", source: "builtin" },
];

// ── Menu ─────────────────────────────────────────────────────────

/** Refresh slash-menu state from the current input buffer. Shows the
 *  menu for any single-line buffer starting with `/`, hides it for
 *  anything else (pasted multi-line prompts, regular messages). */
export function handleSlashInput(view: AgentPaneView): void {
  const text = view._elements.inputEl.value;
  if (text.startsWith("/") && !text.includes("\n")) {
    const filter = text.slice(1).toLowerCase();
    view._state.slashFilter = filter;
    view._state.slashSelectedIndex = 0;
    view._state.showSlashMenu = true;
    renderSlashMenu(view);
  } else {
    hideSlashMenu(view);
  }
}

/** Substring-match against command name or description. Pure — no
 *  DOM, no mutation — so it's trivially unit-testable. */
export function getFilteredCommands(s: AgentPanelState): SlashCommand[] {
  if (!s.slashFilter) return s.commands;
  return s.commands.filter(
    (c) =>
      c.name.toLowerCase().includes(s.slashFilter) ||
      c.description.toLowerCase().includes(s.slashFilter),
  );
}

export function renderSlashMenu(view: AgentPaneView): void {
  const { slashMenuEl } = view._elements;
  const s = view._state;
  const cmds = getFilteredCommands(s);

  slashMenuEl.innerHTML = "";

  if (cmds.length === 0) {
    slashMenuEl.classList.add("agent-slash-menu-hidden");
    return;
  }

  slashMenuEl.classList.remove("agent-slash-menu-hidden");

  const header = document.createElement("div");
  header.className = "agent-slash-hdr";
  header.textContent = "Commands";
  slashMenuEl.appendChild(header);

  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];
    const item = document.createElement("button");
    item.className = `agent-slash-item${i === s.slashSelectedIndex ? " agent-slash-item-sel" : ""}`;

    const name = document.createElement("span");
    name.className = "agent-slash-name";
    name.textContent = cmd.name;
    item.appendChild(name);

    const desc = document.createElement("span");
    desc.className = "agent-slash-desc";
    desc.textContent = cmd.description;
    item.appendChild(desc);

    if (cmd.source !== "builtin") {
      const badge = document.createElement("span");
      badge.className = `agent-slash-badge agent-slash-badge-${cmd.source}`;
      badge.textContent = cmd.source;
      item.appendChild(badge);
    }

    item.addEventListener("click", () => {
      view._elements.inputEl.value = cmd.name + " ";
      autoResize(view._elements.inputEl);
      hideSlashMenu(view);
      view._elements.inputEl.focus();
    });
    slashMenuEl.appendChild(item);
  }
}

export function hideSlashMenu(view: AgentPaneView): void {
  view._state.showSlashMenu = false;
  view._elements.slashMenuEl.classList.add("agent-slash-menu-hidden");
}

// ── Dispatcher ───────────────────────────────────────────────────

/** Parse the input buffer and route the slash command. Unknown
 *  commands fall through to `cb.onSendPrompt` so pi can handle skills
 *  or templates that aren't in BUILTIN_COMMANDS. */
export function executeSlashCommand(
  view: AgentPaneView,
  cb: AgentPanelCallbacks,
  deps: SlashDeps,
): void {
  const raw = view._elements.inputEl.value.trim();
  view._elements.inputEl.value = "";
  autoResize(view._elements.inputEl);
  hideSlashMenu(view);

  const parts = raw.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");
  const agentId = view.agentId;

  switch (cmd) {
    case "/new":
      cb.onNewSession(agentId);
      break;
    case "/resume":
      if (args) showSwitchSessionDialog(view, deps, args);
      else dispatch("ht-agent-list-sessions", { agentId });
      break;
    case "/model":
      if (args) {
        // Try to match model by name
        const m = view._state.availableModels?.find(
          (x) =>
            x.name.toLowerCase().includes(args.toLowerCase()) ||
            x.id.toLowerCase().includes(args.toLowerCase()),
        );
        if (m) {
          dispatch("ht-agent-set-model", {
            agentId,
            provider: m.provider,
            modelId: m.id,
          });
          deps.addSystemMessage(`Switching to ${m.name}`);
        } else {
          deps.addSystemMessage(
            `Model not found: ${args}. Opening model selector\u2026`,
          );
          view._state.showModelSelector = true;
          deps.renderDropdowns();
          cb.onGetModels(agentId);
        }
      } else {
        view._state.showModelSelector = true;
        deps.renderDropdowns();
        cb.onGetModels(agentId);
      }
      break;
    case "/compact":
      if (args) {
        dispatch("ht-agent-compact", { agentId }); // pi doesn't support custom instructions via RPC compact yet
      }
      cb.onCompact(agentId);
      deps.addSystemMessage("Compacting context\u2026");
      break;
    case "/name":
      if (args) {
        dispatch("ht-agent-set-session-name", { agentId, name: args });
        deps.addSystemMessage(`Session renamed to "${args}"`);
      } else {
        deps.addSystemMessage("Usage: /name <session name>");
      }
      break;
    case "/session":
      dispatch("ht-agent-get-state", { agentId });
      dispatch("ht-agent-get-session-stats", { agentId });
      showSessionStats(view, deps);
      break;
    case "/copy":
      dispatch("ht-agent-get-last-assistant-text", { agentId });
      break;
    case "/export":
      dispatch("ht-agent-export-html", {
        agentId,
        outputPath: args || undefined,
      });
      deps.addSystemMessage("Exporting session\u2026");
      break;
    case "/fork":
      dispatch("ht-agent-get-fork-messages", { agentId });
      deps.addSystemMessage("Fetching fork points\u2026");
      break;
    case "/tree":
      dispatch("ht-agent-get-session-tree", {
        agentId,
        sessionPath: view._state.sessionFile ?? undefined,
      });
      break;
    case "/settings":
      showSettingsDialog(view, deps);
      break;
    case "/hotkeys":
      showHotkeysMessage(view, deps);
      break;
    case "/clear":
      view._state.messages = [];
      deps.renderAllMessages();
      break;
    case "/help":
      showHelpMessage(view, deps);
      break;
    default:
      // Unknown slash command — send it as a prompt (pi might handle
      // it as a skill/template)
      cb.onSendPrompt(agentId, raw);
      break;
  }
}

/** Programmatic entry point: seed the input with `command` and then
 *  run it through the dispatcher. Used by the welcome screen and any
 *  future "quick-action" buttons. */
export function executeBuiltinCommand(
  view: AgentPaneView,
  cb: AgentPanelCallbacks,
  deps: SlashDeps,
  command: string,
): void {
  view._elements.inputEl.value = command;
  executeSlashCommand(view, cb, deps);
}
