import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Scoped DOM — see tests/agent-panel-messages.test.ts for rationale.
beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import {
  type DialogDeps,
  dismissDialog,
  handleExtUI,
  renderDialog,
  showForkDialog,
  showHelpMessage,
  showHotkeysMessage,
  showSessionBrowserDialog,
  showSessionStats,
  showSettingsDialog,
  showSwitchSessionDialog,
  showTreeDialog,
} from "../src/views/terminal/agent-panel-dialogs";
import type {
  AgentPaneView,
  AgentPanelState,
  SlashCommand,
} from "../src/views/terminal/agent-panel";

// ------------------------------------------------------------------
// Test view + deps factory (pared down from agent-panel-response)
// ------------------------------------------------------------------

function makeView(agentId = "agent-1"): AgentPaneView {
  const mk = <T extends keyof HTMLElementTagNameMap>(
    tag: T,
  ): HTMLElementTagNameMap[T] => document.createElement(tag);

  const state: AgentPanelState = {
    messages: [],
    currentText: "",
    currentThinking: "",
    isStreaming: false,
    isCompacting: false,
    model: null,
    thinkingLevel: "off",
    toolCalls: new Map(),
    availableModels: null,
    sessionStats: null,
    autoScroll: true,
    showModelSelector: false,
    showThinkingSelector: false,
    retryState: null,
    turnCount: 0,
    totalToolCalls: 0,
    sessionName: null,
    sessionFile: null,
    sessionId: null,
    messageCount: 0,
    pendingMessageCount: 0,
    autoCompactionEnabled: false,
    autoRetryEnabled: false,
    steeringMode: "all",
    followUpMode: "all",
    pendingSteer: 0,
    pendingFollowUp: 0,
    widgetsAbove: new Map(),
    widgetsBelow: new Map(),
    pendingImages: [],
    dragActive: false,
    scopedModelIds: new Set(),
    sessionList: [],
    sessionListFilter: "",
    sessionTree: [],
    commands: [],
    showSlashMenu: false,
    slashFilter: "",
    slashSelectedIndex: 0,
    activeDialog: null,
  };

  const chipsEl = mk("div");
  const dialogOverlay = mk("div");
  // Attach to body so setTimeout-based focus calls don't throw under happy-dom.
  document.body.appendChild(dialogOverlay);

  return {
    agentId,
    surfaceId: agentId,
    container: mk("div"),
    titleEl: mk("span"),
    chipsEl,
    title: "",
    _state: state,
    _elements: {
      messagesEl: mk("div"),
      inputEl: mk("textarea"),
      inputBarEl: mk("div"),
      footerEl: mk("div"),
      sendBtn: mk("button"),
      modelBtnLabel: mk("span"),
      thinkingBtnLabel: mk("span"),
      modelSelectorEl: mk("div"),
      thinkingSelectorEl: mk("div"),
      toolbarEl: mk("div"),
      streamingIndicator: mk("div"),
      contextMeter: mk("div"),
      contextMeterFill: mk("div"),
      contextMeterLabel: mk("span"),
      slashMenuEl: mk("div"),
      dialogOverlay,
      sessionNameEl: mk("span"),
      statsEl: mk("div"),
      widgetsAboveEl: mk("div"),
      widgetsBelowEl: mk("div"),
      attachmentTrayEl: mk("div"),
      modelMetaEl: mk("div"),
    },
  };
}

function makeDeps(): DialogDeps {
  return {
    addSystemMessage: mock(() => {}),
    renderWidgets: mock(() => {}),
    renderDropdowns: mock(() => {}),
    renderStats: mock(() => {}),
  };
}

let view: AgentPaneView;
let deps: DialogDeps;
const dispatched: { type: string; detail: unknown }[] = [];
const dispatchListener = (e: Event) => {
  dispatched.push({ type: e.type, detail: (e as CustomEvent).detail });
};

beforeEach(() => {
  view = makeView();
  deps = makeDeps();
  dispatched.length = 0;
  // Watch every dispatch-typed event the dialogs module ever emits so we
  // can assert on outgoing RPC requests without tapping into
  // agent-panel-utils internals.
  for (const evt of [
    "ht-agent-extension-ui-response",
    "ht-agent-switch-session",
    "ht-agent-fork",
    "ht-agent-set-steering-mode",
    "ht-agent-set-follow-up-mode",
    "ht-agent-set-auto-compaction",
    "ht-agent-set-auto-retry",
    "ht-agent-list-sessions",
    "ht-agent-get-session-tree",
    "ht-agent-get-session-stats",
    "ht-agent-get-models",
  ]) {
    window.addEventListener(evt, dispatchListener);
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  for (const evt of [
    "ht-agent-extension-ui-response",
    "ht-agent-switch-session",
    "ht-agent-fork",
    "ht-agent-set-steering-mode",
    "ht-agent-set-follow-up-mode",
    "ht-agent-set-auto-compaction",
    "ht-agent-set-auto-retry",
    "ht-agent-list-sessions",
    "ht-agent-get-session-tree",
    "ht-agent-get-session-stats",
    "ht-agent-get-models",
  ]) {
    window.removeEventListener(evt, dispatchListener);
  }
});

// ------------------------------------------------------------------
// dismissDialog
// ------------------------------------------------------------------

describe("dismissDialog", () => {
  test("clears activeDialog and hides overlay", () => {
    view._state.activeDialog = {
      id: "dlg-1",
      method: "input",
      selectedIndex: 0,
      inputValue: "",
    };
    dismissDialog(view);
    expect(view._state.activeDialog).toBeNull();
    expect(
      view._elements.dialogOverlay.classList.contains("agent-dialog-hidden"),
    ).toBe(true);
  });

  test("dispatches cancelled response for extension-initiated dialogs", () => {
    view._state.activeDialog = {
      id: "ext-42",
      method: "input",
      selectedIndex: 0,
      inputValue: "",
    };
    dismissDialog(view);
    const sent = dispatched.find(
      (d) => d.type === "ht-agent-extension-ui-response",
    );
    expect(sent).toBeDefined();
    expect((sent!.detail as { id: string }).id).toBe("ext-42");
    expect((sent!.detail as { response: unknown }).response).toEqual({
      cancelled: true,
    });
  });

  test("panel-local ids (prefixed __) do NOT round-trip to pi", () => {
    view._state.activeDialog = {
      id: "__settings__",
      method: "settings",
      selectedIndex: 0,
      inputValue: "",
    };
    dismissDialog(view);
    expect(
      dispatched.find((d) => d.type === "ht-agent-extension-ui-response"),
    ).toBeUndefined();
    expect(view._state.activeDialog).toBeNull();
  });

  test("no-op when there's no active dialog", () => {
    expect(view._state.activeDialog).toBeNull();
    expect(() => dismissDialog(view)).not.toThrow();
    expect(dispatched.length).toBe(0);
  });
});

// ------------------------------------------------------------------
// handleExtUI routing
// ------------------------------------------------------------------

describe("handleExtUI", () => {
  test("ignores events missing method or id", () => {
    handleExtUI(view, {}, deps);
    handleExtUI(view, { method: "notify" }, deps);
    handleExtUI(view, { id: "x" }, deps);
    expect(deps.addSystemMessage).not.toHaveBeenCalled();
    expect(view._state.activeDialog).toBeNull();
  });

  test("notify prepends level and forwards to addSystemMessage", () => {
    handleExtUI(
      view,
      { method: "notify", id: "n1", notifyType: "warn", message: "hi" },
      deps,
    );
    expect(deps.addSystemMessage).toHaveBeenCalledWith("[warn] hi");
  });

  test("setStatus adds a chip when (key, text) both present", () => {
    handleExtUI(
      view,
      { method: "setStatus", id: "s1", statusKey: "k", statusText: "running" },
      deps,
    );
    const chip = view.chipsEl.querySelector('[data-ck="k"]');
    expect(chip?.textContent).toBe("running");
  });

  test("setStatus updates an existing chip in place rather than duplicating", () => {
    handleExtUI(
      view,
      { method: "setStatus", id: "s1", statusKey: "k", statusText: "first" },
      deps,
    );
    handleExtUI(
      view,
      { method: "setStatus", id: "s2", statusKey: "k", statusText: "second" },
      deps,
    );
    const chips = view.chipsEl.querySelectorAll('[data-ck="k"]');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toBe("second");
  });

  test("setStatus with no text removes the chip", () => {
    handleExtUI(
      view,
      { method: "setStatus", id: "s1", statusKey: "k", statusText: "v" },
      deps,
    );
    handleExtUI(view, { method: "setStatus", id: "s2", statusKey: "k" }, deps);
    expect(view.chipsEl.querySelector('[data-ck="k"]')).toBeNull();
  });

  test("setWidget sets/unsets lines and triggers renderWidgets", () => {
    handleExtUI(
      view,
      {
        method: "setWidget",
        id: "w1",
        widgetKey: "retry",
        widgetLines: ["line-a"],
      },
      deps,
    );
    expect(view._state.widgetsAbove.get("retry")).toEqual(["line-a"]);

    handleExtUI(
      view,
      {
        method: "setWidget",
        id: "w2",
        widgetKey: "retry",
        widgetPlacement: "belowEditor",
        widgetLines: ["below"],
      },
      deps,
    );
    expect(view._state.widgetsBelow.get("retry")).toEqual(["below"]);

    // Empty lines removes the key.
    handleExtUI(
      view,
      {
        method: "setWidget",
        id: "w3",
        widgetKey: "retry",
        widgetLines: null,
      },
      deps,
    );
    expect(view._state.widgetsAbove.has("retry")).toBe(false);

    expect(deps.renderWidgets).toHaveBeenCalledTimes(3);
  });

  test("set_editor_text writes value and focuses input", () => {
    document.body.appendChild(view._elements.inputEl);
    handleExtUI(
      view,
      { method: "set_editor_text", id: "e1", text: "prefilled" },
      deps,
    );
    expect(view._elements.inputEl.value).toBe("prefilled");
  });

  test("setTitle updates both view.title and titleEl textContent", () => {
    handleExtUI(view, { method: "setTitle", id: "t1", title: "New" }, deps);
    expect(view.title).toBe("New");
    expect(view.titleEl.textContent).toBe("New");
  });

  test("select stores normalized options and renders a modal", () => {
    handleExtUI(
      view,
      {
        method: "select",
        id: "sel-1",
        title: "Pick",
        options: [
          "raw-string",
          { label: "Labelled", value: "v1", description: "hint" },
        ],
      },
      deps,
    );
    expect(view._state.activeDialog?.options).toHaveLength(2);
    expect(view._state.activeDialog?.options?.[0]).toEqual({
      label: "raw-string",
      value: "raw-string",
    });
    expect(view._state.activeDialog?.options?.[1]).toEqual({
      label: "Labelled",
      value: "v1",
      description: "hint",
    });
    // Modal rendered.
    expect(
      view._elements.dialogOverlay.querySelectorAll(".agent-dialog-option")
        .length,
    ).toBe(2);
  });

  test("confirm populates Yes/No options", () => {
    handleExtUI(
      view,
      { method: "confirm", id: "c1", title: "Sure?", message: "Really?" },
      deps,
    );
    const labels = view._state.activeDialog?.options?.map((o) => o.label);
    expect(labels).toEqual(["Yes", "No"]);
  });

  test("input seeds inputValue from defaultValue", () => {
    handleExtUI(
      view,
      {
        method: "input",
        id: "i1",
        title: "Name",
        placeholder: "type…",
        defaultValue: "seeded",
      },
      deps,
    );
    expect(view._state.activeDialog?.inputValue).toBe("seeded");
    expect(view._state.activeDialog?.placeholder).toBe("type…");
  });

  test("unknown method auto-cancels and sends extension-ui-response", () => {
    handleExtUI(view, { method: "wtf", id: "u1" }, deps);
    const sent = dispatched.find(
      (d) => d.type === "ht-agent-extension-ui-response",
    );
    expect(sent).toBeDefined();
    expect((sent!.detail as { response: unknown }).response).toEqual({
      cancelled: true,
    });
    expect(view._state.activeDialog).toBeNull();
  });
});

// ------------------------------------------------------------------
// renderDialog variants
// ------------------------------------------------------------------

describe("renderDialog", () => {
  test("select: clicking an option dispatches extension-ui-response with that value", () => {
    view._state.activeDialog = {
      id: "sel-1",
      method: "select",
      title: "Pick",
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
      selectedIndex: 1,
      inputValue: "",
    };
    renderDialog(view, deps);
    const btns =
      view._elements.dialogOverlay.querySelectorAll<HTMLButtonElement>(
        ".agent-dialog-option",
      );
    // Second option has sel class from selectedIndex.
    expect(btns[1].classList.contains("agent-dialog-option-sel")).toBe(true);
    btns[0].click();
    const sent = dispatched.find(
      (d) => d.type === "ht-agent-extension-ui-response",
    );
    expect((sent!.detail as { response: unknown }).response).toEqual({
      value: "a",
    });
    expect(view._state.activeDialog).toBeNull();
  });

  test("confirm: Yes button dispatches confirmed=true, No button dispatches confirmed=false", () => {
    view._state.activeDialog = {
      id: "c1",
      method: "confirm",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    const [yes] =
      view._elements.dialogOverlay.querySelectorAll<HTMLButtonElement>(
        ".agent-dialog-btn",
      );
    yes.click();
    expect(
      (
        dispatched.find((d) => d.type === "ht-agent-extension-ui-response")!
          .detail as { response: unknown }
      ).response,
    ).toEqual({ confirmed: true });

    // Reset and click No
    dispatched.length = 0;
    view._state.activeDialog = {
      id: "c2",
      method: "confirm",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    const noBtn =
      view._elements.dialogOverlay.querySelectorAll<HTMLButtonElement>(
        ".agent-dialog-btn",
      )[1];
    noBtn.click();
    expect(
      (
        dispatched.find((d) => d.type === "ht-agent-extension-ui-response")!
          .detail as { response: unknown }
      ).response,
    ).toEqual({ confirmed: false });
  });

  test("input: Enter key submits current input value", () => {
    view._state.activeDialog = {
      id: "i1",
      method: "input",
      placeholder: "",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    const input = view._elements.dialogOverlay.querySelector<HTMLInputElement>(
      ".agent-dialog-input",
    )!;
    input.value = "typed";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const sent = dispatched.find(
      (d) => d.type === "ht-agent-extension-ui-response",
    );
    expect((sent!.detail as { response: unknown }).response).toEqual({
      value: "typed",
    });
  });

  test("switch_session: Enter routes to ht-agent-switch-session with the path", () => {
    view._state.activeDialog = {
      id: "__switch_session__",
      method: "switch_session",
      placeholder: "",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    const input = view._elements.dialogOverlay.querySelector<HTMLInputElement>(
      ".agent-dialog-input",
    )!;
    input.value = "  /tmp/session.jsonl  "; // surrounding whitespace trimmed
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const sent = dispatched.find((d) => d.type === "ht-agent-switch-session");
    expect(sent).toBeDefined();
    expect((sent!.detail as { sessionPath: string }).sessionPath).toBe(
      "/tmp/session.jsonl",
    );
  });

  test("session_browser shows empty-state when no matches, filters live", () => {
    view._state.sessionList = [
      {
        path: "/x.jsonl",
        updatedAt: 1,
        name: "alpha",
        cwd: "/home/u",
        preview: "hello",
      },
      {
        path: "/y.jsonl",
        updatedAt: 2,
        name: "beta",
        cwd: "/home/u",
        preview: "world",
      },
    ];
    view._state.activeDialog = {
      id: "__session_browser__",
      method: "session_browser",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    // Both sessions present.
    let options = view._elements.dialogOverlay.querySelectorAll(
      ".agent-dialog-option",
    );
    expect(options.length).toBe(2);

    const search = view._elements.dialogOverlay.querySelector<HTMLInputElement>(
      ".agent-dialog-input",
    )!;
    search.value = "alpha";
    search.dispatchEvent(new Event("input"));
    options = view._elements.dialogOverlay.querySelectorAll(
      ".agent-dialog-option",
    );
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain("alpha");

    // No-match path
    search.value = "zzzzzz";
    search.dispatchEvent(new Event("input"));
    expect(
      view._elements.dialogOverlay
        .querySelector(".agent-dialog-list")!
        .textContent?.includes("No matching sessions"),
    ).toBe(true);
  });

  test("tree_browser: clicking a user node dispatches fork; non-user node logs a system message", () => {
    view._state.sessionTree = [
      {
        id: "u1",
        parentId: null,
        depth: 0,
        role: "user",
        entryType: "message",
        text: "q",
        childCount: 0,
        active: true,
      },
      {
        id: "a1",
        parentId: "u1",
        depth: 1,
        role: "assistant",
        entryType: "message",
        text: "a",
        childCount: 0,
        active: false,
      },
    ];
    view._state.activeDialog = {
      id: "__tree__",
      method: "tree_browser",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    const [, assistantBtn] =
      view._elements.dialogOverlay.querySelectorAll<HTMLButtonElement>(
        ".agent-dialog-option",
      );
    // Assistant first: should not fork, should log.
    assistantBtn.click();
    expect(dispatched.find((d) => d.type === "ht-agent-fork")).toBeUndefined();
    expect(deps.addSystemMessage).toHaveBeenCalled();

    // Re-open (click closed it) and click the user node.
    view._state.activeDialog = {
      id: "__tree__",
      method: "tree_browser",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    const fresh =
      view._elements.dialogOverlay.querySelectorAll<HTMLButtonElement>(
        ".agent-dialog-option",
      )[0];
    fresh.click();
    const fork = dispatched.find((d) => d.type === "ht-agent-fork");
    expect(fork).toBeDefined();
    expect((fork!.detail as { entryId: string }).entryId).toBe("u1");
  });

  test("tree_browser empty-state renders when sessionTree is empty", () => {
    view._state.sessionTree = [];
    view._state.activeDialog = {
      id: "__tree__",
      method: "tree_browser",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    expect(
      view._elements.dialogOverlay.textContent?.includes(
        "No session tree data available",
      ),
    ).toBe(true);
  });

  test("settings dialog contains all 7 toggle rows", () => {
    view._state.activeDialog = {
      id: "__settings__",
      method: "settings",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    const toggles = view._elements.dialogOverlay.querySelectorAll(
      ".agent-dialog-option",
    );
    expect(toggles.length).toBe(7);
  });

  test("every dialog renders a cancel button that dismisses on click", () => {
    view._state.activeDialog = {
      id: "__tree__",
      method: "tree_browser",
      selectedIndex: 0,
      inputValue: "",
    };
    renderDialog(view, deps);
    const cancel =
      view._elements.dialogOverlay.querySelector<HTMLButtonElement>(
        ".agent-dialog-cancel",
      )!;
    expect(cancel.textContent).toContain("Cancel");
    cancel.click();
    expect(view._state.activeDialog).toBeNull();
  });
});

// ------------------------------------------------------------------
// show* helpers populate activeDialog + render
// ------------------------------------------------------------------

describe("show*Dialog helpers", () => {
  test("showSettingsDialog sets id/method and renders", () => {
    showSettingsDialog(view, deps);
    expect(view._state.activeDialog?.id).toBe("__settings__");
    expect(view._state.activeDialog?.method).toBe("settings");
    expect(
      view._elements.dialogOverlay.classList.contains("agent-dialog-hidden"),
    ).toBe(false);
  });

  test("showSwitchSessionDialog seeds inputValue from the initialValue arg", () => {
    showSwitchSessionDialog(view, deps, "/prefilled.jsonl");
    expect(view._state.activeDialog?.inputValue).toBe("/prefilled.jsonl");
    const input = view._elements.dialogOverlay.querySelector<HTMLInputElement>(
      ".agent-dialog-input",
    )!;
    expect(input.value).toBe("/prefilled.jsonl");
  });

  test("showSessionBrowserDialog carries over the saved filter text", () => {
    view._state.sessionListFilter = "match";
    showSessionBrowserDialog(view, deps);
    expect(view._state.activeDialog?.inputValue).toBe("match");
  });

  test("showTreeDialog sets __tree__ id", () => {
    showTreeDialog(view, deps);
    expect(view._state.activeDialog?.id).toBe("__tree__");
    expect(view._state.activeDialog?.method).toBe("tree_browser");
  });

  test("showForkDialog renders one option per entry and re-wires clicks to fork", () => {
    showForkDialog(view, deps, [
      { entryId: "e1", text: "first question" },
      { entryId: "e2", text: "second question" },
    ]);
    const btns =
      view._elements.dialogOverlay.querySelectorAll<HTMLButtonElement>(
        ".agent-dialog-option",
      );
    expect(btns.length).toBe(2);
    btns[1].click();
    const fork = dispatched.find((d) => d.type === "ht-agent-fork");
    expect(fork).toBeDefined();
    expect((fork!.detail as { entryId: string }).entryId).toBe("e2");
    // addSystemMessage should log the 'Forked from:' hint.
    expect(deps.addSystemMessage).toHaveBeenCalled();
  });

  test("showForkDialog truncates long entry labels with an ellipsis", () => {
    const longText = "x".repeat(200);
    showForkDialog(view, deps, [{ entryId: "e1", text: longText }]);
    const btn = view._elements.dialogOverlay.querySelector(
      ".agent-dialog-option span",
    );
    expect(btn?.textContent?.endsWith("\u2026")).toBe(true);
  });

  test("showHotkeysMessage calls addSystemMessage with a keyboard-shortcuts block", () => {
    showHotkeysMessage(view, deps);
    const call = (deps.addSystemMessage as ReturnType<typeof mock>).mock
      .calls[0]?.[0] as string;
    expect(call).toContain("Keyboard Shortcuts");
    expect(call).toContain("Enter");
    expect(call).toContain("Ctrl+P");
    // Must not open a modal.
    expect(view._state.activeDialog).toBeNull();
  });

  test("showHelpMessage uses the state's current commands list", () => {
    view._state.commands = [
      { name: "/foo", description: "does foo", source: "builtin" },
      { name: "/bar", description: "does bar", source: "extension" },
    ] as SlashCommand[];
    showHelpMessage(view, deps);
    const call = (deps.addSystemMessage as ReturnType<typeof mock>).mock
      .calls[0]?.[0] as string;
    expect(call).toContain("/foo");
    expect(call).toContain("does foo");
    expect(call).toContain("/bar");
  });

  test("showSessionStats toggles the stats panel + triggers renderStats + fetches stats when opening", () => {
    view._elements.statsEl.classList.add("agent-stats-hidden");
    showSessionStats(view, deps);
    expect(
      view._elements.statsEl.classList.contains("agent-stats-hidden"),
    ).toBe(false);
    expect(deps.renderStats).toHaveBeenCalled();
    expect(
      dispatched.find((d) => d.type === "ht-agent-get-session-stats"),
    ).toBeDefined();

    // Toggle back — no further fetch.
    dispatched.length = 0;
    showSessionStats(view, deps);
    expect(
      view._elements.statsEl.classList.contains("agent-stats-hidden"),
    ).toBe(true);
    expect(
      dispatched.find((d) => d.type === "ht-agent-get-session-stats"),
    ).toBeUndefined();
  });
});
