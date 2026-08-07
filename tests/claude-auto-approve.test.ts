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
      send({
        type: "notify-permission",
        message: "Claude needs your permission",
      });
      flush();
    }
    expect(keySends(calls)).toHaveLength(3);
  });

  test("the phase never leaves waiting-approval in between (the live shape)", () => {
    const { registry, send, flush, calls } = setup();
    send({
      type: "notify-permission",
      message: "Claude needs your permission",
    });
    flush();
    expect(registry.get("s1")!.phase).toBe("waiting-approval");
    // Second prompt: identical message, identical phase, identical source.
    send({
      type: "notify-permission",
      message: "Claude needs your permission",
    });
    flush();
    expect(registry.get("s1")!.phase).toBe("waiting-approval");
    expect(keySends(calls)).toHaveLength(2);
  });

  test("a statusline tee arriving mid-prompt still does not re-fire", () => {
    const { calls, send, flush, registry } = setup();
    send({
      type: "notify-permission",
      message: "Claude needs your permission",
    });
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

// ── questions addressed to the human ──────────────────────────────────
//
// Claude Code raises the SAME `Notification / permission_prompt` hook for
// an AskUserQuestion / ExitPlanMode modal as it does for "may I run this
// command", carrying the same generic message. Observed live: a
// multiple-choice question put the session into
// `waiting-approval | tty | "Claude needs your permission"`, which the
// engine would have answered by pressing Enter — silently selecting the
// default option on the user's behalf.

describe("never answers a question addressed to the user", () => {
  test("canAutoApprove refuses while a choice modal is up", () => {
    const base = state({
      phase: "waiting-approval",
      approvalSource: "tty",
      surfaceId: "surface:2",
    });
    expect(canAutoApprove(base)).toBe(true);
    expect(
      canAutoApprove({ ...base, awaitingUserChoice: "AskUserQuestion" }),
    ).toBe(false);
    expect(
      canAutoApprove({ ...base, awaitingUserChoice: "ExitPlanMode" }),
    ).toBe(false);
  });

  test("no Enter is sent for a question modal's permission_prompt", () => {
    const { calls, send, flush } = setup();
    send({ type: "ask-start", message: "AskUserQuestion" });
    send({
      type: "notify-permission",
      message: "Claude needs your permission",
    });
    flush();
    expect(keySends(calls)).toHaveLength(0);
  });

  test("a hook that lands AFTER the notification still blocks the send", () => {
    // The two hooks are separate processes; ordering is not guaranteed.
    // The delay + live re-check is what has to save us here.
    const { calls, send, flush } = setup();
    send({
      type: "notify-permission",
      message: "Claude needs your permission",
    });
    send({ type: "ask-start", message: "AskUserQuestion" });
    flush();
    expect(keySends(calls)).toHaveLength(0);
  });

  test("a real tool prompt right after the modal closes IS answered", () => {
    const { calls, send, flush } = setup();
    send({ type: "ask-start", message: "AskUserQuestion" });
    send({
      type: "notify-permission",
      message: "Claude needs your permission",
    });
    flush();
    expect(keySends(calls)).toHaveLength(0);
    send({ type: "ask-end", message: "AskUserQuestion" });
    send({
      type: "notify-permission",
      message: "Claude needs your permission",
    });
    flush();
    expect(keySends(calls)).toHaveLength(1);
  });

  test("manual `ht claude approve` refuses it too", () => {
    const { engine, send } = setup();
    send({ type: "ask-start", message: "AskUserQuestion" });
    send({
      type: "notify-permission",
      message: "Claude needs your permission",
    });
    // Pressing Enter on a choice modal picks a default — that is not what
    // "approve" means, so the explicit path declines as well.
    expect(engine.approveNow("surface:2").ok).toBe(false);
  });

  test("a missed ask-end cannot wedge the session forever", () => {
    for (const recovery of ["prompt", "stop", "session-end"] as const) {
      const { registry, send } = setup();
      send({ type: "ask-start", message: "AskUserQuestion" });
      expect(registry.get("s1")!.awaitingUserChoice).toBe("AskUserQuestion");
      send({ type: recovery });
      expect(registry.get("s1")!.awaitingUserChoice).toBeNull();
    }
  });

  test("ordinary tool prompts are unaffected", () => {
    const { calls, send, flush } = setup();
    send({
      type: "notify-permission",
      message: "Claude needs your permission",
    });
    flush();
    expect(keySends(calls)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Answering a question emits no "prompt resolved" event either, so the
// announcement it raised outlives it. Found live: with the guard working
// correctly, the session sat at `waiting-approval | tty` while actively
// working — a state that PASSES canAutoApprove, so `ht claude approve`
// would have typed Enter into a pane showing no prompt at all.

describe("ask-end retracts the announcement the question raised", () => {
  const ev = (p: Partial<ClaudeBridgeEvent>): ClaudeBridgeEvent =>
    ({ sessionId: "s1", surfaceId: "surface:2", ...p }) as ClaudeBridgeEvent;

  test("the session does not stay parked in waiting-approval", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent(ev({ type: "prompt", prompt: "do a thing" }));
    reg.applyEvent(ev({ type: "ask-start", message: "AskUserQuestion" }));
    reg.applyEvent(
      ev({ type: "notify-permission", message: "Claude needs your permission" }),
    );
    expect(reg.get("s1")!.phase).toBe("waiting-approval");
    reg.applyEvent(ev({ type: "ask-end", message: "AskUserQuestion" }));
    const s = reg.get("s1")!;
    expect(s.phase).toBe("working"); // mid-turn → back to working
    expect(s.approvalSource).toBeNull();
    expect(s.approvalMessage).toBeNull();
    // …and the manual path no longer sees anything worth answering.
    expect(canAutoApprove(s)).toBe(false);
  });

  test("it works whichever hook wins the race", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent(ev({ type: "prompt", prompt: "do a thing" }));
    // Reversed order: the notification beats the PreToolUse process.
    reg.applyEvent(ev({ type: "notify-permission" }));
    reg.applyEvent(ev({ type: "ask-start", message: "AskUserQuestion" }));
    reg.applyEvent(ev({ type: "ask-end", message: "AskUserQuestion" }));
    expect(reg.get("s1")!.phase).toBe("working");
    expect(reg.get("s1")!.approvalSource).toBeNull();
  });

  test("a GENUINE tool prompt is left alone by ask-end", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent(ev({ type: "prompt", prompt: "do a thing" }));
    // Question asked and answered first…
    reg.applyEvent(ev({ type: "ask-start", message: "AskUserQuestion" }));
    reg.applyEvent(ev({ type: "ask-end", message: "AskUserQuestion" }));
    // …then a real gate. A late duplicate ask-end must not retract it.
    reg.applyEvent(ev({ type: "notify-permission", message: "use Bash" }));
    reg.applyEvent(ev({ type: "ask-end", message: "AskUserQuestion" }));
    const s = reg.get("s1")!;
    expect(s.phase).toBe("waiting-approval");
    expect(s.approvalSource).toBe("tty");
    expect(canAutoApprove(s)).toBe(true);
  });

  test("an idle session falls back to idle, not working", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent(ev({ type: "ask-start", message: "ExitPlanMode" }));
    reg.applyEvent(ev({ type: "notify-permission" }));
    reg.applyEvent(ev({ type: "ask-end", message: "ExitPlanMode" }));
    expect(reg.get("s1")!.phase).toBe("idle");
  });
});
