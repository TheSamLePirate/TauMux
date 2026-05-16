// Triple-A G.2 / L2 — verify destroy() sends SIGHUP first and lets the
// child clean up before SIGKILL. Backfill from Phase 0 audit (PR 7).
//
// We spawn a real /bin/sh that traps SIGHUP and writes a marker line
// before exiting. If destroy() sent SIGKILL directly (the pre-fix
// behaviour), the trap handler wouldn't fire and the marker wouldn't
// appear. If destroy() sends SIGHUP first with a 500ms grace, the
// trap fires and we see the marker.

import { describe, expect, test } from "bun:test";
import { PtyManager } from "../src/bun/pty-manager";

async function waitFor(
  fn: () => boolean,
  timeout = 5000,
  interval = 25,
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await Bun.sleep(interval);
  }
}

describe("[L2] PtyManager destroy() sends SIGHUP before SIGKILL", () => {
  test("child SIGHUP trap fires before the process is killed", async () => {
    const pty = new PtyManager();
    let output = "";
    pty.onStdout = (data) => {
      output += data;
    };

    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    // Install a trap that prints a marker on SIGHUP. Use `sleep 30` to
    // hold the shell open so destroy()'s SIGHUP is what actually wakes it.
    pty.write(`trap 'echo HUP_TRAPPED_${process.pid}; exit 0' HUP\nsleep 30\n`);

    // Wait until the trap is installed and sleep is running.
    // (echo of the command + prompt is enough — give it 250ms.)
    await Bun.sleep(250);

    // Trigger the graceful path. destroy() returns immediately; the
    // SIGHUP delivery + child trap execution happens asynchronously.
    pty.destroy();

    // The child needs to run its trap (`echo …`) and flush stdout
    // before SIGKILL fires at the 500ms boundary. We give the watcher
    // 2s to see the marker — well inside the 500ms grace plus pipe
    // drain latency.
    await waitFor(() => output.includes("HUP_TRAPPED_"), 2000);
    expect(output).toContain("HUP_TRAPPED_");
  });

  // The SIGKILL-fallback path is intentionally not asserted via runtime
  // observation: destroy() sets `_destroyed` first, which short-circuits
  // trackExit() before it can flip `_exited`, so there's no exposed
  // signal that the escalation timer fired. The escalation itself is
  // a small `setTimeout(..., 500)` block in destroy(); we pin it via
  // source inspection instead — sufficient to catch a future refactor
  // that drops the fallback.
  test("destroy() schedules a SIGKILL escalation after SIGHUP", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(import.meta.dir, "..", "src", "bun", "pty-manager.ts"),
      "utf-8",
    );
    // Match the documented invariant: a SIGHUP (proc.kill(1)) followed
    // by a setTimeout that kills with SIGKILL (proc.kill(9)) at 500ms.
    expect(src).toMatch(/proc\.kill\(1\)[\s\S]{0,400}SIGHUP/);
    expect(src).toMatch(/setTimeout\([\s\S]*?proc\.kill\(9\)[\s\S]*?\}, 500\)/);
  });
});
