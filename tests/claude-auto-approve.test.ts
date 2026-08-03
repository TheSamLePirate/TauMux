/**
 * Claude permission auto-approve — the safety rules are the feature.
 *
 * Accepting a permission prompt unattended is exactly the gate that
 * protects the user, so every guard gets a test: tty-only, terminal
 * panes only, transition-only, opt-in, burst-limited, audited.
 */
import { describe, test, expect } from "bun:test";
import {
  ClaudeAutoApprove,
  canAutoApprove,
} from "../src/bun/claude-auto-approve";
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

const pendingTty = (over: Partial<ClaudeSessionState> = {}) =>
  state({
    phase: "waiting-approval",
    approvalSource: "tty",
    surfaceId: "surface:2",
    ...over,
  });

describe("canAutoApprove (the safety rule set)", () => {
  test("accepts a tty prompt in a terminal pane", () => {
    expect(canAutoApprove(pendingTty())).toBe(true);
  });

  test("REFUSES a modal-routed approval — there is no terminal prompt", () => {
    expect(canAutoApprove(pendingTty({ approvalSource: "modal" }))).toBe(false);
  });

  test("REFUSES the native Claude pane — it has no tty", () => {
    expect(canAutoApprove(pendingTty({ surfaceId: "claude-agent:1" }))).toBe(
      false,
    );
  });

  test("REFUSES without pane attribution, when not waiting, or when ended", () => {
    expect(canAutoApprove(pendingTty({ surfaceId: null }))).toBe(false);
    expect(canAutoApprove(pendingTty({ phase: "working" }))).toBe(false);
    expect(canAutoApprove(pendingTty({ ended: true }))).toBe(false);
    expect(canAutoApprove(pendingTty({ approvalSource: null }))).toBe(false);
  });
});

describe("registry marks the approval source", () => {
  const ev = (p: Partial<ClaudeBridgeEvent>): ClaudeBridgeEvent =>
    ({ sessionId: "s1", ...p }) as ClaudeBridgeEvent;

  test("notify-permission → tty; permission-request → modal", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent(ev({ type: "notify-permission", message: "use Bash" }));
    expect(reg.get("s1")!.approvalSource).toBe("tty");
    reg.applyEvent(ev({ type: "permission-request", message: "Bash" }));
    expect(reg.get("s1")!.approvalSource).toBe("modal");
  });

  test("resolution and the next turn clear it", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent(ev({ type: "notify-permission" }));
    reg.applyEvent(ev({ type: "stop" }));
    expect(reg.get("s1")!.approvalSource).toBeNull();
    reg.applyEvent(ev({ type: "notify-permission" }));
    reg.applyEvent(ev({ type: "prompt", prompt: "next" }));
    expect(reg.get("s1")!.approvalSource).toBeNull();
  });
});

function setup(opts: { enabled?: boolean } = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const timers: Array<() => void> = [];
  let enabled = opts.enabled ?? true;
  let now = T0;
  const registry = new ClaudeSessionRegistry(() => now);
  const engine = new ClaudeAutoApprove({
    callRpc: (method, params) => {
      calls.push({ method, params });
      return "OK";
    },
    isEnabled: () => enabled,
    delayMs: () => 0,
    setTimer: (fn) => {
      timers.push(fn);
      return 0;
    },
    now: () => now,
  });
  engine.attach(registry);
  const send = (p: Partial<ClaudeBridgeEvent>) =>
    registry.applyEvent({
      sessionId: "s1",
      surfaceId: "surface:2",
      ...p,
    } as ClaudeBridgeEvent);
  const flush = () => {
    const pending = timers.splice(0);
    for (const t of pending) t();
  };
  return {
    calls,
    engine,
    registry,
    send,
    flush,
    timerCount: () => timers.length,
    setEnabled: (v: boolean) => (enabled = v),
    advance: (ms: number) => (now += ms),
  };
}

const keySends = (calls: Array<{ method: string }>) =>
  calls.filter((c) => c.method === "surface.send_key");

describe("auto-approve engine", () => {
  test("sends Enter to the pane and logs an audit line", () => {
    const { calls, send, flush } = setup();
    send({ type: "notify-permission", message: "Claude needs to use Bash" });
    flush();
    const key = keySends(calls)[0]!;
    expect(key).toBeDefined();
    expect(key).toMatchObject({
      method: "surface.send_key",
      params: { surface_id: "surface:2", key: "enter" },
    });
    const log = calls.find((c) => c.method === "sidebar.log")!;
    expect(String(log.params["message"])).toContain("auto-approved");
    expect(String(log.params["message"])).toContain("Bash");
  });

  test("does nothing when the setting is off", () => {
    const { calls, send, flush } = setup({ enabled: false });
    send({ type: "notify-permission" });
    flush();
    expect(keySends(calls)).toHaveLength(0);
  });

  test("never answers a modal-routed approval", () => {
    const { calls, send, flush } = setup();
    send({ type: "permission-request", message: "Bash" });
    flush();
    expect(keySends(calls)).toHaveLength(0);
  });

  test("never types into the native Claude pane", () => {
    const { calls, send, flush } = setup();
    send({ type: "notify-permission", surfaceId: "claude-agent:1" });
    flush();
    expect(keySends(calls)).toHaveLength(0);
  });

  test("fires once per prompt — statusline tees don't re-trigger it", () => {
    const { calls, send, flush, registry } = setup();
    send({ type: "notify-permission" });
    // Data-plane updates arrive while the prompt is still up.
    registry.applyStatusline({ sessionId: "s1", costUsd: 0.2 });
    registry.applyStatusline({ sessionId: "s1", costUsd: 0.3 });
    flush();
    expect(keySends(calls)).toHaveLength(1);
  });

  test("burst guard pauses the session and notifies", () => {
    const s = setup();
    for (let i = 0; i < 9; i++) {
      s.send({ type: "notify-permission" });
      s.flush();
      // Turn continues, then another prompt appears.
      s.send({ type: "prompt", prompt: "x" });
      s.advance(100);
    }
    // 8 allowed, the 9th trips the guard.
    expect(keySends(s.calls)).toHaveLength(8);
    const notif = s.calls.find((c) => c.method === "notification.create")!;
    expect(String(notif.params["title"])).toContain("paused");
  });

  test("does NOT send if the prompt is answered during the delay", () => {
    const { calls, send, flush } = setup();
    send({ type: "notify-permission" });
    // The user answers it in the terminal themselves; the turn resumes.
    send({ type: "prompt", prompt: "continues" });
    flush();
    expect(keySends(calls)).toHaveLength(0);
  });

  test("a throwing dispatcher never breaks ingestion", () => {
    const registry = new ClaudeSessionRegistry(() => T0);
    const engine = new ClaudeAutoApprove({
      callRpc: () => {
        throw new Error("down");
      },
      isEnabled: () => true,
      delayMs: () => 0,
      setTimer: (fn) => {
        fn();
        return 0;
      },
    });
    engine.attach(registry);
    const s = registry.applyEvent({
      type: "notify-permission",
      sessionId: "s1",
      surfaceId: "surface:2",
    } as ClaudeBridgeEvent);
    expect(s?.phase).toBe("waiting-approval");
  });
});

describe("approveNow (manual path)", () => {
  test("answers the longest-waiting session and reports the pane", () => {
    const { engine, calls, registry } = setup({ enabled: false });
    let now = T0;
    registry.applyEvent({
      type: "notify-permission",
      sessionId: "a",
      surfaceId: "surface:1",
      ts: now,
    } as ClaudeBridgeEvent);
    now += 5000;
    registry.applyEvent({
      type: "notify-permission",
      sessionId: "b",
      surfaceId: "surface:9",
      ts: now,
    } as ClaudeBridgeEvent);
    const r = engine.approveNow();
    expect(r).toMatchObject({ ok: true, surfaceId: "surface:1" });
    expect(keySends(calls)[0]!.params).toMatchObject({
      surface_id: "surface:1",
    });
  });

  test("targets a named surface; refuses with a reason when nothing waits", () => {
    const { engine, registry } = setup({ enabled: false });
    registry.applyEvent({
      type: "notify-permission",
      sessionId: "a",
      surfaceId: "surface:1",
    } as ClaudeBridgeEvent);
    expect(engine.approveNow("surface:1").ok).toBe(true);
    expect(engine.approveNow("surface:404")).toMatchObject({ ok: false });
    expect(engine.approveNow("surface:404").reason).toContain("surface:404");
  });

  test("manual approve works even with auto-approve disabled", () => {
    const { engine, calls, registry } = setup({ enabled: false });
    registry.applyEvent({
      type: "notify-permission",
      sessionId: "a",
      surfaceId: "surface:3",
    } as ClaudeBridgeEvent);
    expect(engine.approveNow().ok).toBe(true);
    expect(keySends(calls)).toHaveLength(1);
    const log = calls.find((c) => c.method === "sidebar.log")!;
    // Manual approvals are logged too, but not labelled "auto".
    expect(String(log.params["message"])).toContain("approved");
    expect(String(log.params["message"])).not.toContain("auto-approved");
  });
});

// ── back-to-back prompts in a single turn ─────────────────────────────
//
// Regression for a live failure: with auto-approve on, a turn that asked
// permission three times had ONLY its first prompt answered and then hung
// forever on the second, with "Do you want to proceed? ❯ 1. Yes" sitting
// on screen and nothing pressing Enter.
//
// Root cause: Claude Code ships no "prompt resolved" hook, so answering a
// prompt emits nothing. The session stays in `waiting-approval`, and the
// next `notify-permission` reduces to a byte-identical state — which the
// old "only fire on the transition into waiting-approval" guard could not
// tell apart from the same prompt still being up.

describe("consecutive prompts within one turn", () => {
  test("every prompt is answered, not just the first", () => {
    const { calls, send, flush } = setup();
    for (let i = 0; i < 3; i++) {
      send({ type: "notify-permission", message: "Claude needs your permission" });
      flush();
    }
    expect(keySends(calls)).toHaveLength(3);
  });

  test("the phase never leaves waiting-approval in between (the live shape)", () => {
    const { registry, send, flush, calls } = setup();
    send({ type: "notify-permission", message: "Claude needs your permission" });
    flush();
    expect(registry.get("s1")!.phase).toBe("waiting-approval");
    // Second prompt: identical message, identical phase, identical source.
    send({ type: "notify-permission", message: "Claude needs your permission" });
    flush();
    expect(registry.get("s1")!.phase).toBe("waiting-approval");
    expect(keySends(calls)).toHaveLength(2);
  });

  test("a statusline tee arriving mid-prompt still does not re-fire", () => {
    const { calls, send, flush, registry } = setup();
    send({ type: "notify-permission", message: "Claude needs your permission" });
    flush();
    // The tee bumps cost/context but announces no new prompt.
    registry.applyStatusline({
      sessionId: "s1",
      surfaceId: "surface:2",
      costUsd: 0.5,
      contextUsedPct: 40,
    } as never);
    flush();
    expect(keySends(calls)).toHaveLength(1);
  });

  test("the burst guard still counts them and pauses at the cap", () => {
    const { calls, send, flush } = setup();
    for (let i = 0; i < 12; i++) {
      send({ type: "notify-permission", message: "prompt" });
      flush();
    }
    // MAX_BURST = 8 approvals, then the session pauses and notifies.
    expect(keySends(calls)).toHaveLength(8);
    expect(
      calls.filter((c) => c.method === "notification.create"),
    ).not.toHaveLength(0);
  });

  test("flipping auto-approve on mid-prompt still answers the NEXT prompt", () => {
    const { calls, send, flush, setEnabled } = setup({ enabled: false });
    send({ type: "notify-permission", message: "prompt one" });
    flush();
    expect(keySends(calls)).toHaveLength(0);
    setEnabled(true);
    send({ type: "notify-permission", message: "prompt two" });
    flush();
    expect(keySends(calls)).toHaveLength(1);
  });

  test("a new turn re-arms cleanly", () => {
    const { calls, send, flush } = setup();
    send({ type: "notify-permission", message: "prompt" });
    flush();
    send({ type: "stop" });
    send({ type: "prompt", prompt: "next" });
    send({ type: "notify-permission", message: "prompt" });
    flush();
    expect(keySends(calls)).toHaveLength(2);
  });
});
