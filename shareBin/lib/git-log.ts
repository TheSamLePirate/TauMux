/**
 * git log → commit-graph parser for shareBin's `show_gitlog`.
 *
 * Two pieces:
 *
 *   - parseGitLog(rawText): parses the output of `git log
 *     --pretty=format:<RECORD>` where each commit is delimited by a
 *     unit separator (US, 0x1F) and each commit's fields are
 *     delimited by a record separator (RS, 0x1E). Subject lines are
 *     verbatim — no embedded JSON parsing — so commits with Markdown
 *     / JSON payloads parse cleanly.
 *
 *   - layoutGraph(commits): assigns each commit to a column ("rail")
 *     in a binary-tree-flavoured graph: parents that already have a
 *     rail keep it; new branches take the next free column. Returns
 *     a flat array of `GraphRow` objects matching the commit list.
 *
 * Pure functions; no `git` invocation. The script that calls these
 * is responsible for spawning `git log` and producing the raw text.
 */

export const GITLOG_FORMAT = "%H%x1e%h%x1e%P%x1e%an%x1e%ae%x1e%ad%x1e%s%x1f";

export interface GitCommit {
  /** Full SHA. */
  sha: string;
  /** Abbreviated SHA. */
  short: string;
  /** Parent SHAs (space-separated in raw input). */
  parents: string[];
  /** Author name. */
  author: string;
  /** Author email. */
  email: string;
  /** Author date (whatever format git gave us — ISO when caller
   *  passes `--date=iso-strict`). */
  date: string;
  /** Commit subject (first line of the message). */
  subject: string;
}

/** Parse the output of `git log --pretty=format:<GITLOG_FORMAT>` to
 *  a list of commits. Strips empty trailing entries from any
 *  leftover unit separator. */
export function parseGitLog(raw: string): GitCommit[] {
  const records = raw.split("\x1f");
  const commits: GitCommit[] = [];
  for (const rec of records) {
    const trimmed = rec.replace(/^\n+/, "");
    if (trimmed.length === 0) continue;
    const fields = trimmed.split("\x1e");
    if (fields.length < 7) continue;
    const [sha, short, parents, author, email, date, subject] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    commits.push({
      sha,
      short,
      parents: parents.length ? parents.split(" ").filter(Boolean) : [],
      author,
      email,
      date,
      subject,
    });
  }
  return commits;
}

// ── Graph layout ─────────────────────────────────────────────

export interface GraphRow {
  /** Commit at this row. */
  commit: GitCommit;
  /** Rail (column) the commit's marker sits in. */
  rail: number;
  /** Each entry: a rail occupied at this row's height, with the
   *  SHA the rail is currently waiting to draw. Used by the
   *  renderer to place vertical lines / merges. */
  rails: ({ sha: string } | null)[];
  /** True when this commit closes a merge of multiple parents
   *  (more than one parent into the rail). */
  isMerge: boolean;
}

/** Simple railroad-style layout. Walks commits in display order
 *  (newest first, as `git log` produces) and assigns the first
 *  parent of each commit to the same rail; secondary parents take
 *  the next free rail. */
export function layoutGraph(commits: GitCommit[]): GraphRow[] {
  // Each rail tracks the SHA the renderer is "waiting" to draw
  // — i.e., the next commit expected on that rail. When the
  // current commit's SHA matches a rail, we slot in.
  const rails: ({ sha: string } | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    // Find the first rail that's expecting this commit.
    let rail = rails.findIndex((r) => r?.sha === commit.sha);
    if (rail === -1) {
      // No rail expected this commit — start a new branch on the
      // first empty slot, or append a new rail.
      rail = rails.findIndex((r) => r === null);
      if (rail === -1) {
        rail = rails.length;
        rails.push(null);
      }
    }

    // Snapshot the rail state at this row before we mutate.
    const snapshot = rails.slice();
    snapshot[rail] = { sha: commit.sha };

    rows.push({
      commit,
      rail,
      rails: snapshot,
      isMerge: commit.parents.length > 1,
    });

    // Now project to next row: this commit's primary parent inherits
    // the rail; secondary parents allocate fresh rails. If no
    // parents (root commit), the rail closes.
    const [primary, ...secondaries] = commit.parents;
    rails[rail] = primary ? { sha: primary } : null;
    for (const p of secondaries) {
      // If a rail already expects this parent, skip — both branches
      // converge naturally on the next visit.
      if (rails.some((r) => r?.sha === p)) continue;
      const slot = rails.findIndex((r) => r === null);
      if (slot === -1) rails.push({ sha: p });
      else rails[slot] = { sha: p };
    }
    // Trim trailing nulls so the rail count doesn't grow unboundedly.
    while (rails.length > 0 && rails[rails.length - 1] === null) {
      rails.pop();
    }
  }

  return rows;
}

/** Convenience: maximum rail width across the graph. Used by the
 *  renderer to size the leading column. */
export function graphWidth(rows: GraphRow[]): number {
  let max = 0;
  for (const r of rows) max = Math.max(max, r.rails.length);
  return max;
}
