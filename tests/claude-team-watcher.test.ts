/**
 * M4 / WS6 — agent-teams watcher against fixture dirs.
 */
import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClaudeTeamWatcher,
  readTeamSnapshot,
  teamPillLine,
} from "../src/bun/claude-team-watcher";

function makeTeamDirs(): { teamsDir: string; tasksDir: string } {
  const root = mkdtempSync(join(tmpdir(), "claude-teams-"));
  const teamsDir = join(root, "teams");
  const tasksDir = join(root, "tasks");
  mkdirSync(teamsDir, { recursive: true });
  mkdirSync(tasksDir, { recursive: true });
  return { teamsDir, tasksDir };
}

function writeTeam(
  teamsDir: string,
  name: string,
  members: Array<Record<string, unknown>>,
): void {
  mkdirSync(join(teamsDir, name), { recursive: true });
  writeFileSync(
    join(teamsDir, name, "config.json"),
    JSON.stringify({ members }),
  );
}

describe("readTeamSnapshot", () => {
  test("parses members + task counts", () => {
    const { teamsDir, tasksDir } = makeTeamDirs();
    writeTeam(teamsDir, "session-abc12345", [
      { name: "team-lead", agentType: "team-lead" },
      { name: "researcher", agentType: "Explore" },
    ]);
    mkdirSync(join(tasksDir, "session-abc12345"), { recursive: true });
    writeFileSync(
      join(tasksDir, "session-abc12345", "1.json"),
      JSON.stringify({ status: "completed" }),
    );
    writeFileSync(
      join(tasksDir, "session-abc12345", "2.json"),
      JSON.stringify({ status: "in_progress" }),
    );
    writeFileSync(
      join(tasksDir, "session-abc12345", "3.json"),
      JSON.stringify({ status: "pending" }),
    );
    const s = readTeamSnapshot(teamsDir, tasksDir, "session-abc12345")!;
    expect(s.members.map((m) => m.name)).toEqual(["team-lead", "researcher"]);
    expect(s.taskCounts).toEqual({ pending: 1, inProgress: 1, completed: 1 });
    expect(teamPillLine(s)).toBe("2 members · 1/3 tasks");
  });

  test("garbage config → null; garbage task files are skipped", () => {
    const { teamsDir, tasksDir } = makeTeamDirs();
    mkdirSync(join(teamsDir, "broken"), { recursive: true });
    writeFileSync(join(teamsDir, "broken", "config.json"), "{ nope");
    expect(readTeamSnapshot(teamsDir, tasksDir, "broken")).toBeNull();
    expect(readTeamSnapshot(teamsDir, tasksDir, "absent")).toBeNull();
  });
});

describe("ClaudeTeamWatcher", () => {
  function setup(dirs: { teamsDir: string; tasksDir: string }) {
    const calls: Array<{ method: string; params: Record<string, unknown> }> =
      [];
    const w = new ClaudeTeamWatcher({
      callRpc: (method, params) => {
        calls.push({ method, params });
        return "OK";
      },
      ...dirs,
      intervalMs: 60_000,
    });
    return { w, calls };
  }

  test("no teams dir → silent; team appears → pill; disappears → clear", () => {
    const { teamsDir, tasksDir } = makeTeamDirs();
    const { w, calls } = setup({ teamsDir: join(teamsDir, "nope"), tasksDir });
    w.tick();
    expect(calls).toEqual([]);

    const live = setup({ teamsDir, tasksDir });
    writeTeam(teamsDir, "session-x", [{ name: "lead" }, { name: "worker" }]);
    live.w.tick();
    expect(live.calls).toHaveLength(1);
    expect(live.calls[0]!.method).toBe("sidebar.set_status");
    expect(live.calls[0]!.params["value"]).toBe("2 members");
    // Unchanged tick → no re-dispatch.
    live.w.tick();
    expect(live.calls).toHaveLength(1);
    // Team gone → clear once.
    rmSync(join(teamsDir, "session-x"), { recursive: true });
    live.w.tick();
    expect(live.calls[1]!.method).toBe("sidebar.clear_status");
    live.w.tick();
    expect(live.calls).toHaveLength(2);
  });

  test("multiple teams → biggest shown with a (+N team) suffix", () => {
    const { teamsDir, tasksDir } = makeTeamDirs();
    const { w, calls } = setup({ teamsDir, tasksDir });
    writeTeam(teamsDir, "session-a", [{ name: "l" }]);
    writeTeam(teamsDir, "session-b", [
      { name: "l" },
      { name: "w1" },
      { name: "w2" },
    ]);
    w.tick();
    expect(String(calls[0]!.params["value"])).toContain("3 members");
    expect(String(calls[0]!.params["value"])).toContain("(+1 team)");
  });

  test("a throwing dispatcher never propagates", () => {
    const { teamsDir, tasksDir } = makeTeamDirs();
    writeTeam(teamsDir, "session-x", [{ name: "lead" }]);
    const w = new ClaudeTeamWatcher({
      callRpc: () => {
        throw new Error("down");
      },
      teamsDir,
      tasksDir,
    });
    expect(() => w.tick()).not.toThrow();
  });
});
