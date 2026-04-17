/**
 * Agent-panel modal dialogs + extension-UI inbound handler.
 *
 * Extracted from agent-panel.ts to keep the 400-line renderDialog +
 * its surrounding show* helpers out of the main lifecycle file. Every
 * export takes an AgentPaneView plus a `DialogDeps` bundle so nothing
 * here reaches back into agent-panel's private render helpers via
 * import cycles — the deps are injected at the panel's construction
 * site and flow through unchanged.
 *
 * `renderDialog` inspects `view._state.activeDialog` and builds the
 * appropriate modal into `view._elements.dialogOverlay`. Callers
 * always populate `activeDialog` first and then hand off — the
 * `show*Dialog` helpers in this file bundle both steps.
 */

import { autoResize, dispatch, escapeHtml } from "./agent-panel-utils";
import type { AgentPaneView } from "./agent-panel";

export interface ExtensionDialog {
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: { label: string; value: string; description?: string }[];
  defaultValue?: string;
  placeholder?: string;
  selectedIndex: number;
  inputValue: string;
}

/** Callbacks the dialog module needs to reach back into the panel's
 *  render pipeline. Keeping the surface narrow means tests can fake
 *  them without standing up a real panel. */
export interface DialogDeps {
  addSystemMessage: (text: string) => void;
  renderWidgets: () => void;
  renderDropdowns: () => void;
  renderStats: () => void;
}

// ── Inbound extension UI events ───────────────────────────────────

/** Route an inbound pi extension UI event to the right side effect.
 *  Fire-and-forget methods (`notify`, `setStatus`, `setWidget`,
 *  `set_editor_text`, `setTitle`) don't touch `activeDialog`;
 *  modal methods populate it and hand off to renderDialog. An
 *  unknown `method` auto-cancels so the pi side never blocks. */
export function handleExtUI(
  view: AgentPaneView,
  ev: Record<string, unknown>,
  deps: DialogDeps,
): void {
  const method = ev["method"] as string;
  const id = ev["id"] as string;
  if (!method || !id) return;

  // Fire-and-forget methods
  if (method === "notify") {
    const level = (ev["notifyType"] as string) ?? "info";
    const msg = ev["message"] as string;
    deps.addSystemMessage(`[${level}] ${msg}`);
    return;
  }

  if (method === "setStatus") {
    const key = ev["statusKey"] as string;
    const text = ev["statusText"] as string | undefined;
    if (key && text) {
      const existing = view.chipsEl.querySelector(
        `[data-ck="${key}"]`,
      ) as HTMLSpanElement | null;
      if (existing) {
        existing.textContent = text;
      } else {
        const chip = document.createElement("span");
        chip.className = "surface-chip chip-agent-status";
        chip.dataset["ck"] = key;
        chip.textContent = text;
        view.chipsEl.appendChild(chip);
      }
    } else if (key) {
      // Remove status chip
      view.chipsEl.querySelector(`[data-ck="${key}"]`)?.remove();
    }
    return;
  }

  if (method === "setWidget") {
    const key = ev["widgetKey"] as string;
    const placement = (ev["widgetPlacement"] as string) ?? "aboveEditor";
    const lines = Array.isArray(ev["widgetLines"])
      ? (ev["widgetLines"] as string[])
      : null;
    const target =
      placement === "belowEditor"
        ? view._state.widgetsBelow
        : view._state.widgetsAbove;
    if (key && lines && lines.length > 0) target.set(key, lines);
    else if (key) target.delete(key);
    deps.renderWidgets();
    return;
  }

  if (method === "set_editor_text") {
    const text = (ev["text"] as string) ?? "";
    view._elements.inputEl.value = text;
    autoResize(view._elements.inputEl);
    view._elements.inputEl.focus();
    return;
  }

  if (method === "setTitle") {
    const title = ev["title"] as string;
    if (title) {
      view.titleEl.textContent = title;
      view.title = title;
    }
    return;
  }

  // Dialog methods
  if (method === "select") {
    const rawOptions = (ev["options"] as unknown[]) ?? [];
    const options = rawOptions.map((option) => {
      if (typeof option === "string") {
        return { label: option, value: option };
      }
      const rec = option as Record<string, unknown>;
      return {
        label: (rec["label"] as string) ?? (rec["value"] as string) ?? "",
        value: (rec["value"] as string) ?? (rec["label"] as string) ?? "",
        description: rec["description"] as string | undefined,
      };
    });
    view._state.activeDialog = {
      id,
      method,
      title: ev["title"] as string,
      message: ev["message"] as string,
      options,
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    return;
  }

  if (method === "confirm") {
    view._state.activeDialog = {
      id,
      method,
      title: ev["title"] as string,
      message: ev["message"] as string,
      options: [
        { label: "Yes", value: "true" },
        { label: "No", value: "false" },
      ],
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    return;
  }

  if (method === "input") {
    view._state.activeDialog = {
      id,
      method,
      title: ev["title"] as string,
      message: ev["message"] as string,
      placeholder: ev["placeholder"] as string,
      defaultValue: ev["defaultValue"] as string,
      selectedIndex: 0,
      inputValue: (ev["defaultValue"] as string) ?? "",
    };
    renderDialog(view, deps);
    return;
  }

  if (method === "editor") {
    view._state.activeDialog = {
      id,
      method,
      title: ev["title"] as string,
      message: ev["message"] as string,
      defaultValue: ev["defaultValue"] as string,
      selectedIndex: 0,
      inputValue: (ev["defaultValue"] as string) ?? "",
    };
    renderDialog(view, deps);
    return;
  }

  // Unknown dialog — auto-cancel
  dispatch("ht-agent-extension-ui-response", {
    agentId: view.agentId,
    id,
    response: { cancelled: true },
  });
}

// ── Modal renderer ────────────────────────────────────────────────

export function renderDialog(view: AgentPaneView, deps: DialogDeps): void {
  const { dialogOverlay } = view._elements;
  const d = view._state.activeDialog;
  if (!d) return;

  dialogOverlay.classList.remove("agent-dialog-hidden");
  dialogOverlay.innerHTML = "";

  const modal = document.createElement("div");
  modal.className = "agent-dialog";

  // Title
  if (d.title) {
    const title = document.createElement("div");
    title.className = "agent-dialog-title";
    title.textContent = d.title;
    modal.appendChild(title);
  }

  // Message
  if (d.message) {
    const msg = document.createElement("div");
    msg.className = "agent-dialog-msg";
    msg.textContent = d.message;
    modal.appendChild(msg);
  }

  if (d.method === "select" && d.options) {
    const list = document.createElement("div");
    list.className = "agent-dialog-list";
    for (let i = 0; i < d.options.length; i++) {
      const opt = d.options[i];
      const btn = document.createElement("button");
      btn.className = `agent-dialog-option${i === d.selectedIndex ? " agent-dialog-option-sel" : ""}`;
      const lbl = document.createElement("span");
      lbl.textContent = opt.label;
      btn.appendChild(lbl);
      if (opt.description) {
        const desc = document.createElement("span");
        desc.className = "agent-dialog-opt-desc";
        desc.textContent = opt.description;
        btn.appendChild(desc);
      }
      btn.addEventListener("click", () => {
        dispatch("ht-agent-extension-ui-response", {
          agentId: view.agentId,
          id: d.id,
          response: { value: opt.value },
        });
        view._state.activeDialog = null;
        dialogOverlay.classList.add("agent-dialog-hidden");
      });
      list.appendChild(btn);
    }
    modal.appendChild(list);
  }

  if (d.method === "confirm") {
    const actions = document.createElement("div");
    actions.className = "agent-dialog-actions";
    for (const [label, value] of [
      ["Yes", true],
      ["No", false],
    ] as const) {
      const btn = document.createElement("button");
      btn.className = `agent-dialog-btn${value ? " agent-dialog-btn-primary" : ""}`;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        dispatch("ht-agent-extension-ui-response", {
          agentId: view.agentId,
          id: d.id,
          response: { confirmed: value },
        });
        view._state.activeDialog = null;
        dialogOverlay.classList.add("agent-dialog-hidden");
      });
      actions.appendChild(btn);
    }
    modal.appendChild(actions);
  }

  if (d.method === "input" || d.method === "switch_session") {
    const input = document.createElement("input");
    input.className = "agent-dialog-input";
    input.type = "text";
    input.value = d.inputValue;
    input.placeholder = d.placeholder ?? "";
    input.addEventListener("input", () => {
      d.inputValue = input.value;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (d.method === "switch_session") {
          const sessionPath = input.value.trim();
          if (sessionPath) {
            dispatch("ht-agent-switch-session", {
              agentId: view.agentId,
              sessionPath,
            });
          }
        } else {
          dispatch("ht-agent-extension-ui-response", {
            agentId: view.agentId,
            id: d.id,
            response: { value: input.value },
          });
        }
        view._state.activeDialog = null;
        dialogOverlay.classList.add("agent-dialog-hidden");
      }
    });
    modal.appendChild(input);
    setTimeout(() => input.focus(), 50);

    const actions = document.createElement("div");
    actions.className = "agent-dialog-actions";
    const okBtn = document.createElement("button");
    okBtn.className = "agent-dialog-btn agent-dialog-btn-primary";
    okBtn.textContent = d.method === "switch_session" ? "Open" : "OK";
    okBtn.addEventListener("click", () => {
      if (d.method === "switch_session") {
        const sessionPath = input.value.trim();
        if (sessionPath) {
          dispatch("ht-agent-switch-session", {
            agentId: view.agentId,
            sessionPath,
          });
        }
      } else {
        dispatch("ht-agent-extension-ui-response", {
          agentId: view.agentId,
          id: d.id,
          response: { value: input.value },
        });
      }
      view._state.activeDialog = null;
      dialogOverlay.classList.add("agent-dialog-hidden");
    });
    actions.appendChild(okBtn);
    modal.appendChild(actions);
  }

  if (d.method === "editor") {
    const textarea = document.createElement("textarea");
    textarea.className = "agent-dialog-editor";
    textarea.value = d.inputValue;
    textarea.rows = 12;
    textarea.addEventListener("input", () => {
      d.inputValue = textarea.value;
    });
    modal.appendChild(textarea);
    setTimeout(() => textarea.focus(), 50);

    const actions = document.createElement("div");
    actions.className = "agent-dialog-actions";
    const okBtn = document.createElement("button");
    okBtn.className = "agent-dialog-btn agent-dialog-btn-primary";
    okBtn.textContent = "Submit";
    okBtn.addEventListener("click", () => {
      dispatch("ht-agent-extension-ui-response", {
        agentId: view.agentId,
        id: d.id,
        response: { value: textarea.value },
      });
      view._state.activeDialog = null;
      dialogOverlay.classList.add("agent-dialog-hidden");
    });
    actions.appendChild(okBtn);
    modal.appendChild(actions);
  }

  if (d.method === "session_browser") {
    const search = document.createElement("input");
    search.className = "agent-dialog-input";
    search.placeholder = "Search by name, cwd, preview, or path";
    search.value = view._state.sessionListFilter;
    modal.appendChild(search);

    const list = document.createElement("div");
    list.className = "agent-dialog-list agent-dialog-list-large";
    const renderList = () => {
      view._state.sessionListFilter = search.value.toLowerCase();
      list.innerHTML = "";
      const filtered = view._state.sessionList.filter((session) => {
        const hay = [session.name, session.cwd, session.preview, session.path]
          .filter(Boolean)
          .join("\n")
          .toLowerCase();
        return (
          !view._state.sessionListFilter ||
          hay.includes(view._state.sessionListFilter)
        );
      });
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "agent-dialog-opt-desc";
        empty.textContent = "No matching sessions.";
        list.appendChild(empty);
      }
      for (const session of filtered) {
        const btn = document.createElement("button");
        btn.className = "agent-dialog-option";
        const title = document.createElement("span");
        title.textContent = session.name || session.preview || session.path;
        btn.appendChild(title);
        const desc = document.createElement("span");
        desc.className = "agent-dialog-opt-desc";
        desc.textContent = `${session.cwd ?? ""} • ${new Date(session.updatedAt).toLocaleString()}\n${session.path}`;
        btn.appendChild(desc);
        btn.addEventListener("click", () => {
          dispatch("ht-agent-switch-session", {
            agentId: view.agentId,
            sessionPath: session.path,
          });
          view._state.activeDialog = null;
          dialogOverlay.classList.add("agent-dialog-hidden");
        });
        list.appendChild(btn);
      }
    };
    search.addEventListener("input", renderList);
    renderList();
    modal.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "agent-dialog-actions";
    const manualBtn = document.createElement("button");
    manualBtn.className = "agent-dialog-btn";
    manualBtn.textContent = "Open by path…";
    manualBtn.addEventListener("click", () => {
      showSwitchSessionDialog(view, deps);
    });
    actions.appendChild(manualBtn);
    modal.appendChild(actions);
    setTimeout(() => search.focus(), 30);
  }

  if (d.method === "tree_browser") {
    const list = document.createElement("div");
    list.className = "agent-dialog-list agent-dialog-list-large";
    if (view._state.sessionTree.length === 0) {
      const empty = document.createElement("div");
      empty.className = "agent-dialog-opt-desc";
      empty.textContent = "No session tree data available.";
      list.appendChild(empty);
    }
    for (const node of view._state.sessionTree) {
      const btn = document.createElement("button");
      btn.className = "agent-dialog-option agent-tree-node";
      btn.style.paddingLeft = `${10 + node.depth * 18}px`;
      if (node.active) btn.classList.add("agent-dialog-option-sel");
      const title = document.createElement("span");
      title.innerHTML = `<span class="agent-tree-role agent-tree-role-${escapeHtml(node.role)}">${escapeHtml(node.role)}</span> ${escapeHtml(node.text.slice(0, 120) || node.entryType)}`;
      btn.appendChild(title);
      const desc = document.createElement("span");
      desc.className = "agent-dialog-opt-desc";
      desc.textContent = `${node.timestamp ?? ""}${node.active ? " • active leaf" : ""}${node.childCount > 0 ? ` • ${node.childCount} child${node.childCount === 1 ? "" : "ren"}` : ""}`;
      btn.appendChild(desc);
      btn.addEventListener("click", () => {
        if (node.role === "user") {
          dispatch("ht-agent-fork", {
            agentId: view.agentId,
            entryId: node.id,
          });
        } else {
          deps.addSystemMessage(
            "Only user nodes can currently be branched via RPC; select a user node to fork from that point.",
          );
        }
        view._state.activeDialog = null;
        dialogOverlay.classList.add("agent-dialog-hidden");
      });
      list.appendChild(btn);
    }
    modal.appendChild(list);
  }

  if (d.method === "settings") {
    const list = document.createElement("div");
    list.className = "agent-dialog-list";

    const addToggle = (
      label: string,
      value: string,
      description: string,
      action: () => void,
      active = false,
    ) => {
      const btn = document.createElement("button");
      btn.className = `agent-dialog-option${active ? " agent-dialog-option-sel" : ""}`;
      const lbl = document.createElement("span");
      lbl.textContent = `${label}: ${value}`;
      btn.appendChild(lbl);
      const desc = document.createElement("span");
      desc.className = "agent-dialog-opt-desc";
      desc.textContent = description;
      btn.appendChild(desc);
      btn.addEventListener("click", action);
      list.appendChild(btn);
    };

    addToggle(
      "Steering delivery",
      view._state.steeringMode,
      "Choose whether queued steering messages are delivered all at once or one at a time.",
      () => {
        dispatch("ht-agent-set-steering-mode", {
          agentId: view.agentId,
          mode: view._state.steeringMode === "all" ? "one-at-a-time" : "all",
        });
        dismissDialog(view);
      },
      true,
    );

    addToggle(
      "Follow-up delivery",
      view._state.followUpMode,
      "Choose whether follow-up messages are delivered all at once or one at a time.",
      () => {
        dispatch("ht-agent-set-follow-up-mode", {
          agentId: view.agentId,
          mode: view._state.followUpMode === "all" ? "one-at-a-time" : "all",
        });
        dismissDialog(view);
      },
    );

    addToggle(
      "Auto compaction",
      view._state.autoCompactionEnabled ? "on" : "off",
      "Automatically compact the session when context pressure gets high.",
      () => {
        dispatch("ht-agent-set-auto-compaction", {
          agentId: view.agentId,
          enabled: !view._state.autoCompactionEnabled,
        });
        dismissDialog(view);
      },
    );

    addToggle(
      "Auto retry",
      view._state.autoRetryEnabled ? "on" : "off",
      "Retry transient provider failures like rate limits or overloaded responses.",
      () => {
        dispatch("ht-agent-set-auto-retry", {
          agentId: view.agentId,
          enabled: !view._state.autoRetryEnabled,
        });
        dismissDialog(view);
      },
    );

    addToggle(
      "Scoped models",
      `${view._state.scopedModelIds.size}`,
      "Ctrl+P cycles only models included in the scope. Manage the scope from the model picker.",
      () => {
        view._state.showModelSelector = true;
        view._state.showThinkingSelector = false;
        deps.renderDropdowns();
        dismissDialog(view);
        dispatch("ht-agent-get-models", { agentId: view.agentId });
      },
    );

    addToggle(
      "Resume browser",
      "open",
      "Browse recent pi sessions with metadata instead of typing a path manually.",
      () => {
        dismissDialog(view);
        dispatch("ht-agent-list-sessions", { agentId: view.agentId });
      },
    );

    addToggle(
      "Tree browser",
      "open",
      "Browse the current session tree and fork from earlier user nodes.",
      () => {
        dismissDialog(view);
        dispatch("ht-agent-get-session-tree", {
          agentId: view.agentId,
          sessionPath: view._state.sessionFile ?? undefined,
        });
      },
    );

    modal.appendChild(list);
  }

  // Cancel button for all dialogs
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "agent-dialog-cancel";
  cancelBtn.textContent = "Cancel (Esc)";
  cancelBtn.addEventListener("click", () => dismissDialog(view));
  modal.appendChild(cancelBtn);

  dialogOverlay.appendChild(modal);

  // Click outside to dismiss
  dialogOverlay.addEventListener(
    "click",
    (e) => {
      if (e.target === dialogOverlay) dismissDialog(view);
    },
    { once: true },
  );
}

/** Dismiss the active dialog, notifying pi if this was an
 *  extension-initiated one (ids starting with `__` are panel-local
 *  and don't round-trip). */
export function dismissDialog(view: AgentPaneView): void {
  const d = view._state.activeDialog;
  if (d) {
    if (!d.id.startsWith("__")) {
      dispatch("ht-agent-extension-ui-response", {
        agentId: view.agentId,
        id: d.id,
        response: { cancelled: true },
      });
    }
    view._state.activeDialog = null;
    view._elements.dialogOverlay.classList.add("agent-dialog-hidden");
  }
}

// ── Panel-initiated dialogs ──────────────────────────────────────

export function showSessionStats(view: AgentPaneView, deps: DialogDeps): void {
  const el = view._elements;
  el.statsEl.classList.toggle("agent-stats-hidden");
  deps.renderStats();
  if (!el.statsEl.classList.contains("agent-stats-hidden")) {
    dispatch("ht-agent-get-session-stats", { agentId: view.agentId });
  }
}

export function showSettingsDialog(
  view: AgentPaneView,
  deps: DialogDeps,
): void {
  view._state.activeDialog = {
    id: "__settings__",
    method: "settings",
    title: "Agent settings",
    selectedIndex: 0,
    inputValue: "",
  };
  renderDialog(view, deps);
}

export function showSwitchSessionDialog(
  view: AgentPaneView,
  deps: DialogDeps,
  initialValue = "",
): void {
  view._state.activeDialog = {
    id: "__switch_session__",
    method: "switch_session",
    title: "Open session",
    message:
      "Enter an absolute session file path (.jsonl) created by pi. You can also use /resume without arguments for the session browser.",
    placeholder: "/Users/you/.pi/agent/sessions/.../session.jsonl",
    defaultValue: initialValue,
    selectedIndex: 0,
    inputValue: initialValue,
  };
  renderDialog(view, deps);
}

export function showSessionBrowserDialog(
  view: AgentPaneView,
  deps: DialogDeps,
): void {
  view._state.activeDialog = {
    id: "__session_browser__",
    method: "session_browser",
    title: "Recent pi sessions",
    message: "Open a previous session or fall back to manual path entry.",
    selectedIndex: 0,
    inputValue: view._state.sessionListFilter,
  };
  renderDialog(view, deps);
}

export function showTreeDialog(view: AgentPaneView, deps: DialogDeps): void {
  view._state.activeDialog = {
    id: "__tree__",
    method: "tree_browser",
    title: "Session tree",
    message:
      "Browse the current session tree. Selecting a user node creates a forked session from that point.",
    selectedIndex: 0,
    inputValue: "",
  };
  renderDialog(view, deps);
}

export function showHotkeysMessage(
  _view: AgentPaneView,
  deps: DialogDeps,
): void {
  const lines = [
    "Keyboard Shortcuts:",
    "  Enter          Send message",
    "  Shift+Enter    New line",
    "  Alt+Enter      Queue follow-up",
    "  Escape         Abort / dismiss",
    "  Ctrl+P         Cycle scoped models forward",
    "  Shift+Ctrl+P   Cycle scoped models backward",
    "  Shift+Tab      Cycle thinking level",
    "  /              Open command menu",
    "  !command       Execute bash command",
    "  Paste/drop     Attach image to next prompt",
  ];
  deps.addSystemMessage(lines.join("\n"));
}

export function showHelpMessage(view: AgentPaneView, deps: DialogDeps): void {
  const lines = view._state.commands.map(
    (c) => `  ${c.name.padEnd(14)} ${c.description}`,
  );
  deps.addSystemMessage("Available commands:\n" + lines.join("\n"));
}

export function showForkDialog(
  view: AgentPaneView,
  deps: DialogDeps,
  entries: { entryId: string; text: string }[],
): void {
  view._state.activeDialog = {
    id: "__fork__",
    method: "select",
    title: "Fork from message",
    message: "Select a message to fork from:",
    options: entries.map((e) => ({
      label: e.text.slice(0, 80) + (e.text.length > 80 ? "\u2026" : ""),
      value: e.entryId,
      description: e.entryId,
    })),
    selectedIndex: 0,
    inputValue: "",
  };

  renderDialog(view, deps);

  // Patch the dialog buttons to call fork instead of extension UI
  const overlay = view._elements.dialogOverlay;
  const buttons = overlay.querySelectorAll(".agent-dialog-option");
  buttons.forEach((btn, i) => {
    const clone = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(clone);
    clone.addEventListener("click", () => {
      const entry = entries[i];
      dispatch("ht-agent-fork", {
        agentId: view.agentId,
        entryId: entry.entryId,
      });
      deps.addSystemMessage(`Forked from: ${entry.text.slice(0, 60)}`);
      view._state.activeDialog = null;
      overlay.classList.add("agent-dialog-hidden");
    });
  });
}
