/**
 * Atlas snapshot builder — the only impure stage.
 *
 * Pulls from four independent sources and folds them into one tree:
 *
 *   SurfaceManager.getWorkspaceState()      workspaces, panes, focus, kinds
 *   SurfaceManager.getProcessManagerData()  pid / cwd / git / ports / CPU / RSS
 *   claude-session-store                    phase, model, ctx, cost, tasks
 *   throughput-meter                        bytes/sec per pane  ← the wires
 *
 * The interesting decision is that **a Claude session is not a node**.
 * A session bound to a pane *is* that pane's identity — giving it its own
 * marker would draw two dots for one thing and push the spine a level
 * deeper in a 320 px column. So a bound session folds into its surface
 * node (kind stays `surface`, tone flips to agent, badges gain ctx/cost),
 * and only a session with no live pane gets a marker of its own, hanging
 * off the root where it belongs.
 */
import type {
  AskUserChoice,
  AskUserRequest,
  Plan,
  SurfaceKind,
  SurfaceMetadata,
} from "../../../shared/types";
import type { ClaudeSessionState } from "../../../shared/claude-types";
import { sessionTitle } from "../../../shared/claude-types";
import {
  claudeSessionForSurface,
  getClaudeSessions,
} from "../claude-session-store";
import { flowLevel, formatThroughput, throughputOf } from "../throughput-meter";
import { recordMetrics } from "../metrics-history";
import { plansForWorkspace } from "../plan-store";
import { annotationFor } from "../atlas-annotation-store";
import {
  formatCost,
  formatCpu,
  formatElapsed,
  formatGitBadge,
  formatMemory,
  isDirty,
  shortCommand,
  shortModel,
  shortPath,
} from "./format";
import type {
  AtlasAction,
  AtlasTone,
  AtlasAttention,
  AtlasDetailRow,
  AtlasFilterTag,
  AtlasNode,
  AtlasSnapshot,
} from "./types";

export const ATLAS_ROOT_ID = "__root__";

/** Max badges per node. Past three the row stops scanning and starts
 *  reading, which is the opposite of what a badge row is for. */
const MAX_BADGES = 3;

/** CPU percentage at which an aggregate node's load ring reads "full".
 *  `ps %cpu` is per-core, so a single saturated process reports ~100 and
 *  a /100 scale would paint the root ring red on a machine that is
 *  barely warm. Four busy cores is the honest "this is loaded" mark. */
const AGGREGATE_CPU_CEILING = 400;

/** Structural slice of SurfaceManager the builder needs. Declared
 *  locally so `atlas/` never imports the concrete manager — that would
 *  be an import cycle and would make the builder untestable. */
export interface AtlasHost {
  getWorkspaceState(): {
    workspaces: {
      id: string;
      name: string;
      color?: string;
      surfaceIds: string[];
      focusedSurfaceId?: string | null;
      surfaceTitles?: Record<string, string>;
      surfaceTypes?: Record<string, SurfaceKind>;
      surfaceCwds?: Record<string, string>;
      surfaceUrls?: Record<string, string>;
      surfaceEditorFiles?: Record<string, string>;
    }[];
    activeWorkspaceId: string | null | undefined;
  };
  getProcessManagerData(): {
    id: string;
    surfaces: { id: string; title: string; metadata: SurfaceMetadata | null }[];
  }[];
  /** `ht set-status` pills, keyed by workspace. */
  getAllStatuses?: () => Map<
    string,
    { key: string; value: string; icon?: string; color?: string }[]
  >;
  /** `ht set-progress` bars, keyed by workspace. */
  getAllProgress?: () => Map<string, { value: number; label?: string }>;
  focusWorkspaceByIndex(index: number): void;
  focusSurface(surfaceId: string): void;
}

export interface AtlasBuildInput {
  host: AtlasHost | null;
  focusedSurfaceId: string | null;
  notifyWorkspaces: ReadonlySet<string>;
  /** Include per-pane process / port / task children. The 320 px column
   *  cannot carry them; the expanded overlay can. */
  deep: boolean;
  /** Questions currently addressed to the human, from `ht ask` and from
   *  the agent ask-user queue. Keyed lookup is by `surface_id`. */
  pendingQuestions?: readonly AskUserRequest[];
  /** Injected for tests. */
  now?: () => number;
  /** Raised for actions so the builder stays free of RPC knowledge. */
  emit: AtlasEmitters;
}

export interface AtlasEmitters {
  closeSurface(surfaceId: string): void;
  approveClaude(surfaceId: string | undefined): void;
  interruptClaude(surfaceId: string): void;
  showSurfaceInfo(surfaceId: string): void;
  openExternal(url: string): void;
}

export function buildAtlasSnapshot(input: AtlasBuildInput): AtlasSnapshot {
  const now = input.now ?? Date.now;
  const nodes = new Map<string, AtlasNode>();
  const river: AtlasSnapshot["river"] = [];
  const totals = {
    workspaces: 0,
    surfaces: 0,
    agents: 0,
    cpu: 0,
    rssKb: 0,
    attention: 0,
    costUsd: 0,
    fiveHourPct: null as number | null,
    sevenDayPct: null as number | null,
  };
  const statuses = input.host?.getAllStatuses?.() ?? new Map();
  const progressBars = input.host?.getAllProgress?.() ?? new Map();
  const questionsBySurface = new Map<string, AskUserRequest>();
  for (const q of input.pendingQuestions ?? []) {
    if (!questionsBySurface.has(q.surface_id)) {
      questionsBySurface.set(q.surface_id, q);
    }
  }

  const root = makeNode({
    id: ATLAS_ROOT_ID,
    kind: "root",
    label: "τ-mux",
    tone: "accent",
  });
  nodes.set(root.id, root);

  const state = input.host?.getWorkspaceState();
  const workspaces = state?.workspaces ?? [];
  const activeWorkspaceId = state?.activeWorkspaceId ?? null;
  const pmData = input.host?.getProcessManagerData() ?? [];
  const boundSurfaceIds = new Set<string>();

  workspaces.forEach((ws, index) => {
    totals.workspaces += 1;
    const wsActive = ws.id === activeWorkspaceId;
    const pmWs = pmData.find((w) => w.id === ws.id);
    const wsNode = makeNode({
      id: ws.id,
      kind: "workspace",
      label: ws.name || `workspace ${index + 1}`,
      tone: "neutral",
      ...(ws.color !== undefined ? { color: ws.color } : {}),
      parent: root.id,
      active: wsActive,
      expandable: ws.surfaceIds.length > 0,
    });
    wsNode.activate = () => input.host?.focusWorkspaceByIndex(index);
    root.children.push(wsNode.id);
    nodes.set(wsNode.id, wsNode);

    let wsCpu = 0;
    let wsRss = 0;
    let wsAgents = 0;
    let wsFlow = 0;
    let wsFlowBytes = 0;
    let wsGit: SurfaceMetadata["git"] = null;

    for (const sid of ws.surfaceIds) {
      totals.surfaces += 1;
      boundSurfaceIds.add(sid);
      const metadata =
        pmWs?.surfaces.find((s) => s.id === sid)?.metadata ?? null;
      const session = claudeSessionForSurface(sid);
      const kind: SurfaceKind = ws.surfaceTypes?.[sid] ?? "terminal";
      const title =
        ws.surfaceTitles?.[sid] ??
        pmWs?.surfaces.find((s) => s.id === sid)?.title ??
        sid;

      const surfaceNode = buildSurfaceNode({
        sid,
        title,
        kind,
        metadata,
        session,
        workspace: ws,
        parentId: wsNode.id,
        focused: sid === input.focusedSurfaceId,
        question: questionsBySurface.get(sid) ?? null,
        now,
        emit: input.emit,
        host: input.host,
      });
      wsNode.children.push(surfaceNode.id);
      nodes.set(surfaceNode.id, surfaceNode);

      const cpu = sumCpu(metadata);
      wsCpu += cpu;
      wsRss += sumRss(metadata);
      wsFlow = Math.max(wsFlow, surfaceNode.flow);
      wsFlowBytes += throughputOf(sid);
      if (isAgentKind(kind) || session) {
        wsAgents += 1;
        totals.agents += 1;
      }
      if (session?.costUsd) totals.costUsd += session.costUsd;
      if (session) {
        // Rate limits are an account-wide fact reported per session, so
        // the honest rollup is the highest reading anyone has seen.
        totals.fiveHourPct = maxOrNull(
          totals.fiveHourPct,
          session.rateLimits.fiveHourPct,
        );
        totals.sevenDayPct = maxOrNull(
          totals.sevenDayPct,
          session.rateLimits.sevenDayPct,
        );
      }
      if (surfaceNode.attention) totals.attention += 1;
      if (!wsGit && metadata?.git) wsGit = metadata.git;

      // Sample this pane into the history ring so the inspector's
      // sparkline and the activity river have a series to draw. The draw
      // pass is already change-gated, so an idle pane records nothing.
      recordMetrics(
        sid,
        cpu,
        throughputOf(sid),
        now(),
        session?.contextUsedPct ?? undefined,
      );

      // A live subagent is a real branch of the work — give it a node
      // rather than burying it in a comma-joined inspector row.
      for (const sub of session?.subagents ?? []) {
        const node = buildSubagentNode(sub, surfaceNode.id, now);
        surfaceNode.children.push(node.id);
        nodes.set(node.id, node);
      }

      if (input.deep) {
        for (const child of buildDeepChildren(
          surfaceNode.id,
          metadata,
          session,
          now,
        )) {
          surfaceNode.children.push(child.id);
          nodes.set(child.id, child);
        }
      }
      surfaceNode.expandable = surfaceNode.children.length > 0;
    }

    totals.cpu += wsCpu;
    totals.rssKb += wsRss;

    // The workspace marker carries the workspace's own summary: how many
    // panes, how many of them are agents, aggregate load, and the git ref
    // of whichever pane has one — the four things you would ask before
    // deciding to switch to it.
    wsNode.load = clamp01(wsCpu / AGGREGATE_CPU_CEILING);
    wsNode.flow = wsFlow;
    wsNode.tone = wsAgents > 0 ? "agent" : "neutral";
    wsNode.running = wsCpu > 4;
    wsNode.sublabel = paneSummary(ws.surfaceIds.length, wsAgents);
    if (input.notifyWorkspaces.has(ws.id) && !wsActive) {
      wsNode.attention = "notify";
      totals.attention += 1;
    }
    recordMetrics(ws.id, wsCpu, wsFlowBytes, now());
    wsNode.historyKey = ws.id;
    river.push({
      id: ws.id,
      label: wsNode.label,
      color: ws.color || "var(--tau-text-dim)",
    });

    // `ht plan` — the plan panel is hidden under Atlas, so the plan
    // becomes topology instead of vanishing. Steps hang off whichever
    // pane runs the agent when the plan names one, else the workspace.
    for (const plan of plansForWorkspace(ws.id)) {
      const anchorId = planAnchor(plan, ws.surfaceIds, nodes) ?? wsNode.id;
      const anchor = nodes.get(anchorId);
      if (!anchor) continue;
      const done = plan.steps.filter((st) => st.state === "done").length;
      if (plan.steps.length > 0) {
        anchor.meter = {
          value: clamp01(done / plan.steps.length),
          tone: "accent",
        };
        anchor.badges.unshift({
          text: `${done}/${plan.steps.length}`,
          tone: done === plan.steps.length ? "ok" : "accent",
          title: `Plan progress — ${done} of ${plan.steps.length} steps done`,
        });
      }
      // `claude-plan-mirror` turns a Claude session's task list INTO a
      // plan, so in deep mode the same work would otherwise be drawn
      // twice — once as tasks, once as steps. The plan is the richer
      // representation (real states, descriptions), so it supersedes.
      const dropped = anchor.children.filter((id) => id.includes(":task:"));
      if (dropped.length > 0) {
        anchor.children = anchor.children.filter(
          (id) => !id.includes(":task:"),
        );
        for (const id of dropped) nodes.delete(id);
      }
      for (const step of plan.steps) {
        const node = buildPlanStepNode(step, anchor.id, plan);
        anchor.children.push(node.id);
        nodes.set(node.id, node);
      }
      anchor.expandable = anchor.children.length > 0;
    }

    // `ht set-progress` — a workspace-level bar, drawn as the marker's
    // outer arc when no plan already claimed it.
    const bar = progressBars.get(ws.id);
    if (bar && !wsNode.meter) {
      wsNode.meter = { value: clamp01(bar.value / 100), tone: "accent" };
      wsNode.badges.push({
        text: `▰ ${Math.round(bar.value)}%`,
        tone: "accent",
        title: bar.label ? `${bar.label} — ht set-progress` : "ht set-progress",
      });
    }

    // `ht set-status` pills. The publisher picked the colour; honour it
    // rather than re-deriving a tone, so a script's own signal survives.
    const pills = statuses.get(ws.id) ?? [];
    for (const pill of pills.slice(0, 2)) {
      wsNode.badges.push({
        text: truncateBadge(pill.value || pill.key),
        tone: "neutral",
        ...(pill.color ? { color: pill.color } : {}),
        title: `${pill.key}: ${pill.value} — ht set-status`,
      });
    }
    for (const pill of pills) {
      wsNode.detail.push({ label: pill.key, value: pill.value });
    }

    if (wsGit) {
      wsNode.badges.push({
        text: formatGitBadge(wsGit),
        tone: isDirty(wsGit) ? "warn" : "dim",
        title: `${wsGit.branch}${wsGit.upstream ? ` → ${wsGit.upstream}` : ""}`,
      });
    }
    if (wsCpu >= 1) {
      wsNode.badges.push({
        text: formatCpu(wsCpu),
        tone: aggregateLoadTone(wsCpu),
        title: "Aggregate CPU across every process in this workspace",
      });
    }
    if (wsRss > 0) {
      wsNode.badges.push({
        text: formatMemory(wsRss),
        tone: "dim",
        title: "Resident memory across every process in this workspace",
      });
    }
    wsNode.badges.length = Math.min(wsNode.badges.length, MAX_BADGES);
    wsNode.detail = [
      ...wsNode.detail,
      { label: "panes", value: String(ws.surfaceIds.length) },
      { label: "agents", value: String(wsAgents) },
        { label: "cpu", value: formatCpu(wsCpu), tone: aggregateLoadTone(wsCpu) },
      { label: "memory", value: formatMemory(wsRss) || "—" },
      ...(wsGit
        ? [
            { label: "branch", value: wsGit.branch },
            {
              label: "changes",
              value:
                wsGit.staged + wsGit.unstaged + wsGit.untracked > 0
                  ? `${wsGit.staged} staged · ${wsGit.unstaged} unstaged · ${wsGit.untracked} new`
                  : "clean",
              tone: isDirty(wsGit) ? ("warn" as const) : ("ok" as const),
            },
          ]
        : []),
    ];
    if (wsAgents > 0) wsNode.tags = ["agent"];
    applyAnnotation(wsNode);
  });

  // Sessions with no pane — Claude Code running in a shell τ-mux never
  // owned, or a pane that closed under a live session. They still matter:
  // they still spend money and can still be waiting on you.
  for (const session of getClaudeSessions()) {
    if (session.surfaceId && boundSurfaceIds.has(session.surfaceId)) continue;
    const node = buildSessionNode(session, root.id, now, input.emit);
    root.children.push(node.id);
    nodes.set(node.id, node);
    totals.agents += 1;
    if (session.costUsd) totals.costUsd += session.costUsd;
    if (node.attention) totals.attention += 1;
    // Rate limits are account-wide. A session with no pane reports the
    // same wall as one with a pane, so excluding it would under-report
    // exactly when you most want the warning.
    totals.fiveHourPct = maxOrNull(
      totals.fiveHourPct,
      session.rateLimits.fiveHourPct,
    );
    totals.sevenDayPct = maxOrNull(
      totals.sevenDayPct,
      session.rateLimits.sevenDayPct,
    );
  }

  root.load = clamp01(totals.cpu / AGGREGATE_CPU_CEILING);
  root.running = totals.cpu > 4;
  root.expandable = root.children.length > 0;
  root.sublabel = rootSummary(totals);
  root.detail = [
    { label: "workspaces", value: String(totals.workspaces) },
    { label: "panes", value: String(totals.surfaces) },
    { label: "agents", value: String(totals.agents) },
    {
      label: "cpu",
      value: formatCpu(totals.cpu),
      tone: aggregateLoadTone(totals.cpu),
    },
    { label: "memory", value: formatMemory(totals.rssKb) || "—" },
    ...(totals.costUsd > 0
      ? [{ label: "agent spend", value: formatCost(totals.costUsd) }]
      : []),
  ];

  return { nodes, roots: [root.id], totals, river };
}

// ── surface nodes ────────────────────────────────────────────────────

interface SurfaceNodeInput {
  sid: string;
  title: string;
  kind: SurfaceKind;
  metadata: SurfaceMetadata | null;
  session: ClaudeSessionState | null;
  workspace: {
    surfaceUrls?: Record<string, string>;
    surfaceEditorFiles?: Record<string, string>;
    surfaceCwds?: Record<string, string>;
  };
  parentId: string;
  focused: boolean;
  /** A question addressed to the human on this pane, if any. */
  question: AskUserRequest | null;
  now: () => number;
  emit: AtlasEmitters;
  host: AtlasHost | null;
}

function buildSurfaceNode(input: SurfaceNodeInput): AtlasNode {
  const { sid, kind, metadata, session } = input;
  const isAgent = isAgentKind(kind) || !!session;
  const node = makeNode({
    id: sid,
    kind: "surface",
    label: input.title,
    tone: isAgent ? "agent" : "accent",
    parent: input.parentId,
    active: input.focused,
  });

  const cpu = sumCpu(metadata);
  node.load = clamp01(cpu / 100);
  node.flow = flowLevel(sid);
  node.sublabel = surfaceSublabel(input);
  node.activate = () => input.host?.focusSurface(sid);

  const tags: AtlasFilterTag[] = [];
  if (isAgent) tags.push("agent");

  // ── badges: the highest-signal facts that fit in nine characters ──
  if (session) {
    if (typeof session.contextUsedPct === "number") {
      node.meter = {
        value: clamp01(session.contextUsedPct / 100),
        tone: session.contextUsedPct > 85 ? "err" : "agent",
      };
      node.badges.push({
        text: `${Math.round(session.contextUsedPct)}% ctx`,
        tone: session.contextUsedPct > 85 ? "err" : "dim",
        title: session.contextWindowSize
          ? `Context window ${session.contextWindowSize.toLocaleString()} tokens`
          : "Share of the context window in use",
      });
    }
    const cost = formatCost(session.costUsd);
    if (cost) {
      node.badges.push({
        text: cost,
        tone: "dim",
        title: "Cost of this session so far",
      });
    }
  }
  const port = primaryPort(metadata);
  if (port) {
    node.badges.push({
      text: `:${port.port}`,
      tone: "ok",
      title: `Listening on ${port.address}:${port.port} (${port.proto})`,
    });
  }
  const progress = metadata?.progress;
  if (progress && typeof progress.value === "number") {
    node.meter = {
      value: clamp01(progress.value / 100),
      tone: progress.state === "error" ? "err" : "accent",
    };
    // The block prefix separates "62 % built" from "62 % of a core",
    // which are otherwise the same three characters side by side.
    node.badges.push({
      text: `▰ ${Math.round(progress.value)}%`,
      tone: progress.state === "error" ? "err" : "accent",
      title: "Build progress reported by the pane (OSC 9;4)",
    });
  } else if (cpu >= 50) {
    // Only a notable number earns a chip — the load arc on the marker
    // already carries the rest, and the inspector has the exact value.
    node.badges.push({
      text: formatCpu(cpu),
      tone: loadTone(cpu),
      title: "CPU across this pane's process tree",
    });
  }
  const rate = formatThroughput(sid);
  if (rate && node.badges.length < MAX_BADGES) {
    node.badges.push({ text: rate, tone: "dim", title: "Output rate" });
  }
  node.badges.length = Math.min(node.badges.length, MAX_BADGES);

  // ── phase, attention, actions ──
  if (session) {
    node.running = session.phase === "working";
    node.attention = attentionOf(session);
    node.detail = sessionDetail(session, metadata, input.now);
    node.actions = sessionActions(session, sid, input.emit);
    if (node.running) tags.push("running");
  } else {
    node.running = cpu > 12;
    node.detail = surfaceDetail(input, metadata, cpu);
    node.actions = surfaceActions(sid, metadata, input.emit);
    if (node.running) tags.push("running");
  }
  // `ht ask` / the agent ask-user queue address the human directly, so a
  // pending question outranks whatever phase the session reports.
  if (input.question) {
    node.attention = "question";
    node.detail = [
      { label: "asking", value: input.question.title, tone: "warn" },
      ...(input.question.body
        ? [{ label: "detail", value: input.question.body }]
        : []),
      ...(input.question.choices ?? []).map((c: AskUserChoice, i: number) => ({
        label: i === 0 ? "choices" : "",
        value: c.label,
      })),
      ...node.detail,
    ];
  }
  if (node.attention) tags.push("attention");
  node.tags = tags;
  node.historyKey = input.sid;
  applyAnnotation(node);
  return node;
}

/** The sublabel says what the pane is *doing*. When that is the same
 *  word as its title — a pane called `lazygit` running `lazygit` — it
 *  says nothing twice, so it says nothing at all. */
function surfaceSublabel(input: SurfaceNodeInput): string {
  const sub = computeSublabel(input);
  if (!sub) return "";
  const title = input.title.toLowerCase();
  const lower = sub.toLowerCase();
  if (title === lower || title.startsWith(lower) || lower.startsWith(title)) {
    return "";
  }
  return sub;
}

function computeSublabel(input: SurfaceNodeInput): string {
  const { kind, metadata, session, workspace, sid } = input;
  if (session) {
    const model = shortModel(session.modelDisplayName);
    const phase = phaseLabel(session);
    return model ? `${phase} · ${model}` : phase;
  }
  switch (kind) {
    case "browser":
      return hostOf(workspace.surfaceUrls?.[sid] ?? "");
    case "editor":
      return shortPath(workspace.surfaceEditorFiles?.[sid] ?? "", 2);
    case "telegram":
      return "telegram";
    case "extension":
      return "extension";
    case "agent":
      return "pi agent";
    case "claude":
      return "claude code";
    default:
      break;
  }
  const fg = metadata?.tree.find((p) => p.pid === metadata.foregroundPid);
  // A shell sitting at its own prompt is not "running zsh" — it is
  // idle, and saying so is more useful than echoing the shell name.
  if (!fg || fg.pid === metadata?.pid) {
    return shortPath(metadata?.cwd ?? "", 2);
  }
  return shortCommand(fg.command);
}

function surfaceDetail(
  input: SurfaceNodeInput,
  metadata: SurfaceMetadata | null,
  cpu: number,
): AtlasDetailRow[] {
  const rows: AtlasDetailRow[] = [];
  if (metadata?.cwd) rows.push({ label: "cwd", value: metadata.cwd });
  const fg = metadata?.tree.find((p) => p.pid === metadata.foregroundPid);
  if (fg && fg.pid !== metadata?.pid) {
    rows.push({ label: "running", value: shortCommand(fg.command, 48) });
  }
  if (metadata) {
    rows.push({ label: "pid", value: String(metadata.pid) });
    rows.push({ label: "cpu", value: formatCpu(cpu), tone: loadTone(cpu) });
    const rss = sumRss(metadata);
    if (rss > 0) rows.push({ label: "memory", value: formatMemory(rss) });
    if (metadata.tree.length > 1) {
      rows.push({ label: "processes", value: String(metadata.tree.length) });
    }
    if (metadata.listeningPorts.length > 0) {
      rows.push({
        label: "ports",
        value: metadata.listeningPorts.map((p) => `:${p.port}`).join(" "),
        tone: "ok",
      });
    }
    if (metadata.git) {
      rows.push({ label: "branch", value: formatGitBadge(metadata.git) });
    }
    if (metadata.packageJson?.name) {
      rows.push({ label: "package", value: metadata.packageJson.name });
    } else if (metadata.cargoToml?.name) {
      rows.push({ label: "crate", value: metadata.cargoToml.name });
    }
  }
  const rate = formatThroughput(input.sid);
  if (rate) rows.push({ label: "output", value: rate, tone: "accent" });
  return rows;
}

function surfaceActions(
  sid: string,
  metadata: SurfaceMetadata | null,
  emit: AtlasEmitters,
): AtlasAction[] {
  const actions: AtlasAction[] = [
    {
      id: "info",
      label: "Details",
      kind: "ghost",
      run: () => emit.showSurfaceInfo(sid),
    },
  ];
  const port = primaryPort(metadata);
  if (port) {
    actions.unshift({
      id: "open",
      label: `Open :${port.port}`,
      kind: "ghost",
      run: () =>
        emit.openExternal(
          `http://${port.address === "*" || port.address === "::" ? "localhost" : port.address}:${port.port}`,
        ),
    });
  }
  actions.push({
    id: "close",
    label: "Close pane",
    kind: "danger",
    run: () => emit.closeSurface(sid),
  });
  return actions;
}

// ── session nodes (unbound) ──────────────────────────────────────────

function buildSessionNode(
  session: ClaudeSessionState,
  parentId: string,
  now: () => number,
  emit: AtlasEmitters,
): AtlasNode {
  const node = makeNode({
    id: `session:${session.sessionId}`,
    kind: "session",
    label: sessionTitle(session),
    tone: "agent",
    parent: parentId,
  });
  node.sublabel = session.cwd
    ? `${phaseLabel(session)} · ${shortPath(session.cwd, 1)}`
    : phaseLabel(session);
  node.running = session.phase === "working";
  node.attention = attentionOf(session);
  if (typeof session.contextUsedPct === "number") {
    node.meter = {
      value: clamp01(session.contextUsedPct / 100),
      tone: session.contextUsedPct > 85 ? "err" : "agent",
    };
    node.badges.push({
      text: `${Math.round(session.contextUsedPct)}% ctx`,
      tone: session.contextUsedPct > 85 ? "err" : "dim",
    });
  }
  const cost = formatCost(session.costUsd);
  if (cost) node.badges.push({ text: cost, tone: "dim" });
  node.badges.push({ text: "detached", tone: "warn", title: "No τ-mux pane" });
  node.badges.length = Math.min(node.badges.length, MAX_BADGES);
  node.detail = sessionDetail(session, null, now);
  node.actions = sessionActions(session, session.surfaceId ?? undefined, emit);
  const tags: AtlasFilterTag[] = ["agent"];
  if (node.running) tags.push("running");
  if (node.attention) tags.push("attention");
  node.tags = tags;
  return node;
}

function sessionDetail(
  session: ClaudeSessionState,
  metadata: SurfaceMetadata | null,
  now: () => number,
): AtlasDetailRow[] {
  const rows: AtlasDetailRow[] = [];
  if (session.currentPrompt) {
    rows.push({ label: "prompt", value: session.currentPrompt });
  }
  if (session.approvalMessage && session.phase === "waiting-approval") {
    rows.push({
      label: "waiting on",
      value: session.approvalMessage,
      tone: "warn",
    });
  }
  if (session.errorMessage) {
    rows.push({ label: "error", value: session.errorMessage, tone: "err" });
  }
  if (session.modelDisplayName) {
    rows.push({ label: "model", value: session.modelDisplayName });
  }
  if (session.permissionMode) {
    rows.push({ label: "mode", value: session.permissionMode });
  }
  if (typeof session.contextUsedPct === "number") {
    rows.push({
      label: "context",
      value: `${Math.round(session.contextUsedPct)}%`,
      meter: clamp01(session.contextUsedPct / 100),
      tone: session.contextUsedPct > 85 ? "err" : "agent",
    });
  }
  const five = session.rateLimits.fiveHourPct;
  if (typeof five === "number") {
    rows.push({
      label: "5h limit",
      value: `${Math.round(five)}%`,
      meter: clamp01(five / 100),
      tone: five > 85 ? "err" : five > 60 ? "warn" : "ok",
    });
  }
  const week = session.rateLimits.sevenDayPct;
  if (typeof week === "number") {
    rows.push({
      label: "7d limit",
      value: `${Math.round(week)}%`,
      meter: clamp01(week / 100),
      tone: week > 85 ? "err" : week > 60 ? "warn" : "ok",
    });
  }
  const cost = formatCost(session.costUsd);
  if (cost) rows.push({ label: "cost", value: cost });
  if (session.linesAdded != null || session.linesRemoved != null) {
    rows.push({
      label: "diff",
      value: `+${session.linesAdded ?? 0} −${session.linesRemoved ?? 0}`,
    });
  }
  if (session.promptStartedAt > 0) {
    rows.push({
      label: "turn",
      value: formatElapsed(now() - session.promptStartedAt),
      tone: "accent",
    });
  }
  if (session.turnCount > 0) {
    rows.push({ label: "turns", value: String(session.turnCount) });
  }
  const pending = session.tasks.filter((t) => t.state === "pending").length;
  if (session.tasks.length > 0) {
    rows.push({
      label: "tasks",
      value: `${session.tasks.length - pending}/${session.tasks.length} done`,
      meter: clamp01((session.tasks.length - pending) / session.tasks.length),
    });
  }
  if (session.subagents.length > 0) {
    rows.push({
      label: "subagents",
      value: session.subagents.map((s) => s.agentType).join(", "),
      tone: "agent",
    });
  }
  if (session.prNumber) {
    rows.push({
      label: "pr",
      value: `#${session.prNumber}${session.prReviewState ? ` · ${session.prReviewState}` : ""}`,
    });
  }
  if (metadata?.cwd) rows.push({ label: "cwd", value: metadata.cwd });
  else if (session.cwd) rows.push({ label: "cwd", value: session.cwd });
  return rows;
}

function sessionActions(
  session: ClaudeSessionState,
  surfaceId: string | undefined,
  emit: AtlasEmitters,
): AtlasAction[] {
  const actions: AtlasAction[] = [];
  // Only a terminal-hosted prompt can be answered by sending a keystroke.
  // A modal-routed one has no prompt on screen, so offering "Approve"
  // would type into whatever the pane happens to be showing.
  if (
    session.phase === "waiting-approval" &&
    session.approvalSource === "tty" &&
    !session.approvalIsQuestion
  ) {
    actions.push({
      id: "approve",
      label: "Approve",
      kind: "primary",
      run: () => emit.approveClaude(surfaceId),
    });
  }
  if (session.phase === "working" && surfaceId) {
    actions.push({
      id: "interrupt",
      label: "Interrupt",
      kind: "danger",
      run: () => emit.interruptClaude(surfaceId),
    });
  }
  if (session.prUrl) {
    const url = session.prUrl;
    actions.push({
      id: "pr",
      label: `PR #${session.prNumber ?? ""}`.trim(),
      kind: "ghost",
      run: () => emit.openExternal(url),
    });
  }
  return actions;
}

// ── deep children (expanded overlay only) ────────────────────────────

function buildDeepChildren(
  parentId: string,
  metadata: SurfaceMetadata | null,
  session: ClaudeSessionState | null,
  now: () => number,
): AtlasNode[] {
  const out: AtlasNode[] = [];
  if (metadata) {
    // Child processes only — the shell itself is already the pane node.
    const children = metadata.tree
      .filter((p) => p.pid !== metadata.pid)
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 8);
    for (const proc of children) {
      const node = makeNode({
        id: `${parentId}:pid:${proc.pid}`,
        kind: "process",
        label: shortCommand(proc.command, 30),
        tone: "dim",
        parent: parentId,
      });
      node.load = clamp01(proc.cpu / 100);
      node.sublabel = `pid ${proc.pid}`;
      node.badges = [
        { text: formatCpu(proc.cpu), tone: loadTone(proc.cpu) },
        { text: formatMemory(proc.rssKb), tone: "dim" },
      ];
      node.detail = [
        { label: "command", value: proc.command },
        { label: "pid", value: String(proc.pid) },
        { label: "parent", value: String(proc.ppid) },
        { label: "cpu", value: formatCpu(proc.cpu), tone: loadTone(proc.cpu) },
        { label: "memory", value: formatMemory(proc.rssKb) },
      ];
      out.push(node);
    }
    for (const port of metadata.listeningPorts.slice(0, 4)) {
      const node = makeNode({
        id: `${parentId}:port:${port.port}`,
        kind: "port",
        label: `:${port.port}`,
        tone: "ok",
        parent: parentId,
      });
      node.sublabel = `${port.proto} · ${port.address}`;
      node.detail = [
        { label: "port", value: String(port.port) },
        { label: "address", value: port.address },
        { label: "protocol", value: port.proto },
        { label: "pid", value: String(port.pid) },
      ];
      out.push(node);
    }
  }
  if (session) {
    for (const task of session.tasks.slice(0, 12)) {
      const done = task.state === "completed";
      const node = makeNode({
        id: `${parentId}:task:${task.id}`,
        kind: "task",
        label: task.name,
        tone: done ? "ok" : "agent",
        parent: parentId,
      });
      node.active = done;
      node.sublabel = done ? "done" : "pending";
      node.detail = [
        ...(task.description
          ? [{ label: "description", value: task.description }]
          : []),
        { label: "state", value: task.state },
        {
          label: "age",
          value: formatElapsed(now() - task.createdAt),
        },
      ];
      out.push(node);
    }
  }
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────

function makeNode(seed: {
  id: string;
  kind: AtlasNode["kind"];
  label: string;
  tone: AtlasNode["tone"];
  color?: string;
  parent?: string;
  active?: boolean;
  expandable?: boolean;
}): AtlasNode {
  return {
    id: seed.id,
    kind: seed.kind,
    label: seed.label,
    sublabel: "",
    parent: seed.parent ?? null,
    children: [],
    tone: seed.tone,
    ...(seed.color !== undefined ? { color: seed.color } : {}),
    load: 0,
    flow: 0,
    active: seed.active ?? false,
    running: false,
    attention: null,
    badges: [],
    detail: [],
    actions: [],
    expandable: seed.expandable ?? false,
    tags: [],
  };
}

function attentionOf(session: ClaudeSessionState): AtlasAttention | null {
  if (session.awaitingUserChoice || session.approvalIsQuestion)
    return "question";
  if (session.phase === "waiting-approval") return "approval";
  if (session.phase === "waiting-input") return "input";
  if (session.phase === "error") return "error";
  return null;
}

function phaseLabel(session: ClaudeSessionState): string {
  switch (session.phase) {
    case "working":
      return "working";
    case "waiting-input":
      return "waiting for you";
    case "waiting-approval":
      return session.approvalIsQuestion ? "asking you" : "needs approval";
    case "compacting":
      return "compacting";
    case "error":
      return "error";
    case "ended":
      return "ended";
    default:
      return "idle";
  }
}

function isAgentKind(kind: SurfaceKind): boolean {
  return kind === "claude" || kind === "agent";
}

function sumCpu(metadata: SurfaceMetadata | null): number {
  if (!metadata) return 0;
  let total = 0;
  for (const p of metadata.tree) total += p.cpu;
  return total;
}

function sumRss(metadata: SurfaceMetadata | null): number {
  if (!metadata) return 0;
  let total = 0;
  for (const p of metadata.tree) total += p.rssKb;
  return total;
}

function primaryPort(
  metadata: SurfaceMetadata | null,
): SurfaceMetadata["listeningPorts"][number] | null {
  if (!metadata || metadata.listeningPorts.length === 0) return null;
  // Lowest port number is the stable choice — a dev server's own port
  // rather than whichever ephemeral socket the OS handed out this run.
  return (
    [...metadata.listeningPorts].sort((a, b) => a.port - b.port)[0] ?? null
  );
}

/** Tone for an aggregate (workspace / root) CPU figure. Scaled against
 *  the same multi-core ceiling as the load ring, so the number and the
 *  colour tell the same story. */
function aggregateLoadTone(cpu: number): "ok" | "warn" | "err" | "dim" {
  return loadTone((cpu / AGGREGATE_CPU_CEILING) * 100);
}

function loadTone(cpu: number): "ok" | "warn" | "err" | "dim" {
  if (cpu >= 85) return "err";
  if (cpu >= 50) return "warn";
  if (cpu >= 5) return "ok";
  return "dim";
}

function maxOrNull(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function hostOf(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 28);
  }
}

function paneSummary(panes: number, agents: number): string {
  const p = `${panes} pane${panes === 1 ? "" : "s"}`;
  return agents > 0 ? `${p} · ${agents} agent${agents === 1 ? "" : "s"}` : p;
}

function rootSummary(totals: AtlasSnapshot["totals"]): string {
  const parts = [
    `${totals.workspaces} workspace${totals.workspaces === 1 ? "" : "s"}`,
    `${totals.surfaces} pane${totals.surfaces === 1 ? "" : "s"}`,
  ];
  if (totals.agents > 0) parts.push(`${totals.agents} agent`);
  return parts.join(" · ");
}

/**
 * Fold an agent's own annotations onto a node.
 *
 * `ht atlas` is the one channel where the thing doing the work says
 * something observation cannot reach, so its marks outrank derived ones:
 * a note becomes the sublabel (what the agent says it is doing beats
 * what we inferred from argv), and a published meter takes the outer arc
 * from build progress.
 */
function applyAnnotation(node: AtlasNode): void {
  const ann = annotationFor(node.id);
  if (!ann) return;
  if (ann.note) {
    node.sublabel = ann.note;
    node.detail = [
      {
        label: "note",
        value: ann.note,
        ...(ann.noteTone && ann.noteTone !== "info"
          ? { tone: ann.noteTone === "err" ? ("err" as const) : ("warn" as const) }
          : {}),
      },
      ...node.detail,
    ];
  }
  const headline = ann.meters[0];
  if (headline) {
    node.meter = { value: clamp01(headline.value), tone: "accent" };
  }
  // Annotation badges go to the FRONT. The cap keeps the first three, and
  // a reading the agent chose to publish outranks one τ-mux derived on
  // its own — otherwise `ht atlas meter` silently loses to a cost chip.
  for (const meter of [...ann.meters].reverse()) {
    node.badges.unshift({
      text: `${meter.key.slice(0, 4)} ${Math.round(meter.value * 100)}%`,
      tone: "accent",
      title: meter.label ?? `${meter.key} — ht atlas meter`,
    });
    node.detail.push({
      label: meter.key,
      value: `${Math.round(meter.value * 100)}%`,
      meter: clamp01(meter.value),
      tone: "accent",
    });
  }
  if (ann.pinned) {
    node.badges.unshift({
      text: "pinned",
      tone: "accent",
      title: "Pinned by an agent (ht atlas pin)",
    });
  }
  node.badges.length = Math.min(node.badges.length, MAX_BADGES);
}

// ── ht plan → topology ───────────────────────────────────────────────

/** Which node a plan's steps hang from. A plan naming an agent belongs
 *  to whichever pane runs that agent; otherwise it is the workspace's. */
function planAnchor(
  plan: Plan,
  surfaceIds: readonly string[],
  nodes: Map<string, AtlasNode>,
): string | null {
  if (!plan.agentId) return null;
  for (const sid of surfaceIds) {
    const node = nodes.get(sid);
    if (node && node.tone === "agent") return sid;
  }
  return null;
}

function buildPlanStepNode(
  step: Plan["steps"][number],
  parentId: string,
  plan: Plan,
): AtlasNode {
  const tone: AtlasTone =
    step.state === "done"
      ? "ok"
      : step.state === "err"
        ? "err"
        : step.state === "active"
          ? "accent"
          : "dim";
  const node = makeNode({
    id: `${parentId}:plan:${step.id}`,
    kind: "plan-step",
    label: step.title,
    tone,
    parent: parentId,
    // On a plan step `active` means "done" — the filled-box checklist
    // idiom. The renderer keeps the focus reticle off these.
    active: step.state === "done",
  });
  node.running = step.state === "active";
  node.sublabel = step.state;
  // Stamped by the PlanStore on the transition (and by Claude's own task
  // clock when it mirrors one), so CHRONO can place the step on its axis
  // instead of guessing.
  if (step.startedAt !== undefined) {
    node.span = { from: step.startedAt, to: step.endedAt ?? null };
  }
  node.detail = [
    ...(step.description
      ? [{ label: "detail", value: step.description }]
      : []),
    { label: "state", value: step.state, tone },
    { label: "step", value: step.id },
    ...(plan.agentId ? [{ label: "agent", value: plan.agentId }] : []),
  ];
  if (step.state === "active") node.tags = ["running"];
  return node;
}

function buildSubagentNode(
  sub: { agentId: string; agentType: string; startedAt: number },
  parentId: string,
  now: () => number,
): AtlasNode {
  const node = makeNode({
    id: `${parentId}:sub:${sub.agentId}`,
    kind: "subagent",
    label: sub.agentType || "subagent",
    tone: "agent",
    parent: parentId,
  });
  node.running = true;
  node.sublabel = formatElapsed(now() - sub.startedAt);
  node.span = { from: sub.startedAt, to: null };
  node.detail = [
    { label: "type", value: sub.agentType },
    { label: "id", value: sub.agentId },
    { label: "running", value: formatElapsed(now() - sub.startedAt) },
  ];
  node.tags = ["agent", "running"];
  return node;
}

/** Nine characters is the badge budget; a status pill's value is written
 *  by a script that knows nothing about it. */
function truncateBadge(text: string): string {
  const t = text.trim();
  return t.length <= 9 ? t : t.slice(0, 8) + "…";
}
