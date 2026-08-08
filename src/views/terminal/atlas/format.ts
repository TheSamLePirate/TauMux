/**
 * Atlas formatters. Every string the graph shows passes through here so
 * abbreviation rules stay in one place and stay testable.
 *
 * House rule: a badge is at most 9 characters. Past that the column
 * wraps and the spine stops reading as a spine. Anything longer belongs
 * in the inspector, where there is room for a full value.
 */

/** Trailing path segment, with the parent when it fits: `web/src`. */
export function shortPath(path: string, segments = 2): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  return parts.slice(-segments).join("/");
}

/**
 * Basename of an argv[0] plus as many arguments as fit: `/usr/bin/bun
 * run dev` → `bun run dev`. Arguments matter here — `bun run dev` and
 * `bun run build` are different answers to "what is this pane doing",
 * and truncating to `bun run` answers nothing. Flags are dropped: they
 * are the part least likely to distinguish two panes.
 */
export function shortCommand(command: string, max = 22): string {
  if (!command) return "";
  const [argv0 = "", ...rest] = command.trim().split(/\s+/);
  const base = argv0.split("/").pop() || argv0;
  let out = base;
  for (const arg of rest) {
    if (arg.startsWith("-")) continue;
    const next = `${out} ${arg}`;
    if (next.length > max) break;
    out = next;
  }
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

/** `1.2 GB` / `340 MB` / `12 MB` from KB. */
export function formatMemory(kb: number): string {
  if (kb <= 0) return "";
  const mb = kb / 1024;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** CPU as an integer percentage. Sub-1 % reads as `<1%` rather than `0%`
 *  so a barely-alive process is distinguishable from a dead one. */
export function formatCpu(pct: number): string {
  if (pct <= 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

/** Elapsed wall clock as `1:07` / `12:04` / `1:22:10`. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Working tree has anything uncommitted. `GitInfo` reports the four
 *  counts separately; every consumer wants the single question. */
export function isDirty(git: {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
}): boolean {
  return git.staged + git.unstaged + git.untracked + git.conflicts > 0;
}

/**
 * Git ref for a badge: branch plus its divergence marks.
 * `main`, `main*` (dirty), `main↑2`, `feat/atlas↑1↓3*`.
 * The branch itself is truncated hard — divergence marks are the part
 * that changes, so they must never be the characters that get cut.
 */
export function formatGitBadge(git: {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
}): string {
  const marks =
    (git.ahead > 0 ? `↑${git.ahead}` : "") +
    (git.behind > 0 ? `↓${git.behind}` : "") +
    (isDirty(git) ? "*" : "");
  const room = Math.max(3, 9 - marks.length);
  const branch =
    git.branch.length > room ? git.branch.slice(0, room - 1) + "…" : git.branch;
  return branch + marks;
}

/** `$1.42`, or `$0.004` under a cent — a fraction of a cent still tells
 *  you a session is alive, and rounding it to `$0.00` does not. */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || usd <= 0) return "";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Model name trimmed to its distinguishing part: `Claude Sonnet 4.5` →
 *  `sonnet 4.5`. Vendor and product prefixes carry no information inside
 *  τ-mux — every model here is a Claude model. */
export function shortModel(name: string): string {
  if (!name) return "";
  return name
    .replace(/^claude[\s-]*/i, "")
    .replace(/[\s-]*\(.*\)$/, "")
    .trim()
    .toLowerCase();
}
