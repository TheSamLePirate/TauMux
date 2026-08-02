import { describe, test, expect } from "bun:test";
import {
  ClaudeStatusPresenter,
  renderPills,
  decideNotification,
  prettyErrorType,
} from "../src/bun/claude-status-presenter";
import { ClaudeSessionRegistry } from "../src/bun/claude-session-registry";
import {
  newClaudeSessionState,
  type ClaudeBridgeEvent,
  type ClaudeSessionState,
} from "../src/shared/claude-types";

const T0 = 1_754_000_000_000;

function state(over: Partial<ClaudeSessionState>): ClaudeSessionState {
  return { ...newClaudeSessionState("s1", T0), ...over };
}

describe("renderPills", () => {
  test("working shows the best title in the working color", () => {
    const p = renderPills(
      state({ phase: "working", label: "Fix bug", sessionName: "" }),
    );
    expect(p.label).toEqual({ value: "Fix bug", color: "#f5c2e7" });
    const p2 = renderPills(
      state({ phase: "working", label: "Fix bug", sessionName: "Auth work" }),
    );
    expect(p2.label!.value).toBe("Auth work");
  });

  test("waiting/approval/compacting/error phases map to their pills", () => {
    expect(renderPills(state({ phase: "waiting-input" })).label!.value).toBe(
      "Waiting for input",
    );
    expect(renderPills(state({ phase: "waiting-approval" })).label!.value).toBe(
      "Approval needed",
    );
    expect(renderPills(state({ phase: "compacting" })).label!.value).toBe(
      "Compacting…",
    );
    expect(
      renderPills(state({ phase: "error", errorType: "rate_limit" })).label!
        .value,
    ).toBe("Rate limited");
  });

  test("idle clears the label; ticker prefers model · ctx · cost", () => {
    const p = renderPills(
      state({
        phase: "idle",
        modelDisplayName: "Opus",
        contextUsedPct: 42.4,
        costUsd: 0.31,
        turnCount: 3,
      }),
    );
    expect(p.label).toBeNull();
    expect(p.ticker).toBe("Opus · 42% ctx · $0.31");
  });

  test("ticker falls back to turn count before data arrives", () => {
    expect(renderPills(state({ phase: "idle", turnCount: 2 })).ticker).toBe(
      "turn 2",
    );
    expect(renderPills(state({ phase: "idle" })).ticker).toBeNull();
  });

  test("ended session renders nothing", () => {
    const p = renderPills(
      state({ phase: "ended", ended: true, modelDisplayName: "Opus" }),
    );
    expect(p.label).toBeNull();
    expect(p.ticker).toBeNull();
  });
});

describe("prettyErrorType", () => {
  test("maps known types and degrades", () => {
    expect(prettyErrorType("rate_limit")).toBe("Rate limited");
    expect(prettyErrorType("overloaded")).toBe("API overloaded");
    expect(prettyErrorType("weird")).toBe("Error: weird");
    expect(prettyErrorType(null)).toBe("Error");
  });
});

describe("decideNotification", () => {
  test("turn end fires a summary with duration and cost", () => {
    const prev = state({ phase: "working", promptStartedAt: T0 });
    const cur = state({
      phase: "idle",
      promptStartedAt: 0,
      sessionName: "Auth work",
      currentPrompt: "Fix the login bug",
      costUsd: 0.2,
    });
    const n = decideNotification(cur, prev, T0 + 65_000);
    expect(n).not.toBeNull();
    expect(n!.title).toBe("Claude · Auth work");
    expect(n!.body).toContain("Fix the login bug");
    expect(n!.body).toContain("1 min");
    expect(n!.body).toContain("$0.2");
  });

  test("no notification on first sight or on statusline-only changes", () => {
    expect(
      decideNotification(state({ phase: "working" }), null, T0),
    ).toBeNull();
    const prev = state({ phase: "idle" });
    const cur = state({ phase: "idle", costUsd: 0.5 });
    expect(decideNotification(cur, prev, T0)).toBeNull();
  });

  test("error and approval transitions notify once", () => {
    const prevWorking = state({ phase: "working" });
    const err = state({
      phase: "error",
      errorType: "rate_limit",
      errorMessage: "429",
    });
    expect(decideNotification(err, prevWorking, T0)!.title).toContain(
      "rate limited",
    );
    // error → error again: no re-fire
    expect(decideNotification(err, err, T0)).toBeNull();

    const appr = state({ phase: "waiting-approval" });
    expect(decideNotification(appr, prevWorking, T0)!.title).toContain(
      "approval needed",
    );
    expect(decideNotification(appr, appr, T0)).toBeNull();
  });

  test("waiting-input does NOT notify (pill is enough)", () => {
    const prev = state({ phase: "working", promptStartedAt: T0 });
    const cur = state({ phase: "waiting-input", promptStartedAt: T0 });
    expect(decideNotification(cur, prev, T0)).toBeNull();
  });

  test("session end mid-idle does not fire a turn summary", () => {
    const prev = state({ phase: "working", promptStartedAt: T0 });
    const cur = state({
      phase: "ended",
      ended: true,
      promptStartedAt: 0,
    });
    expect(decideNotification(cur, prev, T0)).toBeNull();
  });
});

describe("ClaudeStatusPresenter (shell)", () => {
  function setup(enabled = true) {
    const calls: Array<{ method: string; params: Record<string, unknown> }> =
      [];
    const registry = new ClaudeSessionRegistry(() => T0);
    const presenter = new ClaudeStatusPresenter(
      {
        callRpc: (method, params) => {
          calls.push({ method, params });
          return "OK";
        },
        enabled: () => enabled,
      },
      () => T0 + 1000,
    );
    presenter.attach(registry);
    const send = (e: Partial<ClaudeBridgeEvent>) =>
      registry.applyEvent({
        type: "prompt",
        sessionId: "s1",
        ...e,
      } as ClaudeBridgeEvent);
    return { calls, registry, presenter, send };
  }

  test("prompt paints label + ticker with surface attribution", () => {
    const { calls, send } = setup();
    send({ type: "prompt", prompt: "Fix bug", surfaceId: "surface:4" });
    const set = calls.filter((c) => c.method === "sidebar.set_status");
    expect(set.length).toBe(2);
    const label = set.find((c) => c.params["key"] === "Claude")!;
    expect(label.params["value"]).toBe("Fix bug");
    expect(label.params["surface_id"]).toBe("surface:4");
    const ticker = set.find((c) => c.params["key"] === "cc")!;
    expect(ticker.params["value"]).toBe("turn 1");
  });

  test("identical state does not re-dispatch (statusline dedup)", () => {
    const { calls, registry, send } = setup();
    send({ type: "prompt", prompt: "x" });
    const before = calls.length;
    // A statusline tee that changes nothing visible.
    registry.applyStatusline({ sessionId: "s1" });
    expect(calls.length).toBe(before);
  });

  test("stop clears the label, refreshes ticker, fires the summary", () => {
    const { calls, send } = setup();
    send({ type: "prompt", prompt: "Fix bug" });
    calls.length = 0;
    send({ type: "stop" });
    expect(
      calls.some(
        (c) =>
          c.method === "sidebar.clear_status" && c.params["key"] === "Claude",
      ),
    ).toBe(true);
    const notif = calls.find((c) => c.method === "notification.create")!;
    expect(notif).toBeDefined();
    expect(String(notif.params["title"])).toContain("Claude");
    expect(notif.params["subtitle"]).toBe("Claude Code");
  });

  test("session-end clears both pills", () => {
    const { calls, send } = setup();
    send({ type: "prompt", prompt: "x" });
    calls.length = 0;
    send({ type: "session-end" });
    const cleared = calls
      .filter((c) => c.method === "sidebar.clear_status")
      .map((c) => c.params["key"]);
    expect(cleared).toContain("Claude");
    expect(cleared).toContain("cc");
  });

  test("disabled presenter stays silent", () => {
    const { calls, send } = setup(false);
    send({ type: "prompt", prompt: "x" });
    expect(calls.length).toBe(0);
  });

  test("a throwing dispatcher never breaks ingestion", () => {
    const registry = new ClaudeSessionRegistry(() => T0);
    const presenter = new ClaudeStatusPresenter({
      callRpc: () => {
        throw new Error("dispatcher down");
      },
    });
    presenter.attach(registry);
    const s = registry.applyEvent({
      type: "prompt",
      sessionId: "s1",
      prompt: "x",
    });
    expect(s?.phase).toBe("working");
  });
});
