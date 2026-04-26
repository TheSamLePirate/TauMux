// Snapshot guard for `ht --help` output. The CLI used to leak two
// stray `console.log` debug prints right after the help text (the
// resolved socket path + raw `HT_SOCKET_PATH` env var). Keeping a
// regression test here means the next time someone wires diagnostic
// prints into the help path, CI stops them before they ship.

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
    // Force the CLI off the host's real socket so doctor / probes can't
    // accidentally hit a running app and pollute stdout.
    env: { ...process.env, HT_SOCKET_PATH: "/tmp/ht-help-test-no-socket.sock" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? -1 };
}

describe("bin/ht --help", () => {
  test("exits 0 and prints the help banner", async () => {
    const r = await runHt(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ht — HyperTerm Canvas CLI");
    expect(r.stdout).toContain("Usage: ht <command>");
  });

  test("no debug prints leak after the help banner", async () => {
    const r = await runHt(["--help"]);
    // Old bug: the path constant + the env var were echoed at the end.
    // Either appearing twice (once in the env section, once as a
    // standalone line) flags the regression.
    const lines = r.stdout.trimEnd().split("\n");
    const last = lines[lines.length - 1];
    expect(last).toBe("Add --json to any command for raw JSON output.");

    // Defensive: the literal socket path must not appear as a bare
    // standalone line outside the documented "Environment" section.
    const sockMatches = lines.filter((l) => l.trim() === "/tmp/hyperterm.sock");
    expect(sockMatches.length).toBe(0);
  });

  test("documents the new doctor + logs subcommands", async () => {
    const r = await runHt(["--help"]);
    expect(r.stdout).toContain("doctor");
    expect(r.stdout).toContain("logs");
  });
});

describe("bin/ht doctor (offline)", () => {
  test("reports the configured socket path even when unreachable", async () => {
    const r = await runHt(["doctor"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("socket_path:");
    expect(r.stdout).toContain("/tmp/ht-help-test-no-socket.sock");
    expect(r.stdout).toContain("socket_reachable:   no");
    expect(r.stdout).toContain("bun_version:");
  });
});
