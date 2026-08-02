/**
 * WS5 — Claude pane: pure event digestion + DOM smoke (happy-dom).
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
  createClaudePaneView,
  claudePaneApplyEvent,
  claudePaneApplyExit,
  claudePaneApplySessions,
  destroyClaudePaneView,
  type ClaudePaneCallbacks,
} from "../src/views/terminal/claude-agent-pane";

describe("digestClaudeEvent", () => {
  test("system init → meta", () => {
    expect(
      digestClaudeEvent({
        type: "system",
        subtype: "init",
        model: "claude-opus-5",
        session_id: "s1",
        permissionMode: "plan",
      }),
    ).toEqual({
      kind: "meta",
      model: "claude-opus-5",
      sessionId: "s1",
      mode: "plan",
    });
  });

  test("user text echoes; tool_result user messages are skipped", () => {
    expect(
      digestClaudeEvent({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
    ).toEqual({ kind: "user-text", text: "hi" });
    expect(
      digestClaudeEvent({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t", content: "big" }],
        },
      }),
    ).toEqual({ kind: "none" });
  });

  test("assistant text vs tool_use", () => {
    expect(
      digestClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: "done" }] },
      }),
    ).toEqual({ kind: "assistant-text", text: "done", append: false });
    expect(
      digestClaudeEvent({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "bun test" } },
          ],
        },
      }),
    ).toEqual({ kind: "tool-start", toolName: "Bash", summary: "$ bun test" });
  });

  test("stream text deltas append; result carries cost", () => {
    expect(
      digestClaudeEvent({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "par" },
        },
      }),
    ).toEqual({ kind: "assistant-text", text: "par", append: true });
    expect(
      digestClaudeEvent({
        type: "result",
        subtype: "success",
        total_cost_usd: 0.12,
        duration_ms: 4200,
      }),
    ).toEqual({
      kind: "result",
      costUsd: 0.12,
      durationMs: 4200,
      isError: false,
    });
  });

  test("unknown SDK message types are ignored, not crashed", () => {
    expect(digestClaudeEvent({ type: "hook_started" })).toEqual({
      kind: "none",
    });
    expect(digestClaudeEvent(null)).toEqual({ kind: "none" });
    expect(digestClaudeEvent("garbage")).toEqual({ kind: "none" });
  });
});

describe("toolSummary", () => {
  test("bash / file / generic shapes", () => {
    expect(toolSummary("Bash", { command: "ls -la" })).toBe("$ ls -la");
    expect(toolSummary("Edit", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(toolSummary("mcp__x", { q: 1 })).toContain('"q":1');
    expect(toolSummary("Weird", {})).toBe("");
  });
});

function makeCallbacks(): {
  cb: ClaudePaneCallbacks;
  calls: Array<[string, ...unknown[]]>;
} {
  const calls: Array<[string, ...unknown[]]> = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    cb: {
      onPrompt: rec("prompt") as ClaudePaneCallbacks["onPrompt"],
      onInterrupt: rec("interrupt") as ClaudePaneCallbacks["onInterrupt"],
      onSetMode: rec("setMode") as ClaudePaneCallbacks["onSetMode"],
      onListSessions: rec(
        "listSessions",
      ) as ClaudePaneCallbacks["onListSessions"],
      onResume: rec("resume") as ClaudePaneCallbacks["onResume"],
      onClose: rec("close") as ClaudePaneCallbacks["onClose"],
      onFocus: rec("focus") as ClaudePaneCallbacks["onFocus"],
      onSplit: rec("split") as ClaudePaneCallbacks["onSplit"],
    },
  };
}

describe("ClaudePaneView (DOM)", () => {
  test("send flows through composer; empty input is ignored", () => {
    const { cb, calls } = makeCallbacks();
    const view = createClaudePaneView("claude-agent:1", cb);
    view.composerEl.value = "  do the thing  ";
    view.sendBtn.click();
    expect(calls).toEqual([["prompt", "claude-agent:1", "do the thing"]]);
    expect(view.composerEl.value).toBe("");
    view.sendBtn.click(); // empty now
    expect(calls).toHaveLength(1);
    destroyClaudePaneView(view);
  });

  test("streaming: deltas accumulate into one bubble; full message replaces it", () => {
    const { cb } = makeCallbacks();
    const view = createClaudePaneView("claude-agent:1", cb);
    const delta = (text: string) => ({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text },
      },
    });
    claudePaneApplyEvent(view, delta("Hel"));
    claudePaneApplyEvent(view, delta("lo"));
    expect(
      view.transcriptEl.querySelectorAll(".claude-msg-assistant"),
    ).toHaveLength(1);
    expect(view.transcriptEl.textContent).toContain("Hello");
    claudePaneApplyEvent(view, {
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello there" }] },
    });
    expect(
      view.transcriptEl.querySelectorAll(".claude-msg-assistant"),
    ).toHaveLength(1);
    expect(view.transcriptEl.textContent).toContain("Hello there");
    destroyClaudePaneView(view);
  });

  test("meta updates model pill + mode select; result updates cost pill", () => {
    const { cb } = makeCallbacks();
    const view = createClaudePaneView("claude-agent:1", cb);
    claudePaneApplyEvent(view, {
      type: "system",
      subtype: "init",
      model: "claude-opus-5",
      permissionMode: "acceptEdits",
    });
    expect(view.modelPillEl.textContent).toBe("claude-opus-5");
    expect(view.modeSelectEl.value).toBe("acceptEdits");
    claudePaneApplyEvent(view, {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.05,
    });
    expect(view.costPillEl.textContent).toBe("$0.05");
    expect(view.interruptBtn.disabled).toBe(true);
    destroyClaudePaneView(view);
  });

  test("tool card renders name + summary", () => {
    const { cb } = makeCallbacks();
    const view = createClaudePaneView("claude-agent:1", cb);
    claudePaneApplyEvent(view, {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "bun test" } },
        ],
      },
    });
    const card = view.transcriptEl.querySelector(".claude-msg-tool")!;
    expect(card.textContent).toContain("Bash");
    expect(card.textContent).toContain("$ bun test");
    destroyClaudePaneView(view);
  });

  test("exit disables the composer and marks the transcript", () => {
    const { cb, calls } = makeCallbacks();
    const view = createClaudePaneView("claude-agent:1", cb);
    claudePaneApplyExit(view, "subprocess died");
    expect(view.composerEl.disabled).toBe(true);
    expect(view.transcriptEl.textContent).toContain("subprocess died");
    view.composerEl.value = "x";
    view.sendBtn.click();
    expect(calls.filter((c) => c[0] === "prompt")).toHaveLength(0);
    destroyClaudePaneView(view);
  });

  test("sessions list renders rows; clicking resumes", () => {
    const { cb, calls } = makeCallbacks();
    const view = createClaudePaneView("claude-agent:1", cb);
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
    const row = view.resumeMenuEl.querySelector(
      ".claude-resume-row",
    ) as HTMLButtonElement;
    expect(row.textContent).toContain("Fix auth");
    row.click();
    expect(calls).toContainEqual(["resume", "abc-123", false]);
    claudePaneApplySessions(view, []);
    expect(view.resumeMenuEl.textContent).toContain("No previous sessions");
    destroyClaudePaneView(view);
  });
});
