// τ-mux web mirror — read-only process aggregator.
//
// Pure transform: turns the per-surface process trees in AppState into
// a flat list of process rows ready for the Process Manager overlay.
// One row per pid; the row knows which surface owns it. Sorted by CPU
// descending so the busy processes float to the top — matching the
// native Process Manager UX in src/views/terminal/process-manager.ts.
//
// Pure on purpose so the heavy lifting (collection + sort) stays
// hermetically testable without spinning the DOM.

import type { SurfaceMetadata } from "../shared/types";

export interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
  cpu: number;
  rssKb: number;
  surfaceId: string;
  surfaceTitle: string;
  isShell: boolean;
  isForeground: boolean;
}

export interface ProcessTotals {
  /** Sum of `cpu` across every row. */
  cpu: number;
  /** Sum of `rssKb` across every row. */
  rssKb: number;
  /** Total row count. */
  count: number;
}

export interface AggregateInput {
  surfaces: Record<
    string,
    { id: string; title: string; metadata: SurfaceMetadata | null }
  >;
}

/** Flatten the per-surface trees into a single list, sorted by CPU
 *  descending. Stable sort: ties break on pid (low → high) so the row
 *  order doesn't shimmer between polls when CPU% lands at zero. */
export function aggregateProcesses(input: AggregateInput): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const sid in input.surfaces) {
    const s = input.surfaces[sid]!;
    const meta = s.metadata;
    if (!meta || !meta.tree) continue;
    for (const proc of meta.tree) {
      rows.push({
        pid: proc.pid,
        ppid: proc.ppid,
        command: proc.command,
        cpu: proc.cpu,
        rssKb: proc.rssKb,
        surfaceId: s.id,
        surfaceTitle: s.title || s.id,
        isShell: proc.pid === meta.pid,
        isForeground: proc.pid === meta.foregroundPid,
      });
    }
  }
  rows.sort((a, b) => {
    if (b.cpu !== a.cpu) return b.cpu - a.cpu;
    return a.pid - b.pid;
  });
  return rows;
}

/** Sum the rows for the overlay header. */
export function totalsForRows(rows: readonly ProcessRow[]): ProcessTotals {
  let cpu = 0;
  let rssKb = 0;
  for (const r of rows) {
    cpu += r.cpu;
    rssKb += r.rssKb;
  }
  return { cpu: Number(cpu.toFixed(1)), rssKb, count: rows.length };
}

/** Filter rows by a case-insensitive substring match against pid /
 *  command / surfaceTitle. An empty needle returns the input array
 *  unchanged so callers can blindly pipe through this without
 *  branching on "no filter". */
export function filterRows(
  rows: readonly ProcessRow[],
  needle: string,
): ProcessRow[] {
  const trimmed = needle.trim().toLowerCase();
  if (!trimmed) return rows.slice();
  return rows.filter((r) => {
    if (r.command.toLowerCase().includes(trimmed)) return true;
    if (r.surfaceTitle.toLowerCase().includes(trimmed)) return true;
    if (String(r.pid).includes(trimmed)) return true;
    return false;
  });
}

/** Format an RSS value for the row — KB up to 1024, otherwise MB. */
export function formatRss(rssKb: number): string {
  if (rssKb < 1024) return `${rssKb} KB`;
  const mb = rssKb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** Format a CPU value with one decimal place, no trailing zero. */
export function formatCpu(cpu: number): string {
  if (!Number.isFinite(cpu)) return "0";
  const r = Math.round(cpu * 10) / 10;
  return r === Math.trunc(r) ? `${r.toFixed(0)}` : `${r.toFixed(1)}`;
}
