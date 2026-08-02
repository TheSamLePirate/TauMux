/**
 * ClaudeTeamWatcher — passive agent-teams observability (august-plan
 * M4 / WS6).
 *
 * Claude Code's experimental agent teams write their state to disk:
 *   ~/.claude/teams/{team}/config.json   (members + runtime state)
 *   ~/.claude/tasks/{team}/*.json        (shared task list)
 *
 * We only READ, on a slow poll (teams change on human timescales), and
 * mirror a summary into the sidebar via the same local-RPC pill path
 * the presenter uses. Schema-defensive by design: teams are
 * experimental upstream, so anything unparseable degrades to "team
 * active" rather than an error. If the dirs don't exist (feature off),
 * the watcher stays silent and costs one stat per tick.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TeamSnapshot {
  teamName: string;
  members: Array<{ name: string; agentType: string }>;
  taskCounts: { pending: number; inProgress: number; completed: number };
}

/** Parse one team dir. Returns null when config.json is absent or
 *  unreadable (mid-write races are normal — next tick catches up). */
export function readTeamSnapshot(
  teamsDir: string,
  tasksDir: string,
  teamName: string,
): TeamSnapshot | null {
  let members: TeamSnapshot["members"] = [];
  try {
    const raw = readFileSync(join(teamsDir, teamName, "config.json"), "utf-8");
    const cfg = JSON.parse(raw) as { members?: unknown };
    if (Array.isArray(cfg.members)) {
      members = (cfg.members as Array<Record<string, unknown>>)
        .filter((m) => typeof m["name"] === "string")
        .map((m) => ({
          name: m["name"] as string,
          agentType:
            typeof m["agentType"] === "string"
              ? (m["agentType"] as string)
              : typeof m["agent_type"] === "string"
                ? (m["agent_type"] as string)
                : "",
        }));
    }
  } catch {
    return null;
  }

  const taskCounts = { pending: 0, inProgress: 0, completed: 0 };
  try {
    for (const f of readdirSync(join(tasksDir, teamName))) {
      if (!f.endsWith(".json")) continue;
      try {
        const t = JSON.parse(
          readFileSync(join(tasksDir, teamName, f), "utf-8"),
        ) as { status?: unknown; state?: unknown };
        const status = String(t.status ?? t.state ?? "");
        if (status === "completed" || status === "done") {
          taskCounts.completed += 1;
        } else if (status === "in_progress" || status === "active") {
          taskCounts.inProgress += 1;
        } else {
          taskCounts.pending += 1;
        }
      } catch {
        /* half-written task file — count next tick */
      }
    }
  } catch {
    /* no task dir yet — zero counts are correct */
  }

  return { teamName, members, taskCounts };
}

/** Sidebar pill line for a team. */
export function teamPillLine(t: TeamSnapshot): string {
  const parts = [
    `${t.members.length} member${t.members.length === 1 ? "" : "s"}`,
  ];
  const { pending, inProgress, completed } = t.taskCounts;
  if (pending + inProgress + completed > 0) {
    parts.push(`${completed}/${pending + inProgress + completed} tasks`);
  }
  return parts.join(" · ");
}

export interface ClaudeTeamWatcherDeps {
  callRpc: (
    method: string,
    params: Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  teamsDir?: string;
  tasksDir?: string;
  intervalMs?: number;
}

const PILL_KEY = "team";
const PILL_ICON = "users";
const PILL_COLOR = "#94e2d5";

export class ClaudeTeamWatcher {
  private deps: Required<Pick<ClaudeTeamWatcherDeps, "callRpc">> &
    ClaudeTeamWatcherDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPill = "";

  constructor(deps: ClaudeTeamWatcherDeps) {
    this.deps = deps;
  }

  start(): void {
    const interval = this.deps.intervalMs ?? 5_000;
    this.timer = setInterval(() => this.tick(), interval);
    // No immediate tick: boot paths stay IO-free when teams are unused.
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One poll. Public for tests. */
  tick(): void {
    try {
      const teamsDir =
        this.deps.teamsDir ?? join(homedir(), ".claude", "teams");
      const tasksDir =
        this.deps.tasksDir ?? join(homedir(), ".claude", "tasks");
      if (!existsSync(teamsDir)) {
        this.clearIfShown();
        return;
      }
      let names: string[] = [];
      try {
        names = readdirSync(teamsDir).filter((n) => !n.startsWith("."));
      } catch {
        this.clearIfShown();
        return;
      }
      const snapshots = names
        .map((n) => readTeamSnapshot(teamsDir, tasksDir, n))
        .filter((s): s is TeamSnapshot => s !== null && s.members.length > 0);
      if (snapshots.length === 0) {
        this.clearIfShown();
        return;
      }
      // One pill: the most populous team (a session has exactly one team;
      // multiple = several live sessions — show the biggest, count rest).
      snapshots.sort((a, b) => b.members.length - a.members.length);
      const head = snapshots[0]!;
      let line = teamPillLine(head);
      if (snapshots.length > 1) line += ` (+${snapshots.length - 1} team)`;
      if (line === this.lastPill) return;
      this.lastPill = line;
      this.call("sidebar.set_status", {
        key: PILL_KEY,
        value: line,
        icon: PILL_ICON,
        color: PILL_COLOR,
      });
    } catch {
      /* watcher must never destabilize the host */
    }
  }

  private clearIfShown(): void {
    if (!this.lastPill) return;
    this.lastPill = "";
    this.call("sidebar.clear_status", { key: PILL_KEY });
  }

  private call(method: string, params: Record<string, unknown>): void {
    try {
      const r = this.deps.callRpc(method, params);
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* pill is best-effort */
    }
  }
}
