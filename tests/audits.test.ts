// Unit tests for the audits module. Uses a stub `GitRunner` so we
// never shell out to a real git, which keeps the suite hermetic and
// removes the test-runner's $HOME/git-config from the variables.

import { describe, expect, test } from "bun:test";
import {
  applyFix,
  defaultAudits,
  gitUserAudit,
  runAudits,
  type AuditResult,
  type GitRunner,
} from "../src/bun/audits";

function stubGit(returnsByCommand: Record<string, string>): {
  runner: GitRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: GitRunner = async (args) => {
    calls.push(args);
    const key = args.join(" ");
    if (key in returnsByCommand) return returnsByCommand[key]!;
    return "";
  };
  return { runner, calls };
}

describe("gitUserAudit", () => {
  test("ok when actual matches expected", async () => {
    const { runner } = stubGit({
      "config --global user.name": "olivierveinand",
    });
    const r = await gitUserAudit("olivierveinand", runner);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("info");
    expect(r.fix).toBeUndefined();
    expect(r.message).toContain("olivierveinand");
  });

  test("warn + fix when actual differs", async () => {
    const { runner } = stubGit({
      "config --global user.name": "someone-else",
    });
    const r = await gitUserAudit("olivierveinand", runner);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("warn");
    expect(r.fix).toBeDefined();
    expect(r.fix!.label).toContain("olivierveinand");
    expect(r.message).toContain("someone-else");
    expect(r.message).toContain('expected "olivierveinand"');
  });

  test("warn + fix when actual is empty (config unset)", async () => {
    const { runner } = stubGit({}); // returns "" by default
    const r = await gitUserAudit("olivierveinand", runner);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("warn");
    expect(r.message).toContain("(unset)");
    expect(r.fix).toBeDefined();
  });

  test("err when git invocation throws", async () => {
    const runner: GitRunner = async () => {
      throw new Error("git not found");
    };
    const r = await gitUserAudit("olivierveinand", runner);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("err");
    expect(r.message).toContain("git not found");
  });

  test("fix invokes git config with the expected value", async () => {
    const { runner, calls } = stubGit({
      "config --global user.name": "wrong",
    });
    const r = await gitUserAudit("olivierveinand", runner);
    expect(r.fix).toBeDefined();
    await r.fix!.action();
    expect(calls).toContainEqual([
      "config",
      "--global",
      "user.name",
      "olivierveinand",
    ]);
  });
});

describe("defaultAudits", () => {
  test("registers the git-user-name audit when expected is set", () => {
    const list = defaultAudits({ gitUserNameExpected: "olivierveinand" });
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe("git-user-name");
  });

  test("skips the audit when expected is null", () => {
    const list = defaultAudits({ gitUserNameExpected: null });
    expect(list.length).toBe(0);
  });

  test("threads the runGit hook through to the audit", async () => {
    const { runner, calls } = stubGit({
      "config --global user.name": "olivierveinand",
    });
    const list = defaultAudits({
      gitUserNameExpected: "olivierveinand",
      runGit: runner,
    });
    await list[0]!.check();
    expect(calls).toEqual([["config", "--global", "user.name"]]);
  });
});

describe("runAudits", () => {
  test("collects results from every audit in order", async () => {
    const { runner } = stubGit({
      "config --global user.name": "olivierveinand",
    });
    const audits = defaultAudits({
      gitUserNameExpected: "olivierveinand",
      runGit: runner,
    });
    const results = await runAudits(audits);
    expect(results.length).toBe(1);
    expect(results[0]!.ok).toBe(true);
  });

  test("a thrown audit becomes an err result without taking down the runner", async () => {
    const audits = [
      {
        id: "broken",
        description: "always throws",
        check: async () => {
          throw new Error("bang");
        },
      },
      {
        id: "fine",
        description: "always ok",
        check: async (): Promise<AuditResult> => ({
          id: "fine",
          ok: true,
          severity: "info" as const,
          message: "fine",
        }),
      },
    ];
    const results = await runAudits(audits);
    expect(results.length).toBe(2);
    expect(results[0]!.id).toBe("broken");
    expect(results[0]!.severity).toBe("err");
    expect(results[0]!.message).toContain("bang");
    expect(results[1]!.ok).toBe(true);
  });
});

describe("applyFix", () => {
  test("applies the fix and returns the post-fix audit result", async () => {
    let configValue = "wrong";
    const runner: GitRunner = async (args) => {
      if (
        args[0] === "config" &&
        args[1] === "--global" &&
        args[2] === "user.name"
      ) {
        if (args.length === 3) return configValue;
        configValue = args[3]!;
        return "";
      }
      return "";
    };
    const audits = defaultAudits({
      gitUserNameExpected: "olivierveinand",
      runGit: runner,
    });
    const before = await audits[0]!.check();
    expect(before.ok).toBe(false);
    const after = await applyFix(before, audits);
    expect(after.ok).toBe(true);
    expect(configValue).toBe("olivierveinand");
  });

  test("returns a no-op result when the audit has no fix", async () => {
    const noFix: AuditResult = {
      id: "x",
      ok: true,
      severity: "info",
      message: "all good",
    };
    const out = await applyFix(noFix, []);
    expect(out.message).toContain("no fix");
  });

  test("returns a warn when the fix lands but the audit is no longer in the registry", async () => {
    const result: AuditResult = {
      id: "ghost",
      ok: false,
      severity: "warn",
      message: "old",
      fix: {
        label: "noop",
        action: async () => {},
      },
    };
    const out = await applyFix(result, []);
    expect(out.severity).toBe("warn");
    expect(out.message).toContain("not in registry");
  });
});
