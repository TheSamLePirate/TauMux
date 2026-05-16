// Phase 6 / L1 — forced-crash regression test for PiAgentManager.
//
// Phase 0 PR 2 wired `_managerExit` so the manager evicts dead
// instances even when the user code overwrote the public `onExit`
// field. The Phase 0 unit test asserts the hook field exists and
// can be fired; it doesn't drive a real subprocess crash through the
// `proc.exited.then` promise chain.
//
// This test spawns a "fake pi" — a tiny shell script that ignores
// its CLI arguments and exits with a non-zero code after a brief
// delay. The PiAgentInstance.start() path takes the real Bun.spawn
// hot path, the OS reaps the child, `proc.exited` resolves, and the
// internal `_managerExit` callback fires. We observe the manager's
// `onExit` (which is what `index.ts:createAgentSurface` wires up to
// call `removeAgent`) and assert the registry is drained.
//
// Reverting `_managerExit` (e.g. removing the line `inst._managerExit
// = …` from `createAgent`) makes this test fail loudly — the manager's
// `onExit` never fires, the agent stays in the registry, and the
// `await waitFor(…)` block times out.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAgentManager } from "../src/bun/pi-agent-manager";

let tmpdirPath: string;
let fakePi: string;
let savedShell: string | undefined;

beforeAll(() => {
  tmpdirPath = mkdtempSync(join(tmpdir(), "pi-agent-crash-"));
  fakePi = join(tmpdirPath, "fake-pi.sh");
  // Ignore every CLI argument the manager passes (--mode rpc
  // --no-session …); just exit non-zero immediately. The 50 ms
  // sleep keeps the proc alive long enough for `start()` to wire
  // `proc.exited.then` before the OS reaps it.
  writeFileSync(fakePi, "#!/bin/sh\nsleep 0.05\nexit 7\n", { mode: 0o755 });
  chmodSync(fakePi, 0o755);

  // PiAgentInstance.start() runs `Bun.spawnSync([SHELL, "-ilc",
  // "echo $PATH"])` to resolve the user's login-shell PATH. Under
  // bun:test without a TTY, an interactive shell can stall for many
  // seconds before bailing. Point SHELL at `/bin/echo` so the probe
  // returns immediately with empty stdout — the manager falls back
  // to `process.env.PATH` which is fine for our fake pi binary.
  savedShell = process.env["SHELL"];
  process.env["SHELL"] = "/bin/echo";
});

afterAll(() => {
  if (savedShell === undefined) delete process.env["SHELL"];
  else process.env["SHELL"] = savedShell;
  try {
    rmSync(tmpdirPath, { recursive: true, force: true });
  } catch {
    /* swallow */
  }
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitFor: predicate did not become true within ${timeoutMs}ms`,
      );
    }
    await Bun.sleep(intervalMs);
  }
}

describe("[L1] PiAgentManager — forced-crash regression", () => {
  test("a subprocess that exits non-zero fires _managerExit and evicts the instance", async () => {
    const manager = new PiAgentManager();

    let exitedId: string | null = null;
    let exitedCode: number | null = null;
    manager.onExit = (id, code) => {
      exitedId = id;
      exitedCode = code;
      // index.ts:createAgentSurface wires removeAgent + the
      // surfaceCrashed RPC here. We exercise removeAgent so the
      // post-crash invariant (registry drained) is observable.
      manager.removeAgent(id);
    };

    const inst = manager.createAgent({ piBinary: fakePi });
    const id = inst.id;
    expect(manager.getAgent(id)).toBe(inst);

    // Run the real start() path against the fake pi. Spawn happens,
    // proc.exited.then wires up the exit handler. We don't await
    // start() — it resolves only when the 500 ms ready-window
    // elapses, and we want to observe the crash that happens BEFORE
    // that window. Fire-and-forget; the `proc.exited.then` chain
    // runs independently.
    inst.start().catch(() => {
      /* start() may reject if spawn fails — we observe via onExit. */
    });

    // The child exits ~50 ms after spawn; give the promise chain a
    // generous window (CI noise + process reap latency).
    await waitFor(() => exitedId !== null, 5_000);

    expect(exitedId).toBe(id);
    // Non-zero exit codes vary slightly across signals vs explicit
    // exit; we only assert that we got a non-zero code, not the
    // exact value.
    expect(exitedCode).not.toBeNull();
    expect(exitedCode).not.toBe(0);

    // The instance has been evicted from the registry.
    expect(manager.getAgent(id)).toBeUndefined();
    expect(manager.isAgentSurface(id)).toBe(false);
  });

  test("the dead instance is marked dead after the subprocess exits", async () => {
    const manager = new PiAgentManager();
    manager.onExit = (id) => manager.removeAgent(id);
    const inst = manager.createAgent({ piBinary: fakePi });
    const id = inst.id;
    inst.start().catch(() => {
      /* may reject; observed via the dead flag below. */
    });
    // Wait until the manager has evicted the dead instance.
    await waitFor(() => manager.getAgent(id) === undefined, 5_000);
    // `proc.exited.then` sets `dead = true` before firing
    // _managerExit, so once eviction has happened the dead flag is
    // observable on the (now dropped from registry) instance.
    expect(inst.dead).toBe(true);
  });
});
