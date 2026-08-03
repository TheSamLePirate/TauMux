/**
 * Registry persistence — the fix for "AGENT PLANS: No active agent plans"
 * on a live session after an app restart.
 *
 * The hook bridge reports transitions only, so tasks announced before a
 * restart were never re-announced: the plan panel stayed empty for the
 * rest of that session's life. These tests pin what survives a restart
 * and — just as important — what must NOT.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDebouncedPersister,
  loadInto,
  sanitizeForRestore,
} from "../src/bun/claude-registry-persistence";
import { ClaudeSessionRegistry } from "../src/bun/claude-session-registry";
import {
  newClaudeSessionState,
  type ClaudeBridgeEvent,
  type ClaudeSessionState,
} from "../src/shared/claude-types";

const T0 = 1_754_000_000_000;
const tmp = () => mkdtempSync(join(tmpdir(), "claude-persist-"));

function live(over: Partial<ClaudeSessionState> = {}): ClaudeSessionState {
  return {
    ...newClaudeSessionState("s1", T0),
    surfaceId: "surface:2",
    cwd: "/repo",
    sessionName: "Fix auth",
    turnCount: 4,
    costUsd: 0.42,
    tasks: [
      { id: "1", name: "Write tests", state: "completed", createdAt: T0 },
      { id: "2", name: "Ship it", state: "pending", createdAt: T0 },
    ],
    ...over,
  };
}

describe("sanitizeForRestore", () => {
  test("keeps the durable facts", () => {
    const r = sanitizeForRestore(live());
    expect(r.sessionId).toBe("s1");
    expect(r.surfaceId).toBe("surface:2");
    expect(r.cwd).toBe("/repo");
    expect(r.sessionName).toBe("Fix auth");
    expect(r.turnCount).toBe(4);
    expect(r.costUsd).toBe(0.42);
    expect(r.tasks).toHaveLength(2);
  });

  test("DROPS live state — a restarted app is not mid-turn", () => {
    const r = sanitizeForRestore(
      live({
        phase: "working",
        promptStartedAt: T0,
        subagents: [{ agentId: "a1", agentType: "Explore", startedAt: T0 }],
        approvalSource: "tty",
        approvalMessage: "Bash",
        errorType: "rate_limit",
        errorMessage: "429",
      }),
    );
    expect(r.phase).toBe("idle");
    expect(r.promptStartedAt).toBe(0);
    expect(r.subagents).toEqual([]);
    // Critical: a restored pending approval would make auto-approve think
    // a terminal prompt is on screen when there is none.
    expect(r.approvalSource).toBeNull();
    expect(r.approvalMessage).toBeNull();
    expect(r.errorType).toBeNull();
  });
});

describe("round trip", () => {
  test("tasks survive a simulated restart and reach the plan store", () => {
    const dir = tmp();
    const path = join(dir, "claude-sessions.json");

    // Session 1 — app run #1.
    const before = new ClaudeSessionRegistry(() => T0);
    const persist = createDebouncedPersister(path, before, 0);
    before.onChange(() => persist());
    const send = (p: Partial<ClaudeBridgeEvent>) =>
      before.applyEvent({
        sessionId: "s1",
        surfaceId: "surface:2",
        ...p,
      } as ClaudeBridgeEvent);
    send({ type: "prompt", prompt: "do the thing" });
    send({ type: "task-created", taskId: "1", taskName: "Write tests" });
    send({ type: "task-created", taskId: "2", taskName: "Ship it" });

    return new Promise<void>((done) => {
      setTimeout(() => {
        expect(existsSync(path)).toBe(true);

        // App run #2 — fresh registry, same file.
        const after = new ClaudeSessionRegistry(() => T0);
        expect(loadInto(path, after)).toBe(1);
        const s = after.get("s1")!;
        expect(s.tasks.map((t) => t.name)).toEqual(["Write tests", "Ship it"]);
        expect(s.surfaceId).toBe("surface:2");
        // …but the turn that was in flight is not resurrected.
        expect(s.phase).toBe("idle");
        done();
      }, 10);
    });
  });

  test("a session with no tasks is not written (nothing to lose)", () => {
    const dir = tmp();
    const path = join(dir, "s.json");
    const reg = new ClaudeSessionRegistry(() => T0);
    const persist = createDebouncedPersister(path, reg, 0);
    reg.onChange(() => persist());
    reg.applyEvent({
      type: "prompt",
      sessionId: "s1",
      surfaceId: "surface:1",
      prompt: "x",
    } as ClaudeBridgeEvent);
    return new Promise<void>((done) => {
      setTimeout(() => {
        const written = JSON.parse(readFileSync(path, "utf-8")) as {
          sessions: unknown[];
        };
        expect(written.sessions).toEqual([]);
        done();
      }, 10);
    });
  });

  test("corrupt / missing / wrong-format files load nothing, never throw", () => {
    const dir = tmp();
    const reg = new ClaudeSessionRegistry(() => T0);
    expect(loadInto(join(dir, "absent.json"), reg)).toBe(0);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(loadInto(bad, reg)).toBe(0);
    const future = join(dir, "future.json");
    writeFileSync(future, JSON.stringify({ format: 99, sessions: [live()] }));
    expect(loadInto(future, reg)).toBe(0);
  });

  test("ended sessions are not restored", () => {
    const dir = tmp();
    const p = join(dir, "s.json");
    writeFileSync(
      p,
      JSON.stringify({ format: 1, sessions: [live({ ended: true })] }),
    );
    const reg = new ClaudeSessionRegistry(() => T0);
    expect(loadInto(p, reg)).toBe(0);
  });

  test("restore never clobbers a session this process already heard from", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent({
      type: "prompt",
      sessionId: "s1",
      prompt: "fresh",
    } as ClaudeBridgeEvent);
    reg.restore(sanitizeForRestore(live({ sessionName: "stale" })));
    expect(reg.get("s1")!.sessionName).toBe("");
    expect(reg.get("s1")!.phase).toBe("working");
  });
});
