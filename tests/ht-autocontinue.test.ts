// Plan #09 commit C — `ht autocontinue` CLI smoke tests.
//
// Mirrors `bin-ht-help.test.ts` — point at a sentinel socket path so
// the CLI can't reach a real running app, then assert on the parser
// + help output. The actual RPC dispatch is covered by the handler
// unit tests; this guards the CLI surface.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const HT_BIN = join(__dirname, "..", "bin", "ht");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runHt(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", HT_BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HT_SOCKET_PATH: "/tmp/ht-autocontinue-test-no-socket.sock",
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? -1 };
}

describe("bin/ht autocontinue", () => {
  test("--help documents the autocontinue family", async () => {
    const r = await runHt(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Auto-continue (Plan #09):");
    expect(r.stdout).toContain("autocontinue status");
    expect(r.stdout).toContain("autocontinue audit");
    expect(r.stdout).toContain("autocontinue set --engine");
    expect(r.stdout).toContain("autocontinue fire");
    expect(r.stdout).toContain("autocontinue pause");
    expect(r.stdout).toContain("autocontinue resume");
  });

  test("unknown subcommand prints supported list and exits non-zero", async () => {
    const r = await runHt(["autocontinue", "wat"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("Unknown autocontinue subcommand: wat");
    expect(r.stderr).toContain(
      "Supported: status | audit | set | fire | pause | resume",
    );
  });

  test("set without flags prints a hint and exits non-zero", async () => {
    const r = await runHt(["autocontinue", "set"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("--engine");
    expect(r.stderr).toContain("--dry-run");
  });

  test("fire without surface arg prints a hint and exits non-zero", async () => {
    const r = await runHt(["autocontinue", "fire"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("<surface> positional is required");
  });

  test("pause without surface arg prints a hint and exits non-zero", async () => {
    const r = await runHt(["autocontinue", "pause"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("<surface> positional is required");
  });

  test("resume without surface arg prints a hint and exits non-zero", async () => {
    const r = await runHt(["autocontinue", "resume"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("<surface> positional is required");
  });

  test("status against unreachable socket fails cleanly (no socket panic)", async () => {
    const r = await runHt(["autocontinue", "status"]);
    // Either the CLI exits non-zero with a connection error (offline),
    // or the harness somehow has a socket up — both are acceptable as
    // long as the CLI doesn't crash with a parse error.
    expect(r.stderr + r.stdout).not.toContain("SyntaxError");
    expect(r.stderr + r.stdout).not.toContain("Unhandled");
  });
});
