import { describe, test, expect } from "bun:test";
import {
  ClaudeSessionRegistry,
  reduceEvent,
  reduceStatusline,
} from "../src/bun/claude-session-registry";
import {
  newClaudeSessionState,
  firstClauseLabel,
  sessionTitle,
  type ClaudeBridgeEvent,
  type ClaudeSessionState,
  type ClaudeStatuslineData,
} from "../src/shared/claude-types";

const T0 = 1_754_000_000_000;

function ev(partial: Partial<ClaudeBridgeEvent>): ClaudeBridgeEvent {
  return { type: "prompt", sessionId: "sess-1", ...partial };
}

describe("reduceEvent", () => {
  test("session-start records source and attribution", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(
      s,
      ev({
        type: "session-start",
        source: "resume",
        surfaceId: "surface:3",
        cwd: "/repo",
        permissionMode: "plan",
        transcriptPath: "/t.jsonl",
      }),
      T0,
    );
    expect(s.source).toBe("resume");
    expect(s.surfaceId).toBe("surface:3");
    expect(s.cwd).toBe("/repo");
    expect(s.permissionMode).toBe("plan");
    expect(s.transcriptPath).toBe("/t.jsonl");
    expect(s.phase).toBe("idle");
  });

  test("prompt starts a turn: phase, label, count, clears stale error", () => {
    const s = newClaudeSessionState("sess-1", T0);
    s.errorType = "rate_limit";
    reduceEvent(
      s,
      ev({
        type: "prompt",
        prompt: "Fix the login bug. Then run tests.",
        ts: T0 + 100,
      }),
      T0,
    );
    expect(s.phase).toBe("working");
    expect(s.turnCount).toBe(1);
    expect(s.promptStartedAt).toBe(T0 + 100);
    expect(s.label).toBe("Fix the login bug");
    expect(s.currentPrompt).toContain("Then run tests");
    expect(s.errorType).toBeNull();
  });

  test("stop ends the turn back to idle", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(s, ev({ type: "prompt", prompt: "x" }), T0);
    reduceEvent(s, ev({ type: "stop" }), T0 + 5_000);
    expect(s.phase).toBe("idle");
    expect(s.promptStartedAt).toBe(0);
    expect(s.turnCount).toBe(1);
  });

  test("stop-failure surfaces the error", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(s, ev({ type: "prompt", prompt: "x" }), T0);
    reduceEvent(
      s,
      ev({
        type: "stop-failure",
        errorType: "rate_limit",
        errorMessage: "429 from API",
      }),
      T0,
    );
    expect(s.phase).toBe("error");
    expect(s.errorType).toBe("rate_limit");
    expect(s.errorMessage).toBe("429 from API");
    expect(s.promptStartedAt).toBe(0);
  });

  test("notify-idle / notify-permission set waiting phases", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(s, ev({ type: "prompt", prompt: "x" }), T0);
    reduceEvent(s, ev({ type: "notify-idle" }), T0);
    expect(s.phase).toBe("waiting-input");
    reduceEvent(s, ev({ type: "notify-permission" }), T0);
    expect(s.phase).toBe("waiting-approval");
  });

  test("compaction mid-turn returns to working, idle stays idle", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(s, ev({ type: "prompt", prompt: "x" }), T0);
    reduceEvent(s, ev({ type: "pre-compact" }), T0);
    expect(s.phase).toBe("compacting");
    reduceEvent(s, ev({ type: "post-compact" }), T0);
    expect(s.phase).toBe("working");

    reduceEvent(s, ev({ type: "stop" }), T0);
    reduceEvent(s, ev({ type: "pre-compact" }), T0);
    reduceEvent(s, ev({ type: "post-compact" }), T0);
    expect(s.phase).toBe("idle");
  });

  test("cwd-changed updates cwd instantly", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(s, ev({ type: "cwd-changed", cwd: "/repo/sub" }), T0);
    expect(s.cwd).toBe("/repo/sub");
  });

  test("subagents accumulate, dedupe by id, and drain", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(
      s,
      ev({ type: "subagent-start", agentId: "a1", agentType: "Explore" }),
      T0,
    );
    reduceEvent(
      s,
      ev({ type: "subagent-start", agentId: "a2", agentType: "Plan" }),
      T0,
    );
    // restart of a1 replaces rather than duplicates
    reduceEvent(
      s,
      ev({ type: "subagent-start", agentId: "a1", agentType: "Explore" }),
      T0,
    );
    expect(s.subagents.length).toBe(2);
    reduceEvent(s, ev({ type: "subagent-stop", agentId: "a1" }), T0);
    expect(s.subagents.map((x) => x.agentId)).toEqual(["a2"]);
  });

  test("session-end marks ended and clears live state", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(
      s,
      ev({ type: "subagent-start", agentId: "a1", agentType: "x" }),
      T0,
    );
    reduceEvent(s, ev({ type: "session-end", reason: "logout" }), T0);
    expect(s.ended).toBe(true);
    expect(s.endedReason).toBe("logout");
    expect(s.phase).toBe("ended");
    expect(s.subagents).toEqual([]);
  });

  test("session-start after end revives the session (resume)", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(s, ev({ type: "session-end" }), T0);
    reduceEvent(s, ev({ type: "session-start", source: "resume" }), T0);
    expect(s.ended).toBe(false);
    expect(s.phase).toBe("idle");
  });

  // ── task mirror ──

  test("task created → completed by id", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(
      s,
      ev({ type: "task-created", taskId: "t1", taskName: "Write tests" }),
      T0,
    );
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]!.state).toBe("pending");
    reduceEvent(s, ev({ type: "task-completed", taskId: "t1" }), T0 + 10);
    expect(s.tasks[0]!.state).toBe("completed");
    expect(s.tasks[0]!.completedAt).toBe(T0 + 10);
  });

  test("task created without id completes by name and adopts the real id", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(s, ev({ type: "task-created", taskName: "Refactor auth" }), T0);
    expect(s.tasks[0]!.id).toBe("name:Refactor auth");
    reduceEvent(
      s,
      ev({ type: "task-completed", taskId: "42", taskName: "Refactor auth" }),
      T0,
    );
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]!.state).toBe("completed");
    expect(s.tasks[0]!.id).toBe("42");
  });

  test("completion of a never-seen task is recorded, not dropped", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(
      s,
      ev({ type: "task-completed", taskId: "t9", taskName: "Ghost" }),
      T0,
    );
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]!.state).toBe("completed");
  });

  test("duplicate task-created events do not duplicate entries", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceEvent(
      s,
      ev({ type: "task-created", taskId: "t1", taskName: "A" }),
      T0,
    );
    reduceEvent(
      s,
      ev({ type: "task-created", taskId: "t1", taskName: "A" }),
      T0,
    );
    reduceEvent(s, ev({ type: "task-created", taskName: "A" }), T0);
    expect(s.tasks).toHaveLength(1);
  });
});

describe("reduceStatusline", () => {
  test("applies the data plane without touching phase", () => {
    const s = newClaudeSessionState("sess-1", T0);
    s.phase = "working";
    const d: ClaudeStatuslineData = {
      sessionId: "sess-1",
      surfaceId: "surface:2",
      sessionName: "Fix login flow",
      modelDisplayName: "Opus",
      costUsd: 0.42,
      contextUsedPct: 63.2,
      contextWindowSize: 200000,
      linesAdded: 120,
      linesRemoved: 8,
      permissionMode: "acceptEdits",
      effortLevel: "high",
      rateLimits: { fiveHourPct: 41, sevenDayPct: 12 },
      prNumber: 7,
      prUrl: "https://github.com/x/y/pull/7",
      prReviewState: "pending",
    };
    reduceStatusline(s, d, T0 + 1);
    expect(s.phase).toBe("working");
    expect(s.sessionName).toBe("Fix login flow");
    expect(s.modelDisplayName).toBe("Opus");
    expect(s.costUsd).toBe(0.42);
    expect(s.contextUsedPct).toBe(63.2);
    expect(s.rateLimits.fiveHourPct).toBe(41);
    expect(s.rateLimits.sevenDayPct).toBe(12);
    expect(s.prNumber).toBe(7);
    expect(s.surfaceId).toBe("surface:2");
    expect(sessionTitle(s)).toBe("Fix login flow");
  });

  test("partial payloads keep previous values", () => {
    const s = newClaudeSessionState("sess-1", T0);
    reduceStatusline(
      s,
      { sessionId: "sess-1", costUsd: 0.1, modelDisplayName: "Opus" },
      T0,
    );
    reduceStatusline(s, { sessionId: "sess-1", contextUsedPct: 12 }, T0 + 1);
    expect(s.costUsd).toBe(0.1);
    expect(s.modelDisplayName).toBe("Opus");
    expect(s.contextUsedPct).toBe(12);
  });
});

describe("firstClauseLabel", () => {
  test("takes the first clause and caps length", () => {
    expect(firstClauseLabel("Fix the bug. Then deploy.")).toBe("Fix the bug");
    expect(firstClauseLabel("")).toBe("Working");
    const long = "a".repeat(100);
    expect(firstClauseLabel(long).length).toBeLessThanOrEqual(40);
  });
});

describe("ClaudeSessionRegistry", () => {
  test("statusline before any event creates the session (out-of-order)", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    const s = reg.applyStatusline({ sessionId: "s1", costUsd: 0.2 });
    expect(s).not.toBeNull();
    expect(reg.get("s1")?.costUsd).toBe(0.2);
  });

  test("rejects garbage without throwing", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    expect(
      reg.applyEvent({ type: "prompt" } as unknown as ClaudeBridgeEvent),
    ).toBeNull();
    expect(reg.applyEvent(null as unknown as ClaudeBridgeEvent)).toBeNull();
    expect(
      reg.applyStatusline({} as unknown as ClaudeStatuslineData),
    ).toBeNull();
  });

  test("onChange delivers prev snapshot; a throwing listener does not break ingestion", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    const seen: Array<{
      phase: string;
      prevPhase: string | null;
    }> = [];
    reg.onChange(() => {
      throw new Error("boom");
    });
    reg.onChange((s, prev) => {
      seen.push({ phase: s.phase, prevPhase: prev?.phase ?? null });
    });
    reg.applyEvent(ev({ type: "prompt", prompt: "x" }));
    reg.applyEvent(ev({ type: "stop" }));
    expect(seen).toEqual([
      { phase: "working", prevPhase: null },
      { phase: "idle", prevPhase: "working" },
    ]);
  });

  test("list() excludes ended sessions, sorts by recency; forSurface resolves", () => {
    let now = T0;
    const reg = new ClaudeSessionRegistry(() => now);
    reg.applyEvent(
      ev({ sessionId: "a", type: "prompt", surfaceId: "surface:1" }),
    );
    now += 1000;
    reg.applyEvent(
      ev({ sessionId: "b", type: "prompt", surfaceId: "surface:2" }),
    );
    now += 1000;
    reg.applyEvent(ev({ sessionId: "c", type: "session-end" }));
    const ids = reg.list().map((s) => s.sessionId);
    expect(ids).toEqual(["b", "a"]);
    expect(reg.forSurface("surface:2")?.sessionId).toBe("b");
    expect(reg.forSurface("surface:9")).toBeNull();
  });

  test("ended sessions are pruned after the grace period", () => {
    let now = T0;
    const reg = new ClaudeSessionRegistry(() => now);
    reg.applyEvent(ev({ sessionId: "a", type: "session-end" }));
    now += 6 * 60 * 1000; // > 5 min grace
    reg.applyEvent(ev({ sessionId: "b", type: "prompt" }));
    expect(reg.get("a")).toBeUndefined();
    expect(reg.get("b")).toBeDefined();
  });

  test("stale live sessions are pruned after 24h", () => {
    let now = T0;
    const reg = new ClaudeSessionRegistry(() => now);
    reg.applyEvent(ev({ sessionId: "old", type: "prompt" }));
    now += 25 * 60 * 60 * 1000;
    reg.applyEvent(ev({ sessionId: "fresh", type: "prompt" }));
    expect(reg.get("old")).toBeUndefined();
  });

  test("session cap evicts the oldest, never wedges", () => {
    let now = T0;
    const reg = new ClaudeSessionRegistry(() => now);
    for (let i = 0; i < 205; i++) {
      now += 1;
      reg.applyEvent(ev({ sessionId: `s${i}`, type: "prompt" }));
    }
    expect(reg.listAll().length).toBeLessThanOrEqual(200);
    expect(reg.get("s204")).toBeDefined();
    expect(reg.get("s0")).toBeUndefined();
  });
});

// Wire-contract lock: a state serialized by the registry is what the CLI
// formatter consumes (`ht claude sessions`). Keep the shape stable.
describe("wire shape", () => {
  test("session state survives JSON round-trip unchanged", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent(ev({ type: "prompt", prompt: "x", surfaceId: "surface:1" }));
    const s = reg.get("sess-1") as ClaudeSessionState;
    const round = JSON.parse(JSON.stringify(s)) as ClaudeSessionState;
    expect(round).toEqual(s);
  });
});
