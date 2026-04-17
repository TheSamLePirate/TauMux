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
  handleAgentResponse,
  RESPONSE_HANDLERS,
  type ResponseDeps,
} from "../src/views/terminal/agent-panel-response";
import type {
  AgentPaneView,
  AgentPanelState,
  SlashCommand,
} from "../src/views/terminal/agent-panel";

// ------------------------------------------------------------------
// Test view + deps factory
// ------------------------------------------------------------------

/** Build a minimal AgentPaneView for handler tests. Only the fields
 *  touched by response handlers are wired; the rest are stubbed as
 *  empty DOM nodes so TypeScript is happy but nothing observable
 *  depends on them. Each test gets a fresh view to avoid leaking
 *  state between cases. */
function makeView(agentId = "agent-1"): AgentPaneView {
  const mk = <T extends keyof HTMLElementTagNameMap>(
    tag: T,
  ): HTMLElementTagNameMap[T] => document.createElement(tag);

  const toolbarEl = mk("div");
  toolbarEl.innerHTML = `<div class="agent-tb-thinking"><span class="agent-tb-dot"></span></div>`;

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

  const view: AgentPaneView = {
    agentId,
    surfaceId: agentId,
    container: mk("div"),
    titleEl: mk("span"),
    chipsEl: mk("div"),
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
      toolbarEl,
      streamingIndicator: mk("div"),
      contextMeter: mk("div"),
      contextMeterFill: mk("div"),
      contextMeterLabel: mk("span"),
      slashMenuEl: mk("div"),
      dialogOverlay: mk("div"),
      sessionNameEl: mk("span"),
      statsEl: mk("div"),
      widgetsAboveEl: mk("div"),
      widgetsBelowEl: mk("div"),
      attachmentTrayEl: mk("div"),
      modelMetaEl: mk("div"),
    },
  };
  return view;
}

function makeDeps(): ResponseDeps {
  return {
    addSystemMessage: mock(() => {}),
    syncStreamingUI: mock(() => {}),
    syncFooter: mock(() => {}),
    renderModelMeta: mock(() => {}),
    renderDropdowns: mock(() => {}),
    renderStats: mock(() => {}),
    renderAllMessages: mock(() => {}),
    renderWidgets: mock(() => {}),
    showSessionBrowserDialog: mock(() => {}),
    showTreeDialog: mock(() => {}),
    showForkDialog: mock(() => {}),
    convertAgentMessageToChatMessages: mock((m: Record<string, unknown>) => [
      {
        role: (m["role"] as "user" | "assistant") ?? "user",
        content: "",
        timestamp: 0,
      },
    ]),
    builtinCommands: [
      { name: "/help", description: "help", source: "builtin" },
      { name: "/new", description: "new", source: "builtin" },
    ] as SlashCommand[],
  };
}

let view: AgentPaneView;
let deps: ResponseDeps;

beforeEach(() => {
  view = makeView();
  deps = makeDeps();
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ------------------------------------------------------------------
// handleAgentResponse top-level routing
// ------------------------------------------------------------------

describe("handleAgentResponse", () => {
  test("dispatches to RESPONSE_HANDLERS by command name", () => {
    handleAgentResponse(
      view,
      { command: "bash", success: true, data: { output: "hi", exitCode: 0 } },
      deps,
    );
    expect(view._state.messages.length).toBe(1);
    expect(view._state.messages[0].role).toBe("bash");
  });

  test("failure events surface as a system-message error", () => {
    handleAgentResponse(
      view,
      { command: "anything", success: false, error: "boom" },
      deps,
    );
    expect(deps.addSystemMessage).toHaveBeenCalledTimes(1);
    expect(deps.addSystemMessage).toHaveBeenCalledWith("boom");
  });

  test("failure without error text falls back to 'Command failed: <cmd>'", () => {
    handleAgentResponse(view, { command: "foo", success: false }, deps);
    expect(deps.addSystemMessage).toHaveBeenCalledWith("Command failed: foo");
  });

  test("unknown command is silently ignored — no system message, no throw", () => {
    expect(() =>
      handleAgentResponse(
        view,
        { command: "nope", success: true, data: {} },
        deps,
      ),
    ).not.toThrow();
    expect(deps.addSystemMessage).not.toHaveBeenCalled();
  });

  test("every registered handler key is a function", () => {
    for (const [cmd, fn] of Object.entries(RESPONSE_HANDLERS)) {
      expect(typeof fn).toBe("function");
      expect(cmd.length).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------------
// Individual handlers
// ------------------------------------------------------------------

describe("get_state", () => {
  test("populates model, thinking level, session metadata", () => {
    handleAgentResponse(
      view,
      {
        command: "get_state",
        success: true,
        data: {
          model: { provider: "anthropic", id: "opus-4", name: "Opus 4" },
          thinkingLevel: "high",
          sessionName: "My Session",
          sessionFile: "/tmp/s.jsonl",
          sessionId: "sess-1",
          messageCount: 7,
          isStreaming: true,
        },
      },
      deps,
    );
    expect(view._state.model?.name).toBe("Opus 4");
    expect(view._state.thinkingLevel).toBe("high");
    expect(view._state.sessionName).toBe("My Session");
    expect(view._state.sessionFile).toBe("/tmp/s.jsonl");
    expect(view._state.sessionId).toBe("sess-1");
    expect(view._state.messageCount).toBe(7);
    expect(view._state.isStreaming).toBe(true);
    expect(view._elements.sessionNameEl.textContent).toBe("My Session");
    expect(view._elements.modelBtnLabel.textContent).toBe("Opus 4");
    expect(view._elements.thinkingBtnLabel.textContent).toBe("high");
    // Render pipeline fired.
    expect(deps.syncStreamingUI).toHaveBeenCalledTimes(1);
    expect(deps.syncFooter).toHaveBeenCalledTimes(1);
    expect(deps.renderModelMeta).toHaveBeenCalledTimes(1);
  });

  test("ignores absent data field", () => {
    handleAgentResponse(view, { command: "get_state", success: true }, deps);
    expect(view._state.model).toBeNull();
    expect(deps.syncFooter).not.toHaveBeenCalled();
  });
});

describe("get_available_models", () => {
  test("stores models and auto-populates scoped set on first load", () => {
    handleAgentResponse(
      view,
      {
        command: "get_available_models",
        success: true,
        data: {
          models: [
            { provider: "a", id: "1" },
            { provider: "b", id: "2" },
          ],
        },
      },
      deps,
    );
    expect(view._state.availableModels?.length).toBe(2);
    // Both models added to scoped set.
    expect(view._state.scopedModelIds.size).toBe(2);
    expect(view._state.scopedModelIds.has("a/1")).toBe(true);
  });

  test("does not re-seed scoped set when user has customised it", () => {
    view._state.scopedModelIds.add("a/1");
    handleAgentResponse(
      view,
      {
        command: "get_available_models",
        success: true,
        data: {
          models: [
            { provider: "a", id: "1" },
            { provider: "b", id: "2" },
          ],
        },
      },
      deps,
    );
    // Only the user-picked model remains scoped.
    expect(view._state.scopedModelIds.size).toBe(1);
    expect(view._state.scopedModelIds.has("a/1")).toBe(true);
  });
});

describe("set_model + cycle_model", () => {
  test("set_model updates label + logs system message", () => {
    handleAgentResponse(
      view,
      {
        command: "set_model",
        success: true,
        data: { provider: "a", id: "x", name: "X" },
      },
      deps,
    );
    expect(view._state.model?.name).toBe("X");
    expect(view._elements.modelBtnLabel.textContent).toBe("X");
    expect(deps.addSystemMessage).toHaveBeenCalledWith("Model: X");
  });

  test("cycle_model updates both model and thinking level when provided", () => {
    handleAgentResponse(
      view,
      {
        command: "cycle_model",
        success: true,
        data: {
          model: { provider: "p", id: "q", name: "Q" },
          thinkingLevel: "medium",
        },
      },
      deps,
    );
    expect(view._state.model?.name).toBe("Q");
    expect(view._state.thinkingLevel).toBe("medium");
    expect(view._elements.thinkingBtnLabel.textContent).toBe("medium");
  });
});

describe("cycle_thinking_level", () => {
  test("updates level + label + logs system message", () => {
    handleAgentResponse(
      view,
      {
        command: "cycle_thinking_level",
        success: true,
        data: { level: "xhigh" },
      },
      deps,
    );
    expect(view._state.thinkingLevel).toBe("xhigh");
    expect(view._elements.thinkingBtnLabel.textContent).toBe("xhigh");
    expect(deps.addSystemMessage).toHaveBeenCalledWith("Thinking: xhigh");
  });
});

describe("set_auto_compaction / set_auto_retry toggles", () => {
  test("flips based on explicit enabled=true", () => {
    view._state.autoCompactionEnabled = false;
    handleAgentResponse(
      view,
      {
        command: "set_auto_compaction",
        success: true,
        data: { enabled: true },
      },
      deps,
    );
    expect(view._state.autoCompactionEnabled).toBe(true);
    expect(deps.addSystemMessage).toHaveBeenCalledWith(
      "Auto compaction enabled",
    );
  });

  test("toggles when data omits enabled", () => {
    view._state.autoRetryEnabled = true;
    handleAgentResponse(
      view,
      { command: "set_auto_retry", success: true, data: {} },
      deps,
    );
    expect(view._state.autoRetryEnabled).toBe(false);
    expect(deps.addSystemMessage).toHaveBeenCalledWith("Auto retry disabled");
  });
});

describe("abort_retry", () => {
  test("clears retryState", () => {
    view._state.retryState = { attempt: 1, maxAttempts: 3, delayMs: 1000 };
    handleAgentResponse(view, { command: "abort_retry", success: true }, deps);
    expect(view._state.retryState).toBeNull();
    expect(deps.addSystemMessage).toHaveBeenCalledWith("Retry aborted");
  });
});

describe("get_session_stats", () => {
  test("stores stats and syncs footer + stats render", () => {
    handleAgentResponse(
      view,
      {
        command: "get_session_stats",
        success: true,
        data: {
          tokens: { input: 100, output: 50, total: 150 },
          totalMessages: 4,
          sessionFile: "/x",
          sessionId: "abc",
        },
      },
      deps,
    );
    expect(view._state.sessionStats?.tokens?.total).toBe(150);
    expect(view._state.messageCount).toBe(4);
    expect(view._state.sessionFile).toBe("/x");
    expect(view._state.sessionId).toBe("abc");
    expect(deps.renderStats).toHaveBeenCalledTimes(1);
  });
});

describe("get_messages", () => {
  test("converts and counts by role", () => {
    (
      deps.convertAgentMessageToChatMessages as ReturnType<typeof mock>
    ).mockImplementation((m: Record<string, unknown>) => [
      {
        role: m["role"] as "user" | "assistant",
        content: "",
        timestamp: 0,
      },
    ]);
    handleAgentResponse(
      view,
      {
        command: "get_messages",
        success: true,
        data: {
          messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }],
        },
      },
      deps,
    );
    expect(view._state.messages.length).toBe(3);
    expect(view._state.turnCount).toBe(1); // one assistant
    expect(deps.renderAllMessages).toHaveBeenCalledTimes(1);
  });
});

describe("new_session", () => {
  test("wipes messages, tool calls, session metadata, widgets", () => {
    view._state.messages = [{ role: "user", content: "hi", timestamp: 0 }];
    view._state.toolCalls.set("t1", {
      id: "t1",
      name: "x",
      args: "",
      isRunning: false,
      collapsed: false,
      startTime: 0,
    });
    view._state.widgetsAbove.set("w", ["line"]);
    view._state.sessionName = "old";
    view._elements.sessionNameEl.textContent = "old";

    handleAgentResponse(view, { command: "new_session", success: true }, deps);

    expect(view._state.messages.length).toBe(0);
    expect(view._state.toolCalls.size).toBe(0);
    expect(view._state.widgetsAbove.size).toBe(0);
    expect(view._state.sessionName).toBeNull();
    expect(view._elements.sessionNameEl.textContent).toBe("");
    expect(deps.addSystemMessage).toHaveBeenCalledWith("New session started");
  });
});

describe("get_commands", () => {
  test("merges built-ins with pi commands, de-duped by name", () => {
    handleAgentResponse(
      view,
      {
        command: "get_commands",
        success: true,
        data: {
          commands: [
            { name: "custom", description: "a" },
            { name: "new", description: "overridden" }, // name collides with built-in /new — should be dropped
          ],
        },
      },
      deps,
    );
    const names = view._state.commands.map((c) => c.name);
    expect(names).toContain("/help");
    expect(names).toContain("/new");
    expect(names).toContain("/custom");
    // The pi "new" must not have overridden the built-in.
    const newCmd = view._state.commands.find((c) => c.name === "/new");
    expect(newCmd?.source).toBe("builtin");
    expect(newCmd?.description).toBe("new"); // from builtin, not "overridden"
  });

  test("accepts data shaped as an array directly (legacy protocol form)", () => {
    handleAgentResponse(
      view,
      {
        command: "get_commands",
        success: true,
        data: [{ name: "direct", description: "d" }] as unknown as Record<
          string,
          unknown
        >,
      },
      deps,
    );
    const names = view._state.commands.map((c) => c.name);
    expect(names).toContain("/direct");
  });
});

describe("dialogs triggered by responses", () => {
  test("list_sessions populates sessionList and opens the browser", () => {
    handleAgentResponse(
      view,
      {
        command: "list_sessions",
        success: true,
        data: {
          sessions: [{ path: "/a.jsonl", updatedAt: 1 }],
        },
      },
      deps,
    );
    expect(view._state.sessionList.length).toBe(1);
    expect(deps.showSessionBrowserDialog).toHaveBeenCalledTimes(1);
  });

  test("get_session_tree populates tree and opens tree dialog", () => {
    handleAgentResponse(
      view,
      {
        command: "get_session_tree",
        success: true,
        data: {
          tree: [
            {
              id: "n1",
              parentId: null,
              depth: 0,
              role: "user",
              entryType: "message",
              text: "hi",
              childCount: 0,
              active: true,
            },
          ],
        },
      },
      deps,
    );
    expect(view._state.sessionTree.length).toBe(1);
    expect(deps.showTreeDialog).toHaveBeenCalledTimes(1);
  });

  test("get_fork_messages opens fork dialog when there are entries", () => {
    handleAgentResponse(
      view,
      {
        command: "get_fork_messages",
        success: true,
        data: {
          messages: [{ entryId: "e1", text: "first" }],
        },
      },
      deps,
    );
    expect(deps.showForkDialog).toHaveBeenCalledTimes(1);
  });

  test("get_fork_messages writes a 'no fork points' system message when empty", () => {
    handleAgentResponse(
      view,
      {
        command: "get_fork_messages",
        success: true,
        data: { messages: [] },
      },
      deps,
    );
    expect(deps.showForkDialog).not.toHaveBeenCalled();
    expect(deps.addSystemMessage).toHaveBeenCalledWith(
      "No fork points available",
    );
  });
});

describe("fork + switch_session", () => {
  test("fork with cancelled=true logs the cancel message", () => {
    handleAgentResponse(
      view,
      { command: "fork", success: true, data: { cancelled: true } },
      deps,
    );
    expect(deps.addSystemMessage).toHaveBeenCalledWith("Fork cancelled");
  });

  test("fork with text writes a 'forked from' message", () => {
    handleAgentResponse(
      view,
      { command: "fork", success: true, data: { text: "earlier question" } },
      deps,
    );
    const call = (deps.addSystemMessage as ReturnType<typeof mock>).mock
      .calls[0]?.[0];
    expect(call).toContain("Forked session from: earlier question");
  });

  test("switch_session cancelled=false logs the switched message", () => {
    handleAgentResponse(
      view,
      { command: "switch_session", success: true, data: {} },
      deps,
    );
    expect(deps.addSystemMessage).toHaveBeenCalledWith("Session switched");
  });
});

describe("set_session_name + bash", () => {
  test("set_session_name updates state + element", () => {
    handleAgentResponse(
      view,
      {
        command: "set_session_name",
        success: true,
        data: { name: "New Name" },
      },
      deps,
    );
    expect(view._state.sessionName).toBe("New Name");
    expect(view._elements.sessionNameEl.textContent).toBe("New Name");
  });

  test("bash pushes a bash message and re-renders", () => {
    handleAgentResponse(
      view,
      {
        command: "bash",
        success: true,
        data: {
          output: "stdout text",
          exitCode: 0,
          command: "ls",
          truncated: false,
          fullOutputPath: null,
        },
      },
      deps,
    );
    const msg = view._state.messages[0];
    expect(msg.role).toBe("bash");
    expect(msg.content).toBe("stdout text");
    expect(msg.command).toBe("ls");
    expect(msg.exitCode).toBe(0);
    expect(deps.renderAllMessages).toHaveBeenCalledTimes(1);
  });
});
