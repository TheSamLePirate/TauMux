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
  BUILTIN_COMMANDS,
  executeBuiltinCommand,
  executeSlashCommand,
  getFilteredCommands,
  handleSlashInput,
  hideSlashMenu,
  renderSlashMenu,
  type SlashDeps,
} from "../src/views/terminal/agent-panel-slash";
import type {
  AgentPaneView,
  AgentPanelCallbacks,
  AgentPanelState,
  SlashCommand,
} from "../src/views/terminal/agent-panel";

// ------------------------------------------------------------------
// Factories
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
    commands: [...BUILTIN_COMMANDS],
    showSlashMenu: false,
    slashFilter: "",
    slashSelectedIndex: 0,
    activeDialog: null,
  };

  const dialogOverlay = mk("div");
  const inputEl = mk("textarea");
  const slashMenuEl = mk("div");
  // Put the DOM nodes into the document so .focus() / event dispatch
  // paths that walk up parents (e.g. welcome-button click) don't throw.
  document.body.append(dialogOverlay, inputEl, slashMenuEl);

  return {
    agentId,
    surfaceId: agentId,
    container: mk("div"),
    titleEl: mk("span"),
    chipsEl: mk("div"),
    title: "",
    _state: state,
    _elements: {
      messagesEl: mk("div"),
      inputEl,
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
      slashMenuEl,
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

function makeDeps(): SlashDeps {
  return {
    addSystemMessage: mock(() => {}),
    renderWidgets: mock(() => {}),
    renderDropdowns: mock(() => {}),
    renderStats: mock(() => {}),
    renderAllMessages: mock(() => {}),
  };
}

function makeCallbacks(): AgentPanelCallbacks {
  return {
    onSendPrompt: mock(() => {}),
    onAbort: mock(() => {}),
    onSetModel: mock(() => {}),
    onSetThinking: mock(() => {}),
    onNewSession: mock(() => {}),
    onCompact: mock(() => {}),
    onClose: mock(() => {}),
    onSplit: mock(() => {}),
    onFocus: mock(() => {}),
    onGetModels: mock(() => {}),
    onGetState: mock(() => {}),
  };
}

let view: AgentPaneView;
let deps: SlashDeps;
let cb: AgentPanelCallbacks;
const dispatched: { type: string; detail: unknown }[] = [];
const dispatchListener = (e: Event) => {
  dispatched.push({ type: e.type, detail: (e as CustomEvent).detail });
};
const DISPATCHED_EVENTS = [
  "ht-agent-list-sessions",
  "ht-agent-set-model",
  "ht-agent-compact",
  "ht-agent-set-session-name",
  "ht-agent-get-state",
  "ht-agent-get-session-stats",
  "ht-agent-get-last-assistant-text",
  "ht-agent-export-html",
  "ht-agent-get-fork-messages",
  "ht-agent-get-session-tree",
];

beforeEach(() => {
  view = makeView();
  deps = makeDeps();
  cb = makeCallbacks();
  dispatched.length = 0;
  for (const evt of DISPATCHED_EVENTS) {
    window.addEventListener(evt, dispatchListener);
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  for (const evt of DISPATCHED_EVENTS) {
    window.removeEventListener(evt, dispatchListener);
  }
});

// ------------------------------------------------------------------
// BUILTIN_COMMANDS shape
// ------------------------------------------------------------------

describe("BUILTIN_COMMANDS", () => {
  test("every entry has a slash-prefixed name, description, and builtin source", () => {
    expect(BUILTIN_COMMANDS.length).toBeGreaterThan(5);
    for (const cmd of BUILTIN_COMMANDS) {
      expect(cmd.name.startsWith("/")).toBe(true);
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(cmd.source).toBe("builtin");
    }
  });

  test("names are unique", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ------------------------------------------------------------------
// getFilteredCommands
// ------------------------------------------------------------------

describe("getFilteredCommands", () => {
  function stateWith(commands: SlashCommand[], filter = ""): AgentPanelState {
    return { ...view._state, commands, slashFilter: filter };
  }

  test("empty filter returns the full list", () => {
    const result = getFilteredCommands(stateWith(BUILTIN_COMMANDS, ""));
    expect(result).toEqual(BUILTIN_COMMANDS);
  });

  test("matches against command name (substring)", () => {
    const result = getFilteredCommands(stateWith(BUILTIN_COMMANDS, "sess"));
    const names = result.map((c) => c.name);
    expect(names).toContain("/session");
    expect(names).not.toContain("/clear");
  });

  test("matches against description too — /copy is found by 'assistant'", () => {
    const result = getFilteredCommands(
      stateWith(BUILTIN_COMMANDS, "assistant"),
    );
    expect(result.map((c) => c.name)).toContain("/copy");
  });

  test("returns empty list when nothing matches", () => {
    const result = getFilteredCommands(
      stateWith(BUILTIN_COMMANDS, "zzzzzzzzz"),
    );
    expect(result).toEqual([]);
  });

  test("filter is case-insensitive via the slashFilter pre-lowercasing", () => {
    // slashFilter is already pre-lowercased by handleSlashInput; the
    // filter inside getFilteredCommands compares with toLowerCase on
    // each command name/description. Caller-provided uppercase filter
    // would miss — that's by contract (documented: state.slashFilter
    // is always lowercase).
    const result = getFilteredCommands(stateWith(BUILTIN_COMMANDS, "session"));
    expect(result.map((c) => c.name)).toContain("/session");
  });
});

// ------------------------------------------------------------------
// handleSlashInput + show/hide menu
// ------------------------------------------------------------------

describe("handleSlashInput", () => {
  test("opens the menu and stores filter when input starts with /", () => {
    view._elements.inputEl.value = "/se";
    handleSlashInput(view);
    expect(view._state.showSlashMenu).toBe(true);
    expect(view._state.slashFilter).toBe("se");
    expect(view._state.slashSelectedIndex).toBe(0);
    expect(
      view._elements.slashMenuEl.classList.contains("agent-slash-menu-hidden"),
    ).toBe(false);
  });

  test("resets slashSelectedIndex to 0 on every keystroke", () => {
    view._elements.inputEl.value = "/s";
    view._state.slashSelectedIndex = 5;
    handleSlashInput(view);
    expect(view._state.slashSelectedIndex).toBe(0);
  });

  test("hides the menu for non-slash input", () => {
    view._state.showSlashMenu = true;
    view._elements.inputEl.value = "regular message";
    handleSlashInput(view);
    expect(view._state.showSlashMenu).toBe(false);
    expect(
      view._elements.slashMenuEl.classList.contains("agent-slash-menu-hidden"),
    ).toBe(true);
  });

  test("hides the menu for multi-line slash input (pasted blocks)", () => {
    view._elements.inputEl.value = "/cmd\nline2";
    handleSlashInput(view);
    expect(view._state.showSlashMenu).toBe(false);
  });
});

describe("hideSlashMenu", () => {
  test("flips the state flag and adds the hidden class", () => {
    view._state.showSlashMenu = true;
    view._elements.slashMenuEl.classList.remove("agent-slash-menu-hidden");
    hideSlashMenu(view);
    expect(view._state.showSlashMenu).toBe(false);
    expect(
      view._elements.slashMenuEl.classList.contains("agent-slash-menu-hidden"),
    ).toBe(true);
  });
});

// ------------------------------------------------------------------
// renderSlashMenu
// ------------------------------------------------------------------

describe("renderSlashMenu", () => {
  test("renders one button per matching command + a header", () => {
    view._state.commands = BUILTIN_COMMANDS;
    view._state.slashFilter = "";
    renderSlashMenu(view);
    const items =
      view._elements.slashMenuEl.querySelectorAll(".agent-slash-item");
    expect(items.length).toBe(BUILTIN_COMMANDS.length);
    const header = view._elements.slashMenuEl.querySelector(".agent-slash-hdr");
    expect(header?.textContent).toBe("Commands");
  });

  test("hides the menu when no commands match the filter", () => {
    view._state.commands = BUILTIN_COMMANDS;
    view._state.slashFilter = "impossiblestring";
    renderSlashMenu(view);
    expect(
      view._elements.slashMenuEl.classList.contains("agent-slash-menu-hidden"),
    ).toBe(true);
  });

  test("non-builtin commands get a source badge", () => {
    view._state.commands = [
      { name: "/foo", description: "pi skill", source: "skill" },
      { name: "/new", description: "Start a new session", source: "builtin" },
    ];
    view._state.slashFilter = "";
    renderSlashMenu(view);
    const badges =
      view._elements.slashMenuEl.querySelectorAll(".agent-slash-badge");
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("skill");
  });

  test("the selected index gets the sel class", () => {
    view._state.commands = BUILTIN_COMMANDS;
    view._state.slashFilter = "";
    view._state.slashSelectedIndex = 2;
    renderSlashMenu(view);
    const items =
      view._elements.slashMenuEl.querySelectorAll(".agent-slash-item");
    expect(items[2].classList.contains("agent-slash-item-sel")).toBe(true);
    expect(items[0].classList.contains("agent-slash-item-sel")).toBe(false);
  });

  test("clicking an item autocompletes that command into the input + hides menu", () => {
    view._state.commands = [
      { name: "/new", description: "x", source: "builtin" },
    ];
    view._state.slashFilter = "";
    renderSlashMenu(view);
    const item =
      view._elements.slashMenuEl.querySelector<HTMLButtonElement>(
        ".agent-slash-item",
      )!;
    item.click();
    expect(view._elements.inputEl.value).toBe("/new ");
    expect(view._state.showSlashMenu).toBe(false);
  });
});

// ------------------------------------------------------------------
// executeSlashCommand routing
// ------------------------------------------------------------------

describe("executeSlashCommand", () => {
  function run(input: string): void {
    view._elements.inputEl.value = input;
    executeSlashCommand(view, cb, deps);
  }

  test("clears the input and hides the slash menu before routing", () => {
    view._elements.inputEl.value = "/new";
    view._state.showSlashMenu = true;
    executeSlashCommand(view, cb, deps);
    expect(view._elements.inputEl.value).toBe("");
    expect(view._state.showSlashMenu).toBe(false);
  });

  test("/new invokes the onNewSession callback", () => {
    run("/new");
    expect(cb.onNewSession).toHaveBeenCalledWith("agent-1");
  });

  test("/resume without args dispatches ht-agent-list-sessions", () => {
    run("/resume");
    expect(
      dispatched.find((d) => d.type === "ht-agent-list-sessions"),
    ).toBeDefined();
  });

  test("/resume with args opens the switch-session dialog pre-filled", () => {
    run("/resume /tmp/x.jsonl");
    expect(view._state.activeDialog?.method).toBe("switch_session");
    expect(view._state.activeDialog?.inputValue).toBe("/tmp/x.jsonl");
  });

  test("/model without args opens the model selector and asks for models", () => {
    run("/model");
    expect(view._state.showModelSelector).toBe(true);
    expect(deps.renderDropdowns).toHaveBeenCalled();
    expect(cb.onGetModels).toHaveBeenCalledWith("agent-1");
  });

  test("/model with a fuzzy-matching arg dispatches ht-agent-set-model", () => {
    view._state.availableModels = [
      { provider: "anthropic", id: "opus-4", name: "Opus 4" },
      { provider: "openai", id: "gpt-5", name: "GPT-5" },
    ];
    run("/model opus");
    const sent = dispatched.find((d) => d.type === "ht-agent-set-model");
    expect(sent).toBeDefined();
    expect(sent!.detail).toMatchObject({
      agentId: "agent-1",
      provider: "anthropic",
      modelId: "opus-4",
    });
    expect(deps.addSystemMessage).toHaveBeenCalledWith("Switching to Opus 4");
  });

  test("/model with a non-matching arg falls back to opening the picker", () => {
    view._state.availableModels = [
      { provider: "anthropic", id: "opus-4", name: "Opus 4" },
    ];
    run("/model nonsense");
    expect(
      dispatched.find((d) => d.type === "ht-agent-set-model"),
    ).toBeUndefined();
    expect(view._state.showModelSelector).toBe(true);
    expect(cb.onGetModels).toHaveBeenCalled();
  });

  test("/compact invokes onCompact and logs a system message", () => {
    run("/compact");
    expect(cb.onCompact).toHaveBeenCalledWith("agent-1");
    expect(deps.addSystemMessage).toHaveBeenCalledWith(
      "Compacting context\u2026",
    );
  });

  test("/name <value> renames the session and logs", () => {
    run("/name My Session");
    const sent = dispatched.find((d) => d.type === "ht-agent-set-session-name");
    expect(sent!.detail).toMatchObject({
      agentId: "agent-1",
      name: "My Session",
    });
    expect(deps.addSystemMessage).toHaveBeenCalledWith(
      'Session renamed to "My Session"',
    );
  });

  test("/name with no args writes a usage hint instead", () => {
    run("/name");
    expect(
      dispatched.find((d) => d.type === "ht-agent-set-session-name"),
    ).toBeUndefined();
    expect(deps.addSystemMessage).toHaveBeenCalledWith(
      "Usage: /name <session name>",
    );
  });

  test("/session dispatches get-state + get-session-stats and opens stats panel", () => {
    view._elements.statsEl.classList.add("agent-stats-hidden");
    run("/session");
    expect(
      dispatched.find((d) => d.type === "ht-agent-get-state"),
    ).toBeDefined();
    expect(
      dispatched.find((d) => d.type === "ht-agent-get-session-stats"),
    ).toBeDefined();
    // showSessionStats toggles the hidden class off.
    expect(
      view._elements.statsEl.classList.contains("agent-stats-hidden"),
    ).toBe(false);
  });

  test("/copy dispatches get-last-assistant-text", () => {
    run("/copy");
    expect(
      dispatched.find((d) => d.type === "ht-agent-get-last-assistant-text"),
    ).toBeDefined();
  });

  test("/export carries outputPath arg when present", () => {
    run("/export /tmp/out.html");
    const sent = dispatched.find((d) => d.type === "ht-agent-export-html");
    expect(sent!.detail).toMatchObject({
      agentId: "agent-1",
      outputPath: "/tmp/out.html",
    });
  });

  test("/export with no args passes outputPath=undefined", () => {
    run("/export");
    const sent = dispatched.find((d) => d.type === "ht-agent-export-html");
    expect(
      (sent!.detail as { outputPath?: string }).outputPath,
    ).toBeUndefined();
  });

  test("/fork fetches fork messages", () => {
    run("/fork");
    expect(
      dispatched.find((d) => d.type === "ht-agent-get-fork-messages"),
    ).toBeDefined();
    expect(deps.addSystemMessage).toHaveBeenCalledWith(
      "Fetching fork points\u2026",
    );
  });

  test("/tree forwards the current sessionFile so pi loads the right tree", () => {
    view._state.sessionFile = "/tmp/live.jsonl";
    run("/tree");
    const sent = dispatched.find((d) => d.type === "ht-agent-get-session-tree");
    expect(sent!.detail).toMatchObject({
      agentId: "agent-1",
      sessionPath: "/tmp/live.jsonl",
    });
  });

  test("/settings opens the settings modal", () => {
    run("/settings");
    expect(view._state.activeDialog?.method).toBe("settings");
  });

  test("/hotkeys writes the hotkey list as a system message (no modal)", () => {
    run("/hotkeys");
    expect(deps.addSystemMessage).toHaveBeenCalled();
    expect(view._state.activeDialog).toBeNull();
  });

  test("/clear wipes the messages list + triggers a full re-render", () => {
    view._state.messages = [
      { role: "user", content: "hi", timestamp: 0 },
      { role: "assistant", content: "bye", timestamp: 0 },
    ];
    run("/clear");
    expect(view._state.messages.length).toBe(0);
    expect(deps.renderAllMessages).toHaveBeenCalled();
  });

  test("/help uses the current commands list (not the static builtin list)", () => {
    view._state.commands = [
      { name: "/custom", description: "my skill", source: "skill" },
    ];
    run("/help");
    const text = (deps.addSystemMessage as ReturnType<typeof mock>).mock
      .calls[0]?.[0] as string;
    expect(text).toContain("/custom");
    expect(text).toContain("my skill");
  });

  test("unknown slash command falls through to onSendPrompt with the raw text", () => {
    run("/unknown some args here");
    expect(cb.onSendPrompt).toHaveBeenCalledWith(
      "agent-1",
      "/unknown some args here",
    );
  });

  test("command matching is case-insensitive (/NEW is the same as /new)", () => {
    run("/NEW");
    expect(cb.onNewSession).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// executeBuiltinCommand
// ------------------------------------------------------------------

describe("executeBuiltinCommand", () => {
  test("seeds the input with the given command and dispatches it", () => {
    executeBuiltinCommand(view, cb, deps, "/help");
    // Input is cleared again by the dispatcher after running.
    expect(view._elements.inputEl.value).toBe("");
    expect(deps.addSystemMessage).toHaveBeenCalled();
  });
});
