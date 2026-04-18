/**
 * Pure JSONL parsing and reduction for the screenshot index.
 * No filesystem access — callers own reading the file so the helpers
 * can be unit-tested against in-memory strings.
 */
import type { IndexEntry, Suite } from "./types";

/** Parse a JSONL buffer into `IndexEntry` objects, silently skipping
 *  malformed lines. Empty input → empty array. */
export function parseIndexLines(body: string): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as IndexEntry);
    } catch {
      /* malformed — skip */
    }
  }
  return out;
}

/** Reduce a list of entries to the newest entry per
 *  `(suite, spec, test, step)` tuple. Ties (or missing timestamps) keep
 *  whichever appeared last, matching the append-only JSONL semantics. */
export function latestPerKey(entries: IndexEntry[]): IndexEntry[] {
  const latest = new Map<string, IndexEntry>();
  for (const e of entries) {
    const suite: Suite = (e.suite ?? "native") as Suite;
    const key = `${suite}::${e.spec}::${e.test}::${e.step}`;
    const prior = latest.get(key);
    if (!prior) {
      latest.set(key, e);
      continue;
    }
    const priorTs = prior.timestamp ? Date.parse(prior.timestamp) : NaN;
    const curTs = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (Number.isNaN(priorTs) || (!Number.isNaN(curTs) && curTs >= priorTs)) {
      latest.set(key, e);
    }
  }
  return [...latest.values()];
}
