// Atlas snapshot builder — where four independent sources become one tree.
//
// The behaviours worth pinning down are the judgement calls, not the
// plumbing:
//
//  - a Claude session bound to a pane folds INTO that pane (one thing,
//    one marker); an unbound one gets a marker of its own off the root;
//  - a workspace-level notification marks the WORKSPACE, not every pane
//    inside it (v1 ringed all of them, which made the graph shout);
//  - aggregate CPU is scaled against a multi-core ceiling, so one busy
//    process doesn't paint the root ring red;
//  - "Approve" is offered only for a prompt that a keystroke can
//    actually answer.

import { beforeEach, describe, expect, test } from "bun:test";
import {
  newClaudeSessionState,
  type ClaudeSessionState,
} from "../src/shared/claude-types";
import {
  resetClaudeSessions,
  setClaudeSessions,
} from "../src/views/terminal/claude-session-store";
import { resetPlans, setPlans } from "../src/views/terminal/plan-store";
import {
  resetAtlasAnnotations,
  setAtlasAnnotations,
} from "../src/views/terminal/atlas-annotation-store";
import { resetMetrics } from "../src/views/terminal/metrics-history";
import { resetThroughput } from "../src/views/terminal/throughput-meter";
import {
  ATLAS_ROOT_ID,
  buildAtlasSnapshot,
  type AtlasEmitters,
  type AtlasHost,
} from "../src/views/terminal/atlas/snapshot";
import type { ProcessNode, SurfaceMetadata } from "../src/shared/types";

const NOW = 1_700_000_000_000;

function proc(
  pid: number,
  command: string,
  cpu = 0,
  rssKb = 4096,
): ProcessNode {
  return { pid, ppid: 1, command, cpu, rssKb };
}

function meta(over: Partial<SurfaceMetadata> = {}): SurfaceMetadata {
  return {
    pid: 100,
    foregroundPid: 100,
    cwd: "/repo",
    tree: [proc(100, "/bin/zsh")],
    listeningPorts: [],
    git: null,
    packageJson: null,
    cargoToml: null,
    updatedAt: NOW,
    ...over,
  };
}

const calls: string[] = [];
const emit: AtlasEmitters = {
  closeSurface: (id) => calls.push(`close:${id}`),
  approveClaude: (id) => calls.push(`approve:${id}`),
  interruptClaude: (id) => calls.push(`interrupt:${id}`),
  showSurfaceInfo: (id) => calls.push(`info:${id}`),
  openExternal: (url) => calls.push(`open:${url}`),
};

interface HostSpec {
  metadata?: Record<string, SurfaceMetadata>;
  surfaceTypes?: Record<string, "terminal" | "claude" | "browser">;
  statuses?: Map<
    string,
    { key: string; value: string; icon?: string; color?: string }[]
  >;
  progress?: Map<string, { value: number; label?: string }>;
}

function host(spec: HostSpec = {}): AtlasHost & { focused: string[] } {
  const focused: string[] = [];
  return {
    focused,
    getWorkspaceState: () => ({
      workspaces: [
        {
          id: "ws-1",
          name: "repo",
          color: "#6fe9ff",
          surfaceIds: ["s1", "s2"],
          surfaceTitles: { s1: "zsh", s2: "claude" },
          ...(spec.surfaceTypes ? { surfaceTypes: spec.surfaceTypes } : {}),
        },
        { id: "ws-2", name: "docs", surfaceIds: [] },
      ],
      activeWorkspaceId: "ws-1",
    }),
    getProcessManagerData: () => [
      {
        id: "ws-1",
        surfaces: [
          { id: "s1", title: "zsh", metadata: spec.metadata?.["s1"] ?? null },
          {
            id: "s2",
            title: "claude",
            metadata: spec.metadata?.["s2"] ?? null,
          },
        ],
      },
      { id: "ws-2", surfaces: [] },
    ],
    ...(spec.statuses ? { getAllStatuses: () => spec.statuses! } : {}),
    ...(spec.progress ? { getAllProgress: () => spec.progress! } : {}),
    focusWorkspaceByIndex: (i) => focused.push(`ws:${i}`),
    focusSurface: (id) => focused.push(`surface:${id}`),
  };
}

function build(opts: {
  host?: AtlasHost | null;
  focusedSurfaceId?: string | null;
  notify?: string[];
  deep?: boolean;
  questions?: { surface_id: string; title: string; body?: string }[];
}) {
  return buildAtlasSnapshot({
    host: opts.host === undefined ? host() : opts.host,
    focusedSurfaceId: opts.focusedSurfaceId ?? null,
    notifyWorkspaces: new Set(opts.notify ?? []),
    deep: opts.deep ?? false,
    pendingQuestions: (opts.questions ?? []) as never,
    now: () => NOW,
    emit,
  });
}

function session(over: Partial<ClaudeSessionState> = {}): ClaudeSessionState {
  return { ...newClaudeSessionState("sess", NOW - 60_000), ...over };
}

describe("buildAtlasSnapshot", () => {
  beforeEach(() => {
    resetClaudeSessions();
    resetThroughput();
    resetPlans();
    resetMetrics();
    resetAtlasAnnotations();
    calls.length = 0;
  });

  test("builds a root → workspace → surface spine", () => {
    const snap = build({});
    expect(snap.roots).toEqual([ATLAS_ROOT_ID]);
    const root = snap.nodes.get(ATLAS_ROOT_ID)!;
    expect(root.children).toEqual(["ws-1", "ws-2"]);
    expect(snap.nodes.get("ws-1")!.children).toEqual(["s1", "s2"]);
    expect(snap.totals.workspaces).toBe(2);
    expect(snap.totals.surfaces).toBe(2);
  });

  test("survives a host that isn't there yet", () => {
    const snap = build({ host: null });
    expect(snap.nodes.size).toBe(1);
    expect(snap.nodes.get(ATLAS_ROOT_ID)!.children).toEqual([]);
  });

  test("the active workspace and focused pane are marked active", () => {
    const snap = build({ focusedSurfaceId: "s2" });
    expect(snap.nodes.get("ws-1")!.active).toBe(true);
    expect(snap.nodes.get("ws-2")!.active).toBe(false);
    expect(snap.nodes.get("s2")!.active).toBe(true);
    expect(snap.nodes.get("s1")!.active).toBe(false);
  });

  test("activating a node routes through the host", () => {
    const h = host();
    const snap = buildAtlasSnapshot({
      host: h,
      focusedSurfaceId: null,
      notifyWorkspaces: new Set(),
      deep: false,
      now: () => NOW,
      emit,
    });
    snap.nodes.get("ws-2")!.activate!();
    snap.nodes.get("s1")!.activate!();
    expect(h.focused).toEqual(["ws:1", "surface:s1"]);
  });

  // ── Claude sessions ────────────────────────────────────────────────

  test("a bound session folds into its pane rather than adding a node", () => {
    setClaudeSessions([
      session({
        surfaceId: "s2",
        phase: "working",
        modelDisplayName: "Claude Sonnet 4.5",
        contextUsedPct: 62,
        costUsd: 0.5,
      }),
    ]);
    const snap = build({});
    expect(snap.nodes.has("session:sess")).toBe(false);
    const pane = snap.nodes.get("s2")!;
    expect(pane.kind).toBe("surface");
    expect(pane.tone).toBe("agent");
    expect(pane.running).toBe(true);
    expect(pane.sublabel).toBe("working · sonnet 4.5");
    expect(pane.meter?.value).toBeCloseTo(0.62, 5);
    expect(pane.badges.map((b) => b.text)).toEqual(["62% ctx", "$0.50"]);
    expect(snap.totals.agents).toBe(1);
    expect(snap.totals.costUsd).toBeCloseTo(0.5, 5);
  });

  test("a session with no live pane hangs off the root", () => {
    setClaudeSessions([
      session({ surfaceId: null, sessionName: "Audit docs", costUsd: 0.2 }),
    ]);
    const snap = build({});
    const node = snap.nodes.get("session:sess")!;
    expect(node.kind).toBe("session");
    expect(node.label).toBe("Audit docs");
    expect(node.badges.some((b) => b.text === "detached")).toBe(true);
    expect(snap.nodes.get(ATLAS_ROOT_ID)!.children).toContain("session:sess");
  });

  test("a session pointing at a closed pane is still shown", () => {
    setClaudeSessions([session({ surfaceId: "gone" })]);
    const snap = build({});
    expect(snap.nodes.has("session:sess")).toBe(true);
  });

  test.each([
    ["waiting-approval", "approval"],
    ["waiting-input", "input"],
    ["error", "error"],
    ["working", null],
    ["idle", null],
  ] as const)("phase %s maps to attention %s", (phase, attention) => {
    setClaudeSessions([session({ surfaceId: "s2", phase })]);
    expect(build({}).nodes.get("s2")!.attention).toBe(attention);
  });

  test("a question to the human outranks a plain approval prompt", () => {
    setClaudeSessions([
      session({
        surfaceId: "s2",
        phase: "waiting-approval",
        awaitingUserChoice: "AskUserQuestion",
      }),
    ]);
    expect(build({}).nodes.get("s2")!.attention).toBe("question");
  });

  test("Approve is offered only for a prompt a keystroke can answer", () => {
    const cases: [Partial<ClaudeSessionState>, boolean][] = [
      [{ phase: "waiting-approval", approvalSource: "tty" }, true],
      [{ phase: "waiting-approval", approvalSource: "modal" }, false],
      [
        {
          phase: "waiting-approval",
          approvalSource: "tty",
          approvalIsQuestion: true,
        },
        false,
      ],
      [{ phase: "working" }, false],
    ];
    for (const [over, expected] of cases) {
      resetClaudeSessions();
      setClaudeSessions([session({ surfaceId: "s2", ...over })]);
      const actions = build({})
        .nodes.get("s2")!
        .actions.map((a) => a.id);
      expect(actions.includes("approve")).toBe(expected);
    }
  });

  test("Interrupt is offered mid-turn and routes to the pane", () => {
    setClaudeSessions([session({ surfaceId: "s2", phase: "working" })]);
    const action = build({})
      .nodes.get("s2")!
      .actions.find((a) => a.id === "interrupt")!;
    action.run();
    expect(calls).toContain("interrupt:s2");
  });

  test("rate limits and tasks reach the inspector rows", () => {
    setClaudeSessions([
      session({
        surfaceId: "s2",
        phase: "working",
        rateLimits: {
          fiveHourPct: 63,
          fiveHourResetsAt: null,
          sevenDayPct: 12,
          sevenDayResetsAt: null,
        },
        tasks: [
          { id: "a", name: "one", state: "completed", createdAt: NOW },
          { id: "b", name: "two", state: "pending", createdAt: NOW },
        ],
        subagents: [{ agentId: "x", agentType: "explore", startedAt: NOW }],
      }),
    ]);
    const labels = build({})
      .nodes.get("s2")!
      .detail.map((r) => r.label);
    expect(labels).toContain("5h limit");
    expect(labels).toContain("7d limit");
    expect(labels).toContain("tasks");
    expect(labels).toContain("subagents");
  });

  // ── notifications ──────────────────────────────────────────────────

  test("a workspace notification marks the workspace, not its panes", () => {
    const snap = build({ notify: ["ws-2"] });
    expect(snap.nodes.get("ws-2")!.attention).toBe("notify");
    expect(snap.nodes.get("s1")!.attention).toBeNull();
    expect(snap.nodes.get("s2")!.attention).toBeNull();
    expect(snap.totals.attention).toBe(1);
  });

  test("the active workspace does not flag its own notification", () => {
    // You are already looking at it.
    expect(build({ notify: ["ws-1"] }).nodes.get("ws-1")!.attention).toBeNull();
  });

  // ── telemetry → badges ─────────────────────────────────────────────

  test("a listening port becomes a badge and an Open action", () => {
    const snap = build({
      host: host({
        metadata: {
          s1: meta({
            listeningPorts: [
              { pid: 100, port: 8080, proto: "tcp", address: "*" },
              { pid: 100, port: 3000, proto: "tcp", address: "*" },
            ],
          }),
        },
      }),
    });
    const pane = snap.nodes.get("s1")!;
    // Lowest port wins — the dev server's own, not an ephemeral socket.
    expect(pane.badges.some((b) => b.text === ":3000")).toBe(true);
    pane.actions.find((a) => a.id === "open")!.run();
    expect(calls).toContain("open:http://localhost:3000");
  });

  test("build progress wins the badge slot over CPU and reads distinctly", () => {
    const snap = build({
      host: host({
        metadata: {
          s1: meta({
            tree: [proc(100, "/bin/zsh", 90)],
            progress: { state: "normal", value: 62 },
          }),
        },
      }),
    });
    const texts = snap.nodes.get("s1")!.badges.map((b) => b.text);
    expect(texts).toContain("▰ 62%");
    expect(texts).not.toContain("90%");
  });

  test("a quiet pane carries no CPU badge; a hot one does", () => {
    const quiet = build({
      host: host({
        metadata: { s1: meta({ tree: [proc(100, "/bin/zsh", 9)] }) },
      }),
    });
    expect(quiet.nodes.get("s1")!.badges).toHaveLength(0);
    const hot = build({
      host: host({ metadata: { s1: meta({ tree: [proc(100, "bun", 71)] }) } }),
    });
    expect(hot.nodes.get("s1")!.badges.map((b) => b.text)).toContain("71%");
  });

  test("aggregate CPU is scaled against a multi-core ceiling", () => {
    const snap = build({
      host: host({ metadata: { s1: meta({ tree: [proc(100, "bun", 120)] }) } }),
    });
    // 120 % of one core is a busy pane…
    expect(snap.nodes.get("s1")!.load).toBe(1);
    // …but not a saturated machine.
    expect(snap.nodes.get("ws-1")!.load).toBeCloseTo(0.3, 5);
    const cpuBadge = snap.nodes.get("ws-1")!.badges[0]!;
    expect(cpuBadge.text).toBe("120%");
    expect(cpuBadge.tone).toBe("ok");
  });

  test("git state reaches the workspace badge with its divergence marks", () => {
    const snap = build({
      host: host({
        metadata: {
          s1: meta({
            git: {
              branch: "feat/atlas",
              head: "abc",
              upstream: "origin/feat/atlas",
              ahead: 2,
              behind: 0,
              staged: 0,
              unstaged: 3,
              untracked: 0,
              conflicts: 0,
              insertions: 10,
              deletions: 2,
              detached: false,
            },
          }),
        },
      }),
    });
    const badge = snap.nodes.get("ws-1")!.badges[0]!;
    // The branch truncates; the divergence marks never do — they are
    // the part that actually changes.
    expect(badge.text).toBe("feat/…↑2*");
    expect(badge.tone).toBe("warn");
  });

  test("a shell at its own prompt reports its cwd, not its own name", () => {
    const snap = build({
      host: host({ metadata: { s1: meta({ cwd: "/Users/dev/repo" }) } }),
    });
    expect(snap.nodes.get("s1")!.sublabel).toBe("dev/repo");
  });

  test("a sublabel that repeats the title is dropped", () => {
    const snap = build({
      host: host({
        metadata: {
          s1: meta({
            foregroundPid: 200,
            tree: [proc(100, "/bin/zsh"), proc(200, "/usr/bin/zsh")],
          }),
        },
      }),
    });
    expect(snap.nodes.get("s1")!.sublabel).toBe("");
  });

  // ── deep mode ──────────────────────────────────────────────────────

  test("deep mode adds processes, ports and mirrored tasks", () => {
    setClaudeSessions([
      session({
        surfaceId: "s2",
        tasks: [
          { id: "t1", name: "Ship it", state: "pending", createdAt: NOW },
        ],
      }),
    ]);
    const snap = build({
      deep: true,
      host: host({
        metadata: {
          s1: meta({
            tree: [proc(100, "/bin/zsh"), proc(200, "bun test", 40)],
            listeningPorts: [
              { pid: 200, port: 3000, proto: "tcp", address: "*" },
            ],
          }),
        },
      }),
    });
    expect(snap.nodes.get("s1")!.children).toEqual([
      "s1:pid:200",
      "s1:port:3000",
    ]);
    expect(snap.nodes.get("s1:pid:200")!.kind).toBe("process");
    expect(snap.nodes.get("s1:port:3000")!.kind).toBe("port");
    expect(snap.nodes.get("s2")!.children).toContain("s2:task:t1");
    expect(snap.nodes.get("s2:task:t1")!.kind).toBe("task");
  });

  test("column mode keeps panes as leaves", () => {
    const snap = build({
      host: host({
        metadata: {
          s1: meta({ tree: [proc(100, "/bin/zsh"), proc(200, "bun", 40)] }),
        },
      }),
    });
    expect(snap.nodes.get("s1")!.children).toEqual([]);
  });

  // ── filter tags ────────────────────────────────────────────────────

  test("tags describe what the header filters can find", () => {
    setClaudeSessions([
      session({ surfaceId: "s2", phase: "waiting-approval" }),
    ]);
    const snap = build({});
    expect(snap.nodes.get("s2")!.tags).toEqual(
      expect.arrayContaining(["agent", "attention"]),
    );
    expect(snap.nodes.get("ws-1")!.tags).toEqual(["agent"]);
    expect(snap.nodes.get("s1")!.tags).toEqual([]);
  });

  // ── ht integration ─────────────────────────────────────────────────

  describe("ht surfaces", () => {
    test("`ht set-status` pills become workspace badges and rows", () => {
      const snap = build({
        host: host({
          statuses: new Map([
            [
              "ws-1",
              [
                { key: "build", value: "passing", color: "#8ce99a" },
                { key: "deploy", value: "staging" },
              ],
            ],
          ]),
        }),
      });
      const ws = snap.nodes.get("ws-1")!;
      const badge = ws.badges.find((b) => b.text === "passing")!;
      // The publishing script chose the colour; re-deriving a tone would
      // throw its signal away.
      expect(badge.color).toBe("#8ce99a");
      expect(ws.detail.some((r) => r.label === "build")).toBe(true);
      expect(ws.detail.some((r) => r.label === "deploy")).toBe(true);
    });

    test("a long pill value is truncated to the badge budget", () => {
      const snap = build({
        host: host({
          statuses: new Map([
            [
              "ws-1",
              [{ key: "k", value: "an extremely long status value" }],
            ],
          ]),
        }),
      });
      const badge = snap.nodes.get("ws-1")!.badges[0]!;
      expect(badge.text.length).toBeLessThanOrEqual(9);
      expect(badge.text.endsWith("…")).toBe(true);
    });

    test("`ht set-progress` drives the workspace meter", () => {
      const snap = build({
        host: host({
          progress: new Map([["ws-1", { value: 41, label: "build" }]]),
        }),
      });
      const ws = snap.nodes.get("ws-1")!;
      expect(ws.meter?.value).toBeCloseTo(0.41, 5);
      expect(ws.badges.some((b) => b.text === "▰ 41%")).toBe(true);
    });

    test("a plan claims the meter ahead of a progress bar", () => {
      setPlans([
        {
          workspaceId: "ws-1",
          updatedAt: NOW,
          steps: [
            { id: "a", title: "one", state: "done" },
            { id: "b", title: "two", state: "active" },
          ],
        },
      ]);
      const snap = build({
        host: host({ progress: new Map([["ws-1", { value: 90 }]]) }),
      });
      const ws = snap.nodes.get("ws-1")!;
      expect(ws.meter?.value).toBeCloseTo(0.5, 5);
      expect(ws.badges[0]!.text).toBe("1/2");
    });
  });

  // ── ht plan → topology ─────────────────────────────────────────────

  describe("plans as topology", () => {
    test("steps hang off the workspace when the plan names no agent", () => {
      setPlans([
        {
          workspaceId: "ws-1",
          updatedAt: NOW,
          steps: [
            { id: "a", title: "Explore", state: "done" },
            { id: "b", title: "Build", state: "active" },
            { id: "c", title: "Ship", state: "waiting" },
          ],
        },
      ]);
      const snap = build({});
      const ws = snap.nodes.get("ws-1")!;
      expect(ws.children).toContain("ws-1:plan:b");
      const active = snap.nodes.get("ws-1:plan:b")!;
      expect(active.kind).toBe("plan-step");
      expect(active.running).toBe(true);
      expect(active.tone).toBe("accent");
      // `active` means "done" on a plan step — the filled-box idiom.
      expect(snap.nodes.get("ws-1:plan:a")!.active).toBe(true);
      expect(snap.nodes.get("ws-1:plan:c")!.tone).toBe("dim");
    });

    test("an agent's plan hangs off the pane running it", () => {
      setClaudeSessions([session({ surfaceId: "s2", phase: "working" })]);
      setPlans([
        {
          workspaceId: "ws-1",
          agentId: "claude:1",
          updatedAt: NOW,
          steps: [{ id: "a", title: "Work", state: "active" }],
        },
      ]);
      const snap = build({});
      expect(snap.nodes.get("s2")!.children).toContain("s2:plan:a");
      expect(snap.nodes.get("ws-1")!.children).not.toContain("ws-1:plan:a");
    });

    test("a failed step is flagged as an error", () => {
      setPlans([
        {
          workspaceId: "ws-1",
          updatedAt: NOW,
          steps: [{ id: "a", title: "Deploy", state: "err" }],
        },
      ]);
      expect(build({}).nodes.get("ws-1:plan:a")!.tone).toBe("err");
    });
  });

  // ── subagents + questions ──────────────────────────────────────────

  test("a live subagent becomes a node under its pane", () => {
    setClaudeSessions([
      session({
        surfaceId: "s2",
        subagents: [
          { agentId: "a1", agentType: "explore", startedAt: NOW - 62_000 },
        ],
      }),
    ]);
    const snap = build({});
    const node = snap.nodes.get("s2:sub:a1")!;
    expect(node.kind).toBe("subagent");
    expect(node.label).toBe("explore");
    expect(node.running).toBe(true);
    expect(node.sublabel).toBe("1:02");
    expect(snap.nodes.get("s2")!.expandable).toBe(true);
  });

  test("a pending question outranks the session's own phase", () => {
    setClaudeSessions([session({ surfaceId: "s2", phase: "working" })]);
    const snap = build({
      questions: [
        { surface_id: "s2", title: "Ship it or keep iterating?" },
      ],
    });
    const pane = snap.nodes.get("s2")!;
    expect(pane.attention).toBe("question");
    expect(pane.detail[0]!.label).toBe("asking");
    expect(pane.detail[0]!.value).toBe("Ship it or keep iterating?");
    expect(pane.tags).toContain("attention");
  });

  test("rate limits roll up as the highest reading anyone reported", () => {
    setClaudeSessions([
      session({
        surfaceId: "s2",
        rateLimits: {
          fiveHourPct: 40,
          fiveHourResetsAt: null,
          sevenDayPct: 11,
          sevenDayResetsAt: null,
        },
      }),
      session({
        sessionId: "other",
        surfaceId: null,
        rateLimits: {
          fiveHourPct: 71,
          fiveHourResetsAt: null,
          sevenDayPct: null,
          sevenDayResetsAt: null,
        },
      }),
    ]);
    const totals = build({}).totals;
    expect(totals.fiveHourPct).toBe(71);
    expect(totals.sevenDayPct).toBe(11);
  });

  test("the river carries one band per workspace, in graph order", () => {
    const snap = build({});
    expect(snap.river.map((b) => b.id)).toEqual(["ws-1", "ws-2"]);
    expect(snap.river[0]!.color).toBe("#6fe9ff");
  });

  test("panes and workspaces expose a history key; leaves do not", () => {
    const snap = build({});
    expect(snap.nodes.get("ws-1")!.historyKey).toBe("ws-1");
    expect(snap.nodes.get("s1")!.historyKey).toBe("s1");
  });

  test("a plan supersedes the mirrored task list it came from", () => {
    // `claude-plan-mirror` builds the plan FROM the session's tasks, so
    // deep mode would otherwise draw the same work twice.
    setClaudeSessions([
      session({
        surfaceId: "s2",
        tasks: [
          { id: "t1", name: "Explore", state: "completed", createdAt: NOW },
          { id: "t2", name: "Build", state: "pending", createdAt: NOW },
        ],
      }),
    ]);
    setPlans([
      {
        workspaceId: "ws-1",
        agentId: "claude:1",
        updatedAt: NOW,
        steps: [
          { id: "a", title: "Explore", state: "done" },
          { id: "b", title: "Build", state: "active" },
        ],
      },
    ]);
    const snap = build({ deep: true });
    const kids = snap.nodes.get("s2")!.children;
    expect(kids.filter((id) => id.includes(":task:"))).toEqual([]);
    expect(kids.filter((id) => id.includes(":plan:"))).toHaveLength(2);
    expect(snap.nodes.has("s2:task:t1")).toBe(false);
  });

  test("deep mode still shows tasks when no plan mirrors them", () => {
    setClaudeSessions([
      session({
        surfaceId: "s2",
        tasks: [{ id: "t1", name: "Solo", state: "pending", createdAt: NOW }],
      }),
    ]);
    expect(build({ deep: true }).nodes.has("s2:task:t1")).toBe(true);
  });

  // ── ht atlas annotations ───────────────────────────────────────────

  describe("agent-authored annotations", () => {
    test("a note replaces the derived sublabel", () => {
      setAtlasAnnotations({
        annotations: [
          {
            target: "s1",
            pinned: false,
            note: "waiting on CI",
            meters: [],
            updatedAt: NOW,
          },
        ],
        marks: [],
      });
      const pane = build({}).nodes.get("s1")!;
      // What the agent says it is doing beats what we inferred from argv.
      expect(pane.sublabel).toBe("waiting on CI");
      expect(pane.detail[0]).toMatchObject({
        label: "note",
        value: "waiting on CI",
      });
    });

    test("a published meter survives the badge cap", () => {
      setClaudeSessions([
        session({ surfaceId: "s2", contextUsedPct: 78, costUsd: 1.42 }),
      ]);
      setAtlasAnnotations({
        annotations: [
          {
            target: "s2",
            pinned: true,
            meters: [{ key: "verify", value: 0.8 }],
            updatedAt: NOW,
          },
        ],
        marks: [],
      });
      const texts = build({}).nodes.get("s2")!.badges.map((b) => b.text);
      // ctx and cost are derived; the agent chose to publish this one.
      expect(texts).toContain("pinned");
      expect(texts).toContain("veri 80%");
    });

    test("the first meter takes the node's arc", () => {
      setAtlasAnnotations({
        annotations: [
          {
            target: "s1",
            pinned: false,
            meters: [
              { key: "build", value: 0.62 },
              { key: "tests", value: 0.1 },
            ],
            updatedAt: NOW,
          },
        ],
        marks: [],
      });
      expect(build({}).nodes.get("s1")!.meter?.value).toBeCloseTo(0.62, 5);
    });

    test("an unannotated node is untouched", () => {
      setAtlasAnnotations({ annotations: [], marks: [] });
      const snap = build({
        host: host({ metadata: { s1: meta({ cwd: "/Users/dev/repo" }) } }),
      });
      const pane = snap.nodes.get("s1")!;
      expect(pane.badges).toEqual([]);
      // The derived sublabel stands when no agent has overridden it.
      expect(pane.sublabel).toBe("dev/repo");
      expect(pane.detail.some((r) => r.label === "note")).toBe(false);
    });
  });
});
