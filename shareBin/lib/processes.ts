/** Process-list parsing helpers for `shareBin/show_proc`. */

export interface ProcessRecord {
  pid: number;
  ppid: number;
  cpu: number;
  rssKb: number;
  comm: string;
  args: string;
}

export interface ProcessTreeRow extends ProcessRecord {
  depth: number;
  childCount: number;
}

export function parsePsProcesses(text: string): ProcessRecord[] {
  const out: ProcessRecord[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.,]+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!match) continue;
    out.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      cpu: Number((match[3] ?? "0").replace(",", ".")) || 0,
      rssKb: Number(match[4]) || 0,
      comm: match[5] ?? "",
      args: (match[6] ?? "").trim(),
    });
  }
  return out;
}

export function buildProcessTreeRows(
  processes: readonly ProcessRecord[],
  opts: { rootPid?: number; sortBy?: "tree" | "cpu" | "rss" | "name" } = {},
): ProcessTreeRow[] {
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]));
  const children = new Map<number, ProcessRecord[]>();
  for (const proc of processes) {
    const list = children.get(proc.ppid) ?? [];
    list.push(proc);
    children.set(proc.ppid, list);
  }
  for (const list of children.values()) list.sort(compareFor(opts.sortBy ?? "tree"));

  if (opts.sortBy && opts.sortBy !== "tree") {
    return [...processes]
      .sort(compareFor(opts.sortBy))
      .map((proc) => ({ ...proc, depth: 0, childCount: children.get(proc.pid)?.length ?? 0 }));
  }

  const roots = opts.rootPid !== undefined
    ? [byPid.get(opts.rootPid)].filter((p): p is ProcessRecord => Boolean(p))
    : processes.filter((proc) => !byPid.has(proc.ppid) || proc.ppid === 0);

  const rows: ProcessTreeRow[] = [];
  const seen = new Set<number>();
  function visit(proc: ProcessRecord, depth: number): void {
    if (seen.has(proc.pid)) return;
    seen.add(proc.pid);
    const kids = children.get(proc.pid) ?? [];
    rows.push({ ...proc, depth, childCount: kids.length });
    for (const child of kids) visit(child, depth + 1);
  }
  for (const root of roots.sort(compareFor("tree"))) visit(root, 0);
  for (const proc of processes.sort(compareFor("tree"))) {
    if (!seen.has(proc.pid)) visit(proc, 0);
  }
  return rows;
}

export function formatRss(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GiB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MiB`;
  return `${kb} KiB`;
}

function compareFor(sortBy: "tree" | "cpu" | "rss" | "name"): (a: ProcessRecord, b: ProcessRecord) => number {
  if (sortBy === "cpu") return (a, b) => b.cpu - a.cpu || a.comm.localeCompare(b.comm) || a.pid - b.pid;
  if (sortBy === "rss") return (a, b) => b.rssKb - a.rssKb || a.comm.localeCompare(b.comm) || a.pid - b.pid;
  if (sortBy === "name") return (a, b) => a.comm.localeCompare(b.comm) || a.pid - b.pid;
  return (a, b) => a.comm.localeCompare(b.comm) || a.pid - b.pid;
}
