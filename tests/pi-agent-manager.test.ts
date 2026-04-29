// Lifecycle correctness tests for PiAgentManager. These exercise the
// manager wiring directly — without spawning a real `pi --mode rpc`
// subprocess — by assigning the private `_managerExit` callback that
// `createAgent` would normally wire.
//
// Triple-A G.1 — addresses L1 (dead instances leaking into the
// registry) and L10 (send() timeout never canceled, kill() not draining
// pending waiters).

import { describe, it, expect } from "bun:test";
import { PiAgentManager, PiAgentInstance } from "../src/bun/pi-agent-manager";

describe("PiAgentManager — manager-level exit hook", () => {
  it("evicts a dead instance via _managerExit when the per-instance onExit was overwritten", () => {
    const manager = new PiAgentManager();
    let exitedAgentId: string | null = null;
    manager.onExit = (id) => {
      exitedAgentId = id;
      manager.removeAgent(id);
    };

    const inst = manager.createAgent({});
    const id = inst.id;
    expect(manager.getAgent(id)).toBe(inst);

    // Simulate `index.ts:createAgentSurface` overwriting the public
    // `onExit` with its own webview-notification handler.
    let userOnExitCode: number | null = null;
    inst.onExit = (code) => {
      userOnExitCode = code;
    };

    // Fire the internal manager hook the way `proc.exited.then` would.
    // The point of the fix: the user's overwrite of `onExit` does NOT
    // disable manager-level eviction.
    expect(inst._managerExit).toBeTruthy();
    inst._managerExit?.(0);

    expect(exitedAgentId).toBe(id);
    expect(manager.getAgent(id)).toBeUndefined();

    // The user's overwritten onExit is independent and would still
    // fire from the same proc.exited.then path; we exercise it here
    // for completeness.
    inst.onExit?.(0);
    expect(userOnExitCode).toBe(0);
  });

  it("manager.dispose() drains all instances", () => {
    const manager = new PiAgentManager();
    const a = manager.createAgent({});
    const b = manager.createAgent({});
    expect(manager.agentCount).toBe(2);
    manager.dispose();
    expect(manager.agentCount).toBe(0);
    expect(manager.getAgent(a.id)).toBeUndefined();
    expect(manager.getAgent(b.id)).toBeUndefined();
  });

  it("isAgentSurface returns true for live instances and false after removeAgent", () => {
    const manager = new PiAgentManager();
    const inst = manager.createAgent({});
    expect(manager.isAgentSurface(inst.id)).toBe(true);
    manager.removeAgent(inst.id);
    expect(manager.isAgentSurface(inst.id)).toBe(false);
  });
});

describe("PiAgentInstance — kill() drains pending response waiters", () => {
  it("rejects all pending waiters synchronously and clears their timers", async () => {
    // We can't easily exercise send() without a live subprocess, but
    // we can poke at the private map to verify the kill() drain
    // semantics. A real proc would feed responses back into the map
    // via parseLine; our test just seeds one entry.
    const inst = new PiAgentInstance("test-agent", {});

    // Seed a fake waiter with a real setTimeout we expect kill() to
    // clear. If the timer is NOT cleared, the test runtime will hold
    // the event loop open for 30 s (Bun's test runner enforces a
    // default timeout, so a regression would surface as a timeout).
    let rejectedWith: Error | null = null;
    const waiter = {
      resolve: () => {
        /* unused */
      },
      reject: (err: Error) => {
        rejectedWith = err;
      },
      timer: setTimeout(() => {
        throw new Error("timer should have been cleared by kill()");
      }, 30_000),
    };
    // @ts-expect-error reach into private for test
    inst.responseWaiters.set("req_test", waiter);

    inst.kill();

    expect(rejectedWith).toBeInstanceOf(Error);
    expect((rejectedWith as Error | null)?.message).toContain("killed");
    // @ts-expect-error reach into private for test
    expect(inst.responseWaiters.size).toBe(0);
  });
});
