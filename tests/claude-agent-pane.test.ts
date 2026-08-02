/**
 * Pane v2 — pure event digestion + DOM behaviour (happy-dom).
 */
import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import {
  digestClaudeEvent,
  toolSummary,
  extractToolOutput,
  createClaudePaneView,
  claudePaneApplyEvent,
  claudePaneApplyExit,
  claudePaneApplyHistory,
  claudePaneApplySessions,
  claudePaneReset,
  destroyClaudePaneView,
  type ClaudePaneCallbacks,
  type ClaudePaneView,
} from "../src/views/terminal/claude-agent-pane";

const delta = (text: string) => ({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: { type: "text_delta", text },
  },
});

describe("digestClaudeEvent (pure)", () => {
  test("system init → meta incl. cwd", () => {
    expect(
      digestClaudeEvent({
        type: "system",
        subtype: "init",
        model: "claude-opus-5",
        session_id: "s1",
        permissionMode: "plan",
        cwd: "/repo",
      }),
    ).toEqual([
      {
        kind: "meta",
        model: "claude-opus-5",
        sessionId: "s1",
        mode: "plan",
        cwd: "/repo",
      },
    ]);
  });

  test("user text; tool_result maps to its tool_use_id", () => {
    expect(
      digestClaudeEvent({
        type: "user",
        message: { content: [{ type: "text", text: "hi" }] },
      }),
    ).toEqual([{ kind: "user-text", text: "hi" }]);
    expect(
      digestClaudeEvent({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu1",
              content: [{ type: "text", text: "42 files" }],
              is_error: false,
            },
          ],
        },
      }),
    ).toEqual([
      { kind: "tool-result", id: "tu1", output: "42 files", isError: false },
    ]);
  });

  test("assistant message with text + thinking + tool_use emits all ops", () => {
    const ops = digestClaudeEvent({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "let me look" },
          { type: "text", text: "Running tests." },
          {
            type: "tool_use",
            id: "tu1",
            name: "Bash",
            input: { command: "bun test" },
          },
        ],
      },
    });
    expect(ops).toContainEqual({ kind: "thinking-final", text: "let me look" });
    expect(ops).toContainEqual({
      kind: "tool-start",
      id: "tu1",
      name: "Bash",
      summary: "$ bun test",
      input: JSON.stringify({ command: "bun test" }, null, 2),
    });
    expect(ops).toContainEqual({
      kind: "assistant-final",
      text: "Running tests.",
    });
  });

  test("stream deltas: text, thinking, tool_use block start", () => {
    expect(digestClaudeEvent(delta("par"))).toEqual([
      { kind: "assistant-delta", text: "par" },
    ]);
    expect(
      digestClaudeEvent({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "hmm" },
        },
      }),
    ).toEqual([{ kind: "thinking-delta", text: "hmm" }]);
    expect(
      digestClaudeEvent({
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "tool_use", id: "tu2", name: "Read" },
        },
      }),
    ).toEqual([
      { kind: "tool-start", id: "tu2", name: "Read", summary: "", input: "" },
    ]);
  });

  test("result carries cost, duration, and token totals", () => {
    expect(
      digestClaudeEvent({
        type: "result",
        subtype: "success",
        total_cost_usd: 0.12,
        duration_ms: 4200,
        usage: { input_tokens: 11_000, output_tokens: 1_400 },
      }),
    ).toEqual([
      {
        kind: "result",
        costUsd: 0.12,
        durationMs: 4200,
        tokens: 12_400,
        isError: false,
      },
    ]);
  });

  test("__tau_permission synthetic events map to perm ops", () => {
    expect(
      digestClaudeEvent({
        type: "__tau_permission",
        status: "pending",
        toolName: "Bash",
      }),
    ).toEqual([{ kind: "perm", status: "pending", toolName: "Bash" }]);
    expect(
      digestClaudeEvent({
        type: "__tau_permission",
        status: "resolved",
        toolName: "Bash",
        behavior: "deny",
      }),
    ).toEqual([
      { kind: "perm", status: "resolved", toolName: "Bash", behavior: "deny" },
    ]);
  });

  test("unknown SDK message types digest to [] — never throw", () => {
    expect(digestClaudeEvent({ type: "hook_started" })).toEqual([]);
    expect(digestClaudeEvent(null)).toEqual([]);
    expect(digestClaudeEvent("garbage")).toEqual([]);
    expect(digestClaudeEvent({ type: "task_notification" })).toEqual([]);
  });
});

describe("summaries + output extraction", () => {
  test("toolSummary shapes", () => {
    expect(toolSummary("Bash", { command: "ls -la" })).toBe("$ ls -la");
    expect(toolSummary("Edit", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(toolSummary("Task", { description: "explore repo" })).toBe(
      "explore repo",
    );
    expect(toolSummary("Grep", { pattern: "TODO" })).toBe("TODO");
    expect(toolSummary("Weird", {})).toBe("");
  });

  test("extractToolOutput handles strings and block arrays", () => {
    expect(extractToolOutput("plain")).toBe("plain");
    expect(
      extractToolOutput([
        { type: "text", text: "a" },
        { type: "image" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
    expect(extractToolOutput(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// DOM behaviour
// ---------------------------------------------------------------------------

function makeView(): {
  view: ClaudePaneView;
  calls: Array<[string, ...unknown[]]>;
} {
  const calls: Array<[string, ...unknown[]]> = [];
  const r =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const cb: ClaudePaneCallbacks = {
    onPrompt: r("prompt") as ClaudePaneCallbacks["onPrompt"],
    onInterrupt: r("interrupt") as ClaudePaneCallbacks["onInterrupt"],
    onSetMode: r("setMode") as ClaudePaneCallbacks["onSetMode"],
    onSetModel: r("setModel") as ClaudePaneCallbacks["onSetModel"],
    onListSessions: r("listSessions") as ClaudePaneCallbacks["onListSessions"],
    onResume: r("resume") as ClaudePaneCallbacks["onResume"],
    onNewSession: r("newSession") as ClaudePaneCallbacks["onNewSession"],
    onClose: r("close") as ClaudePaneCallbacks["onClose"],
    onFocus: r("focus") as ClaudePaneCallbacks["onFocus"],
    onSplit: r("split") as ClaudePaneCallbacks["onSplit"],
  };
  return { view: createClaudePaneView("claude-agent:1", cb), calls };
}

describe("ClaudePaneView (DOM)", () => {
  test("send: local echo, prompt callback, SDK replay deduped", () => {
    const { view, calls } = makeView();
    view.composerEl.value = "  do the thing  ";
    view.sendBtn.click();
    expect(calls).toContainEqual(["prompt", "claude-agent:1", "do the thing"]);
    expect(view.transcriptEl.querySelectorAll(".claude-msg-user")).toHaveLength(
      1,
    );
    // SDK replays our message — must NOT duplicate.
    claudePaneApplyEvent(view, {
      type: "user",
      message: { content: [{ type: "text", text: "do the thing" }] },
    });
    expect(view.transcriptEl.querySelectorAll(".claude-msg-user")).toHaveLength(
      1,
    );
    // A different user message (e.g. from history) renders.
    claudePaneApplyEvent(view, {
      type: "user",
      message: { content: [{ type: "text", text: "other" }] },
    });
    expect(view.transcriptEl.querySelectorAll(".claude-msg-user")).toHaveLength(
      2,
    );
    destroyClaudePaneView(view);
  });

  test("welcome disappears on first content; empty send ignored", () => {
    const { view, calls } = makeView();
    expect(
      view.transcriptEl.querySelector(".claude-pane-welcome"),
    ).not.toBeNull();
    view.sendBtn.click();
    expect(calls.filter((c) => c[0] === "prompt")).toHaveLength(0);
    claudePaneApplyEvent(view, delta("hi"));
    expect(view.transcriptEl.querySelector(".claude-pane-welcome")).toBeNull();
    destroyClaudePaneView(view);
  });

  test("streaming: deltas accumulate as markdown; final replaces; state dot cycles", () => {
    const { view } = makeView();
    claudePaneApplyEvent(view, delta("Hel"));
    expect(view.stateDotEl.className).toContain("claude-state-working");
    expect(view.interruptBtn.disabled).toBe(false);
    claudePaneApplyEvent(view, delta("lo **bold**"));
    const live = view.transcriptEl.querySelectorAll(".claude-msg-assistant");
    expect(live).toHaveLength(1);
    expect(live[0]!.innerHTML).toContain("<strong>bold</strong>");
    claudePaneApplyEvent(view, {
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello **bold** done" }] },
    });
    expect(
      view.transcriptEl.querySelectorAll(".claude-msg-assistant"),
    ).toHaveLength(1);
    expect(view.transcriptEl.textContent).toContain("Hello bold done");
    claudePaneApplyEvent(view, { type: "result", subtype: "success" });
    expect(view.stateDotEl.className).toContain("claude-state-idle");
    expect(view.interruptBtn.disabled).toBe(true);
    destroyClaudePaneView(view);
  });

  test("markdown escapes HTML (no injection through assistant text)", () => {
    const { view } = makeView();
    claudePaneApplyEvent(view, {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }],
      },
    });
    expect(view.transcriptEl.querySelector("img")).toBeNull();
    expect(view.transcriptEl.textContent).toContain("<img");
    destroyClaudePaneView(view);
  });

  test("tool lifecycle: streamed placeholder → filled card → matched output", () => {
    const { view } = makeView();
    // Placeholder from content_block_start.
    claudePaneApplyEvent(view, {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", id: "tu1", name: "Bash" },
      },
    });
    let card = view.transcriptEl.querySelector(".claude-tool")!;
    expect(card.querySelector(".claude-tool-status")!.className).toContain(
      "claude-tool-running",
    );
    // Final assistant message fills summary + input on the SAME card.
    claudePaneApplyEvent(view, {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu1",
            name: "Bash",
            input: { command: "bun test" },
          },
        ],
      },
    });
    expect(view.transcriptEl.querySelectorAll(".claude-tool")).toHaveLength(1);
    expect(card.textContent).toContain("$ bun test");
    // Result attaches output + flips status.
    claudePaneApplyEvent(view, {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu1",
            content: "324 pass",
            is_error: false,
          },
        ],
      },
    });
    card = view.transcriptEl.querySelector(".claude-tool")!;
    expect(card.querySelector(".claude-tool-status")!.className).toContain(
      "claude-tool-ok",
    );
    expect(card.querySelector(".claude-tool-output")!.textContent).toContain(
      "324 pass",
    );
    destroyClaudePaneView(view);
  });

  test("failed tool result marks the card", () => {
    const { view } = makeView();
    claudePaneApplyEvent(view, {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu1",
            name: "Bash",
            input: { command: "x" },
          },
        ],
      },
    });
    claudePaneApplyEvent(view, {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu1",
            content: "boom",
            is_error: true,
          },
        ],
      },
    });
    expect(
      view.transcriptEl.querySelector(".claude-tool")!.className,
    ).toContain("claude-tool-failed");
    destroyClaudePaneView(view);
  });

  test("thinking streams into a collapsed block and finalizes", () => {
    const { view } = makeView();
    claudePaneApplyEvent(view, {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "step one" },
      },
    });
    const think = view.transcriptEl.querySelector(".claude-think")!;
    const body = think.querySelector(".claude-think-body") as HTMLDivElement;
    expect(body.style.display).toBe("none"); // collapsed by default
    expect(body.textContent).toContain("step one");
    claudePaneApplyEvent(view, {
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "step one, two" }] },
    });
    expect(body.textContent).toBe("step one, two");
    destroyClaudePaneView(view);
  });

  test("permission flow: pending row → denied record; state dot waits", () => {
    const { view } = makeView();
    claudePaneApplyEvent(view, delta("x"));
    claudePaneApplyEvent(view, {
      type: "__tau_permission",
      status: "pending",
      toolName: "Bash",
    });
    expect(view.stateDotEl.className).toContain("claude-state-waiting");
    expect(view.transcriptEl.textContent).toContain("Waiting for approval");
    claudePaneApplyEvent(view, {
      type: "__tau_permission",
      status: "resolved",
      toolName: "Bash",
      behavior: "deny",
    });
    expect(view.transcriptEl.textContent).toContain("Denied: Bash");
    expect(view.stateDotEl.className).toContain("claude-state-working");
    destroyClaudePaneView(view);
  });

  test("meta: unknown model id is added to the switcher and selected", () => {
    const { view } = makeView();
    claudePaneApplyEvent(view, {
      type: "system",
      subtype: "init",
      model: "claude-fable-5",
      permissionMode: "acceptEdits",
      cwd: "/Users/dev/myproj",
    });
    expect(view.modelSelectEl.value).toBe("claude-fable-5");
    expect(view.modeSelectEl.value).toBe("acceptEdits");
    expect(view.cwdEl.textContent).toBe("myproj");
    destroyClaudePaneView(view);
  });

  test("result meters: cost, tokens", () => {
    const { view } = makeView();
    claudePaneApplyEvent(view, {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.05,
      usage: { input_tokens: 9_000, output_tokens: 1_000 },
    });
    expect(view.costPillEl.textContent).toBe("$0.05");
    expect(view.tokenPillEl.textContent).toContain("10");
    destroyClaudePaneView(view);
  });

  test("history replay renders divider + messages and resets first", () => {
    const { view } = makeView();
    claudePaneApplyEvent(view, delta("old junk"));
    claudePaneApplyHistory(view, "abc12345-xxxx", [
      { type: "user", message: { content: [{ type: "text", text: "q1" }] } },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "a1" }] },
      },
    ]);
    expect(view.transcriptEl.textContent).not.toContain("old junk");
    expect(view.transcriptEl.textContent).toContain("resumed session abc12345");
    expect(view.transcriptEl.querySelectorAll(".claude-msg-user")).toHaveLength(
      1,
    );
    expect(
      view.transcriptEl.querySelectorAll(".claude-msg-assistant"),
    ).toHaveLength(1);
    destroyClaudePaneView(view);
  });

  test("exit disables composer; reset (new session) revives it", () => {
    const { view, calls } = makeView();
    claudePaneApplyExit(view, "subprocess died");
    expect(view.composerEl.disabled).toBe(true);
    expect(view.transcriptEl.textContent).toContain("subprocess died");
    view.composerEl.value = "x";
    view.sendBtn.click();
    expect(calls.filter((c) => c[0] === "prompt")).toHaveLength(0);
    claudePaneReset(view);
    expect(view.composerEl.disabled).toBe(false);
    view.composerEl.value = "y";
    view.sendBtn.click();
    expect(calls.filter((c) => c[0] === "prompt")).toHaveLength(1);
    destroyClaudePaneView(view);
  });

  test("sessions menu: resume + fork rows fire in-place callbacks", () => {
    const { view, calls } = makeView();
    claudePaneApplySessions(view, [
      {
        sessionId: "abc-123",
        summary: "Fix auth",
        firstPrompt: null,
        cwd: "/repo",
        gitBranch: "main",
        lastModified: 1_754_000_000_000,
      },
    ]);
    (
      view.resumeMenuEl.querySelector(
        ".claude-resume-main",
      ) as HTMLButtonElement
    ).click();
    expect(calls).toContainEqual([
      "resume",
      "claude-agent:1",
      "abc-123",
      false,
    ]);
    claudePaneApplySessions(view, [
      {
        sessionId: "abc-123",
        summary: "Fix auth",
        firstPrompt: null,
        cwd: null,
        gitBranch: null,
        lastModified: 0,
      },
    ]);
    (
      view.resumeMenuEl.querySelector(
        ".claude-resume-fork",
      ) as HTMLButtonElement
    ).click();
    expect(calls).toContainEqual(["resume", "claude-agent:1", "abc-123", true]);
    claudePaneApplySessions(view, []);
    expect(view.resumeMenuEl.textContent).toContain("No previous sessions");
    destroyClaudePaneView(view);
  });

  test("New button resets nothing itself — it only signals (controller resets)", () => {
    const { view, calls } = makeView();
    const newBtn = [...view.container.querySelectorAll("button")].find(
      (b) => b.textContent === "New",
    )!;
    newBtn.click();
    expect(calls).toContainEqual(["newSession", "claude-agent:1"]);
    destroyClaudePaneView(view);
  });
});
