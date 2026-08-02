/**
 * WS3 — remote approvals. Locks:
 *   1. the pure permission helpers (modal formatting, decision JSON,
 *      ask-result mapping),
 *   2. the registry phase flow for permission-request / -resolved,
 *   3. the REAL bridge subprocess end-to-end against a fake `ht`:
 *      stdout must carry exactly the decision JSON (or nothing), and
 *      the fail-safe paths must print nothing and exit 0.
 */
import { describe, test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  formatPermissionAsk,
  buildPermissionDecision,
  decisionFromAskResult,
  PERMISSION_CHOICES,
} from "../claude-integration/ht-bridge/src/permission";
import { ClaudeSessionRegistry } from "../src/bun/claude-session-registry";
import type { ClaudeBridgeEvent } from "../src/shared/claude-types";

const BRIDGE = resolve(
  import.meta.dir,
  "..",
  "claude-integration",
  "ht-bridge",
  "src",
  "index.ts",
);
const FAKE_HT = resolve(import.meta.dir, "fixtures", "fake-ht-ask.ts");

const PAYLOAD = {
  session_id: "perm-1",
  transcript_path: "/t.jsonl",
  cwd: "/repo",
  permission_mode: "default",
  hook_event_name: "PermissionRequest",
  tool_name: "Bash",
  tool_input: { command: "rm -rf /tmp/build", description: "clean build dir" },
  tool_use_id: "toolu_01X",
};

describe("formatPermissionAsk", () => {
  test("Bash shows the exact command + description", () => {
    const ask = formatPermissionAsk(PAYLOAD)!;
    expect(ask.title).toBe("Claude Code · Bash");
    expect(ask.body).toContain("$ rm -rf /tmp/build");
    expect(ask.body).toContain("clean build dir");
    expect(ask.toolName).toBe("Bash");
  });

  test("file tools show the path; unknown tools show raw JSON", () => {
    const edit = formatPermissionAsk({
      tool_name: "Edit",
      tool_input: { file_path: "/repo/a.ts", old_string: "x" },
    })!;
    expect(edit.body).toContain("/repo/a.ts");
    const mcp = formatPermissionAsk({
      tool_name: "mcp__github__create_pr",
      tool_input: { title: "hi" },
    })!;
    expect(mcp.body).toContain('"title": "hi"');
  });

  test("non-default mode and rule are surfaced; no tool_name → null", () => {
    const ask = formatPermissionAsk({
      ...PAYLOAD,
      permission_mode: "plan",
      permission_rule: "Bash(rm *)",
    })!;
    expect(ask.body).toContain("mode: plan");
    expect(ask.body).toContain("rule: Bash(rm *)");
    expect(formatPermissionAsk({})).toBeNull();
  });

  test("body is capped", () => {
    const ask = formatPermissionAsk({
      tool_name: "Bash",
      tool_input: { command: "x".repeat(5000) },
    })!;
    expect(ask.body.length).toBeLessThanOrEqual(900);
  });
});

describe("decision plumbing", () => {
  test("decision JSON matches the documented schema exactly", () => {
    expect(JSON.parse(buildPermissionDecision("allow"))).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
    expect(
      (
        JSON.parse(buildPermissionDecision("deny")) as {
          hookSpecificOutput: { decision: { behavior: string } };
        }
      ).hookSpecificOutput.decision.behavior,
    ).toBe("deny");
  });

  test("only clean allow/deny answers produce decisions", () => {
    expect(decisionFromAskResult(0, "allow\n")).toBe("allow");
    expect(decisionFromAskResult(0, "deny")).toBe("deny");
    expect(decisionFromAskResult(0, "terminal")).toBeNull();
    expect(decisionFromAskResult(0, "")).toBeNull();
    expect(decisionFromAskResult(2, "allow")).toBeNull(); // timeout exit
    expect(decisionFromAskResult(null, "allow")).toBeNull();
  });

  test("choices include the terminal escape hatch", () => {
    expect(PERMISSION_CHOICES).toContain("allow:");
    expect(PERMISSION_CHOICES).toContain("deny:");
    expect(PERMISSION_CHOICES).toContain("terminal:");
  });
});

describe("registry phase flow", () => {
  const T0 = 1_754_000_000_000;
  const ev = (p: Partial<ClaudeBridgeEvent>): ClaudeBridgeEvent =>
    ({ sessionId: "s1", ...p }) as ClaudeBridgeEvent;

  test("request → waiting-approval with tool; resolve → back to working", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent(ev({ type: "prompt", prompt: "x" }));
    reg.applyEvent(ev({ type: "permission-request", message: "Bash" }));
    let s = reg.get("s1")!;
    expect(s.phase).toBe("waiting-approval");
    expect(s.approvalMessage).toBe("Bash");
    reg.applyEvent(ev({ type: "permission-resolved" }));
    s = reg.get("s1")!;
    expect(s.phase).toBe("working"); // turn still in flight
    expect(s.approvalMessage).toBeNull();
  });

  test("resolve outside a turn returns to idle", () => {
    const reg = new ClaudeSessionRegistry(() => T0);
    reg.applyEvent(ev({ type: "permission-request", message: "Bash" }));
    reg.applyEvent(ev({ type: "permission-resolved" }));
    expect(reg.get("s1")!.phase).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Bridge subprocess end-to-end against the fake `ht`.
// ---------------------------------------------------------------------------

interface BridgeRun {
  stdout: string;
  code: number | null;
  events: Array<Record<string, unknown>>;
}

async function runBridge(
  mode: string,
  surface = "surface:3",
): Promise<BridgeRun> {
  const dir = mkdtempSync(join(tmpdir(), "perm-test-"));
  const log = join(dir, "events.log");
  const env: Record<string, string | undefined> = {
    ...process.env,
    HT_CLAUDE_HT_BIN: FAKE_HT,
    FAKE_HT_MODE: mode,
    FAKE_HT_LOG: log,
    HT_CLAUDE_APPROVAL_TIMEOUT_MS: "3000",
    HT_SURFACE: surface,
  };
  // The test runner itself may live inside a τ-mux pane — an inherited
  // HT_SURFACE would defeat the "outside τ-mux" case.
  if (!surface) delete env["HT_SURFACE"];
  return await new Promise<BridgeRun>((res, rej) => {
    const child = spawn("bun", [BRIDGE, "permission-request"], {
      env,
      stdio: ["pipe", "pipe", "inherit"],
    });
    // The "hang" mode relies on the bridge's own watchdog (3 s + 5 s).
    const guard = setTimeout(() => {
      child.kill("SIGKILL");
      rej(new Error("bridge did not exit"));
    }, 15_000);
    let stdout = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.on("close", (code) => {
      clearTimeout(guard);
      const events = existsSync(log)
        ? readFileSync(log, "utf-8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l) as Record<string, unknown>)
        : [];
      res({ stdout, code, events });
    });
    child.stdin.write(JSON.stringify(PAYLOAD));
    child.stdin.end();
  });
}

describe("bridge subprocess (fake ht)", () => {
  test("allow: prints exactly the decision JSON + shadow events", async () => {
    const r = await runBridge("allow");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(
      JSON.parse(buildPermissionDecision("allow")),
    );
    expect(r.events.map((e) => e["type"])).toEqual([
      "permission-request",
      "permission-resolved",
    ]);
    expect(r.events[0]!["message"]).toBe("Bash");
    expect(r.events[0]!["surfaceId"]).toBe("surface:3");
  }, 20_000);

  test("deny: prints the deny decision", async () => {
    const r = await runBridge("deny");
    expect(r.code).toBe(0);
    expect(
      (
        JSON.parse(r.stdout) as {
          hookSpecificOutput: { decision: { behavior: string } };
        }
      ).hookSpecificOutput.decision.behavior,
    ).toBe("deny");
  }, 20_000);

  test("terminal choice: NO output, exit 0, no resolved event", async () => {
    const r = await runBridge("terminal");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.events.map((e) => e["type"])).toEqual(["permission-request"]);
  }, 20_000);

  test("ask timeout: NO output, exit 0", async () => {
    const r = await runBridge("timeout");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  }, 20_000);

  test("hung ht: watchdog kills it — NO output, exit 0", async () => {
    const r = await runBridge("hang");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  }, 20_000);

  test("outside τ-mux (no HT_SURFACE): pass-through, no spawn at all", async () => {
    const r = await runBridge("allow", "");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.events).toEqual([]);
  }, 20_000);

  test("approvals disabled: pass-through even with the hook wired", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-test-"));
    const log = join(dir, "events.log");
    const r = await new Promise<{ stdout: string; code: number | null }>(
      (res) => {
        const child = spawn("bun", [BRIDGE, "permission-request"], {
          env: {
            ...process.env,
            HT_CLAUDE_HT_BIN: FAKE_HT,
            FAKE_HT_MODE: "allow",
            FAKE_HT_LOG: log,
            HT_CLAUDE_APPROVALS: "0",
            HT_SURFACE: "surface:3",
          },
          stdio: ["pipe", "pipe", "inherit"],
        });
        let stdout = "";
        child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
        child.on("close", (code) => res({ stdout, code }));
        child.stdin.write(JSON.stringify(PAYLOAD));
        child.stdin.end();
      },
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(existsSync(log)).toBe(false);
  }, 20_000);
});
