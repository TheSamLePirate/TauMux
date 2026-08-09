/**
 * Agent-authored annotations on the Atlas graph.
 *
 * Everything else the graph draws is *observed* — CPU the poller read,
 * bytes the PTY emitted, phases Claude Code's hooks reported. This store
 * is the one channel where an agent says something about its own work
 * that no amount of observation would reveal: which pane matters right
 * now, what it is blocked on, how far through a job it is, and when a
 * milestone landed.
 *
 * Four verbs, deliberately few:
 *
 *   pin    — this node matters; keep it visible
 *   note   — one line of context on a node
 *   meter  — a named 0…1 progress reading
 *   mark   — a timestamped milestone on the activity river
 *
 * Keyed by *node id*, which is a surface id or a workspace id — the same
 * ids the graph already uses, so an annotation lands on the node the
 * caller means without a second addressing scheme.
 *
 * In-memory only. These describe live work, and a note about what a
 * session was blocked on an hour ago is worse than no note: it would
 * outlive its truth and there is no way to know it had.
 */

/** Marks older than this drop off the river, which shows ~90 s. */
const MARK_TTL_MS = 10 * 60_000;
/** Cap per target so a looping agent cannot grow this without bound. */
const MAX_METERS_PER_TARGET = 4;
const MAX_MARKS = 50;
const MAX_NOTE_CHARS = 200;

export interface AtlasMeter {
  key: string;
  /** 0…1, clamped on write. */
  value: number;
  label?: string;
}

export interface AtlasMark {
  id: string;
  at: number;
  text: string;
  target?: string;
  tone?: "info" | "ok" | "warn" | "err";
}

export interface AtlasAnnotation {
  target: string;
  pinned: boolean;
  note?: string;
  noteTone?: "info" | "ok" | "warn" | "err";
  meters: AtlasMeter[];
  updatedAt: number;
}

export interface AtlasAnnotationSnapshot {
  annotations: AtlasAnnotation[];
  marks: AtlasMark[];
}

type Listener = (snapshot: AtlasAnnotationSnapshot) => void;

export class AtlasAnnotationStore {
  private byTarget = new Map<string, AtlasAnnotation>();
  private marks: AtlasMark[] = [];
  private listeners = new Set<Listener>();
  private counter = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  pin(target: string, pinned = true): AtlasAnnotation {
    const entry = this.entry(target);
    entry.pinned = pinned;
    return this.commit(entry);
  }

  note(
    target: string,
    text: string,
    tone?: AtlasAnnotation["noteTone"],
  ): AtlasAnnotation {
    const entry = this.entry(target);
    const trimmed = text.trim().slice(0, MAX_NOTE_CHARS);
    if (trimmed) {
      entry.note = trimmed;
      if (tone) entry.noteTone = tone;
      else delete entry.noteTone;
    } else {
      delete entry.note;
      delete entry.noteTone;
    }
    return this.commit(entry);
  }

  meter(
    target: string,
    key: string,
    value: number,
    label?: string,
  ): AtlasAnnotation {
    const entry = this.entry(target);
    const clamped = Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : 0;
    const existing = entry.meters.find((m) => m.key === key);
    if (existing) {
      existing.value = clamped;
      if (label !== undefined) existing.label = label;
    } else {
      entry.meters.push({
        key,
        value: clamped,
        ...(label !== undefined ? { label } : {}),
      });
      // Oldest-out rather than refusing: an agent that publishes a fifth
      // meter means the fifth one, not "please ignore me".
      if (entry.meters.length > MAX_METERS_PER_TARGET) entry.meters.shift();
    }
    return this.commit(entry);
  }

  clearMeter(target: string, key: string): AtlasAnnotation {
    const entry = this.entry(target);
    entry.meters = entry.meters.filter((m) => m.key !== key);
    return this.commit(entry);
  }

  mark(text: string, opts: { target?: string; tone?: AtlasMark["tone"] } = {}) {
    const trimmed = text.trim().slice(0, MAX_NOTE_CHARS);
    if (!trimmed) return null;
    const entry: AtlasMark = {
      id: `mark:${++this.counter}`,
      at: this.now(),
      text: trimmed,
      ...(opts.target ? { target: opts.target } : {}),
      ...(opts.tone ? { tone: opts.tone } : {}),
    };
    this.marks.push(entry);
    if (this.marks.length > MAX_MARKS) this.marks.shift();
    this.emit();
    return entry;
  }

  /** Drop everything for one target, or everything everywhere. */
  clear(target?: string): void {
    if (target) {
      this.byTarget.delete(target);
      this.marks = this.marks.filter((m) => m.target !== target);
    } else {
      this.byTarget.clear();
      this.marks = [];
    }
    this.emit();
  }

  /** Forget a surface/workspace that no longer exists. */
  forget(target: string): void {
    if (!this.byTarget.has(target)) return;
    this.byTarget.delete(target);
    this.emit();
  }

  snapshot(): AtlasAnnotationSnapshot {
    this.pruneMarks();
    return {
      annotations: [...this.byTarget.values()].filter(
        (a) => a.pinned || a.note || a.meters.length > 0,
      ),
      marks: [...this.marks],
    };
  }

  private entry(target: string): AtlasAnnotation {
    let entry = this.byTarget.get(target);
    if (!entry) {
      entry = { target, pinned: false, meters: [], updatedAt: this.now() };
      this.byTarget.set(target, entry);
    }
    return entry;
  }

  private commit(entry: AtlasAnnotation): AtlasAnnotation {
    entry.updatedAt = this.now();
    // An entry carrying nothing is not an annotation — drop it so the
    // snapshot stays a list of things that are actually saying something.
    if (!entry.pinned && !entry.note && entry.meters.length === 0) {
      this.byTarget.delete(entry.target);
    }
    this.emit();
    return entry;
  }

  private pruneMarks(): void {
    const cutoff = this.now() - MARK_TTL_MS;
    const kept = this.marks.filter((m) => m.at >= cutoff);
    if (kept.length !== this.marks.length) this.marks = kept;
  }

  private emit(): void {
    this.pruneMarks();
    const snap = this.snapshot();
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch (err) {
        console.error("[atlas] annotation listener failed", err);
      }
    }
  }
}
