// Phase 3 Step 6 — Agent panel main module DOM tests.
//
// The agent-panel sub-modules (events, dialogs, messages, model,
// response, slash) are already covered by individual test files
// landed in Phase 0. This file covers the composing module's surface:
// view construction, user message append, focus, and the agentPanel-
// HandleEvent dispatch on a handful of representative event types.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = "";
});

async function load() {
  return await import("../src/views/terminal/agent-panel");
}

interface Spies {
  prompts: { agentId: string; message: string }[];
  aborts: string[];
  closes: string[];
  focuses: string[];
  splits: { surfaceId: string; direction: "horizontal" | "vertical" }[];
  modelGets: string[];
  stateGets: string[];
  modelSets: { agentId: string; provider: string; modelId: string }[];
  thinkings: { agentId: string; level: string }[];
  newSessions: string[];
  compacts: string[];
}

function spies(): Spies {
  return {
    prompts: [],
    aborts: [],
    closes: [],
    focuses: [],
    splits: [],
    modelGets: [],
    stateGets: [],
    modelSets: [],
    thinkings: [],
    newSessions: [],
    compacts: [],
  };
}

function callbacks(s: Spies) {
  return {
    onSendPrompt: (agentId: string, message: string) => {
      s.prompts.push({ agentId, message });
    },
    onAbort: (agentId: string) => {
      s.aborts.push(agentId);
    },
    onSetModel: (agentId: string, provider: string, modelId: string) => {
      s.modelSets.push({ agentId, provider, modelId });
    },
    onSetThinking: (agentId: string, level: string) => {
      s.thinkings.push({ agentId, level });
    },
    onNewSession: (agentId: string) => {
      s.newSessions.push(agentId);
    },
    onCompact: (agentId: string) => {
      s.compacts.push(agentId);
    },
    onClose: (surfaceId: string) => {
      s.closes.push(surfaceId);
    },
    onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => {
      s.splits.push({ surfaceId, direction });
    },
    onFocus: (surfaceId: string) => {
      s.focuses.push(surfaceId);
    },
    onGetModels: (agentId: string) => {
      s.modelGets.push(agentId);
    },
    onGetState: (agentId: string) => {
      s.stateGets.push(agentId);
    },
  };
}

describe("Agent pane — construction", () => {
  test("mounts a hidden surface container with the right data attributes", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    expect(view.agentId).toBe("agent-id-xyz");
    expect(view.surfaceId).toBe("agent:1");
    expect(view.container.dataset["surfaceId"]).toBe("agent:1");
    expect(view.container.style.display).toBe("none");
    expect(view.container.classList.contains("agent-surface")).toBe(true);
  });

  test("status bar exposes the title chip + title element", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    expect(view.titleEl).toBeDefined();
    expect(view.chipsEl.classList.contains("surface-bar-chips")).toBe(true);
  });

  test("state initialises with empty messages, no streaming, no model", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    expect(view._state.messages).toEqual([]);
    expect(view._state.isStreaming).toBe(false);
    expect(view._state.isCompacting).toBe(false);
    expect(view._state.model).toBeNull();
    expect(view._state.availableModels).toBeNull();
  });

  test("agentPanelFocusInput() calls focus() on the input element", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    expect(view._elements.inputEl).toBeDefined();
    let focused = 0;
    const real = view._elements.inputEl.focus.bind(view._elements.inputEl);
    view._elements.inputEl.focus = (...args: unknown[]) => {
      focused++;
      try {
        real(...(args as Parameters<typeof real>));
      } catch {
        /* happy-dom may throw on focusing some elements; the spy
         * counts the call which is what we actually want to verify. */
      }
    };
    a.agentPanelFocusInput(view);
    expect(focused).toBe(1);
  });
});

describe("Agent pane — agentPanelAddUserMessage", () => {
  test("appends a user-role message with text content", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    a.agentPanelAddUserMessage(view, "hello world");
    expect(view._state.messages.length).toBe(1);
    expect(view._state.messages[0].role).toBe("user");
    expect(view._state.messages[0].content).toBe("hello world");
  });

  test("preserves images when provided", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    a.agentPanelAddUserMessage(view, "look at this", [
      { dataUrl: "data:image/png;base64,xxxx", name: "x.png" },
    ]);
    expect(view._state.messages[0].images?.length).toBe(1);
    expect(view._state.messages[0].images?.[0].name).toBe("x.png");
  });

  test("appending two messages results in two messages", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    a.agentPanelAddUserMessage(view, "one");
    a.agentPanelAddUserMessage(view, "two");
    expect(view._state.messages.length).toBe(2);
    expect(view._state.messages[1].content).toBe("two");
  });
});

describe("Agent pane — agentPanelHandleEvent", () => {
  test("agent_start marks streaming on and clears stale currentText", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    view._state.currentText = "stale";
    a.agentPanelHandleEvent(view, { type: "agent_start" });
    expect(view._state.isStreaming).toBe(true);
    expect(view._state.currentText).toBe("");
  });

  test("text_delta inside message_update appends to currentText", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    a.agentPanelHandleEvent(view, { type: "agent_start" });
    a.agentPanelHandleEvent(view, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello " },
    });
    a.agentPanelHandleEvent(view, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "world" },
    });
    expect(view._state.currentText).toBe("hello world");
  });

  test("agent_end clears the streaming flag", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    a.agentPanelHandleEvent(view, { type: "agent_start" });
    expect(view._state.isStreaming).toBe(true);
    a.agentPanelHandleEvent(view, { type: "agent_end" });
    expect(view._state.isStreaming).toBe(false);
  });

  test("unknown event types are silently ignored (no throw)", async () => {
    const a = await load();
    const view = a.createAgentPaneView(
      "agent:1",
      "agent-id-xyz",
      callbacks(spies()),
    );
    expect(() => {
      a.agentPanelHandleEvent(view, { type: "not-a-real-event-type" });
    }).not.toThrow();
  });
});
