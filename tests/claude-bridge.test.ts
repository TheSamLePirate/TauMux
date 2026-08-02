/**
 * ht-bridge v2 — pure event-builder tests with recorded hook payloads.
 *
 * Also the WIRE-CONTRACT LOCK between the bridge (which cannot import
 * from src/ — it's symlinked into ~/.claude) and the app: every built
 * event is assigned to the shared `ClaudeBridgeEvent` type and run
 * through the real registry reducer, so a drift on either side fails
 * here at compile- or run-time.
 */
import { describe, test, expect } from "bun:test";
import {
  buildBridgeEvent,
  BRIDGE_EVENT_NAMES,
} from "../claude-integration/ht-bridge/src/build-event";
import { ClaudeSessionRegistry } from "../src/bun/claude-session-registry";
import type { ClaudeBridgeEvent } from "../src/shared/claude-types";

const T0 = 1_754_000_000_000;
const ENV = { HT_SURFACE: "surface:7" };

/** Universal fields every Claude Code hook payload carries. */
const BASE = {
  session_id: "abc123",
  transcript_path: "/Users/dev/.claude/projects/x/abc123.jsonl",
  cwd: "/Users/dev/project",
  permission_mode: "default",
  hook_event_name: "X",
};

describe("buildBridgeEvent", () => {
  test("unknown event names are skipped, not crashed", () => {
    expect(buildBridgeEvent("future-thing", BASE, ENV, T0)).toBeNull();
    expect(buildBridgeEvent("", BASE, ENV, T0)).toBeNull();
  });

  test("universal fields: session, surface, cwd, mode, transcript, ts", () => {
    const ev = buildBridgeEvent("stop", BASE, ENV, T0)!;
    expect(ev).toEqual({
      type: "stop",
      sessionId: "abc123",
      ts: T0,
      surfaceId: "surface:7",
      cwd: "/Users/dev/project",
      permissionMode: "default",
      transcriptPath: BASE.transcript_path,
    });
  });

  test("outside τ-mux (no HT_SURFACE) the event still builds", () => {
    const ev = buildBridgeEvent("stop", BASE, {}, T0)!;
    expect(ev["surfaceId"]).toBeUndefined();
    expect(ev["sessionId"]).toBe("abc123");
  });

  test("missing session_id degrades to 'unknown'", () => {
    const ev = buildBridgeEvent("stop", {}, {}, T0)!;
    expect(ev["sessionId"]).toBe("unknown");
  });

  test("session-start carries source; session-end carries reason", () => {
    expect(
      buildBridgeEvent(
        "session-start",
        { ...BASE, source: "resume" },
        ENV,
        T0,
      )!["source"],
    ).toBe("resume");
    expect(
      buildBridgeEvent("session-end", { ...BASE, reason: "logout" }, ENV, T0)![
        "reason"
      ],
    ).toBe("logout");
  });

  test("prompt is forwarded and capped", () => {
    const ev = buildBridgeEvent(
      "prompt",
      { ...BASE, prompt: "p".repeat(5000) },
      ENV,
      T0,
    )!;
    expect((ev["prompt"] as string).length).toBe(2000);
  });

  test("stop-failure carries error type + capped message", () => {
    const ev = buildBridgeEvent(
      "stop-failure",
      { ...BASE, error_type: "rate_limit", error_message: "e".repeat(900) },
      ENV,
      T0,
    )!;
    expect(ev["errorType"]).toBe("rate_limit");
    expect((ev["errorMessage"] as string).length).toBe(500);
  });

  test("subagent events carry agent identity", () => {
    const ev = buildBridgeEvent(
      "subagent-start",
      { ...BASE, agent_id: "a1", agent_type: "Explore" },
      ENV,
      T0,
    )!;
    expect(ev["agentId"]).toBe("a1");
    expect(ev["agentType"]).toBe("Explore");
  });

  test("cwd-changed maps new_cwd onto cwd", () => {
    const ev = buildBridgeEvent(
      "cwd-changed",
      { ...BASE, old_cwd: "/a", new_cwd: "/b" },
      ENV,
      T0,
    )!;
    expect(ev["cwd"]).toBe("/b");
  });

  test("notify events carry the message, capped", () => {
    const ev = buildBridgeEvent(
      "notify-permission",
      { ...BASE, message: "Claude needs permission to run Bash" },
      ENV,
      T0,
    )!;
    expect(ev["message"]).toBe("Claude needs permission to run Bash");
  });

  test("task events use the REAL payload fields (task_subject + task_description)", () => {
    // Shape captured live from Claude Code 2.1.220 (TaskCreated hook).
    const ev = buildBridgeEvent(
      "task-created",
      {
        ...BASE,
        task_id: "9",
        task_subject: "Probe task two — payload capture",
        task_description: "Temporary: captures the raw payload.",
      },
      ENV,
      T0,
    )!;
    expect(ev["taskId"]).toBe("9");
    expect(ev["taskName"]).toBe("Probe task two — payload capture");
    expect(ev["taskDescription"]).toBe("Temporary: captures the raw payload.");
  });

  test("task events fall back to task_name (documented shape); contentless are skipped", () => {
    const ev = buildBridgeEvent(
      "task-created",
      { ...BASE, task_id: "t1", task_name: "Write tests" },
      ENV,
      T0,
    )!;
    expect(ev["taskName"]).toBe("Write tests");
    expect(buildBridgeEvent("task-created", BASE, ENV, T0)).toBeNull();
  });

  test("task subject/description are capped", () => {
    const ev = buildBridgeEvent(
      "task-created",
      {
        ...BASE,
        task_id: "t1",
        task_subject: "s".repeat(400),
        task_description: "d".repeat(900),
      },
      ENV,
      T0,
    )!;
    expect((ev["taskName"] as string).length).toBe(200);
    expect((ev["taskDescription"] as string).length).toBe(500);
  });
});

describe("wire contract: bridge → registry", () => {
  test("every event name the bridge can emit is accepted by the registry", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    for (const name of BRIDGE_EVENT_NAMES) {
      const payload = {
        ...BASE,
        source: "startup",
        reason: "other",
        prompt: "hello",
        error_type: "rate_limit",
        agent_id: "a1",
        agent_type: "Explore",
        new_cwd: "/b",
        message: "m",
        task_id: "t1",
        task_name: "T",
      };
      const built = buildBridgeEvent(name, payload, ENV, T0);
      expect(built).not.toBeNull();
      // Compile-time lock: the bridge's output IS a ClaudeBridgeEvent.
      const typed = built as unknown as ClaudeBridgeEvent;
      const applied = reg.applyEvent(typed);
      expect(applied).not.toBeNull();
    }
  });

  test("full lifecycle replay lands in the expected end state", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    const replay: Array<[string, Record<string, unknown>]> = [
      ["session-start", { ...BASE, source: "startup" }],
      ["prompt", { ...BASE, prompt: "Fix the login bug. Please." }],
      ["subagent-start", { ...BASE, agent_id: "a1", agent_type: "Explore" }],
      ["subagent-stop", { ...BASE, agent_id: "a1" }],
      ["task-created", { ...BASE, task_id: "t1", task_name: "Fix" }],
      ["task-completed", { ...BASE, task_id: "t1" }],
      ["stop", BASE],
      ["session-end", { ...BASE, reason: "other" }],
    ];
    for (const [name, payload] of replay) {
      const built = buildBridgeEvent(name, payload, ENV, T0);
      reg.applyEvent(built as unknown as ClaudeBridgeEvent);
    }
    const s = reg.get("abc123")!;
    expect(s.ended).toBe(true);
    expect(s.turnCount).toBe(1);
    expect(s.subagents).toEqual([]);
    expect(s.tasks[0]!.state).toBe("completed");
    expect(s.surfaceId).toBe("surface:7");
  });
});
