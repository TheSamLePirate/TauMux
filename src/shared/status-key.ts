/**
 * Smart status-key parser.
 *
 * `ht set-status <key> <value>` accepts an opaque string body, but the
 * key name carries rendering intent encoded as a suffix DSL. This
 * module is the single place that translates the DSL into a
 * structured `ParsedStatusKey` — consumed by both the bottom status
 * bar and the sidebar workspace card so they render the same content
 * with consistent semantics.
 *
 * Grammar (right-to-left):
 *
 *   _foo_bar_pct_warn
 *   ↑    ↑     ↑   ↑
 *   |    |     |   semantic colour token (optional)
 *   |    |     renderer suffix(es), trailing
 *   |    display label (joined with spaces)
 *   leading _ → hidden from sidebar workspace card
 *
 * Multiple renderer suffixes compose: `cpu_hist_lineGraph_warn` =
 * line graph rendered in warn colour. Suffix matching is right-to-left
 * so unambiguous. Unknown suffixes are folded back into the display
 * label — `foo_unknown_pct` becomes `{displayName:"foo unknown", renderers:["pct"]}`.
 *
 * The parser is pure and deterministic. Body parsing per renderer is
 * also deterministic: malformed input falls back to `text` (rendering
 * the raw string) rather than throwing — scripts that misformat their
 * payload still get *something* in the bar.
 */

/** All renderer ids the v1 dispatcher knows. Adding a new renderer
 *  means adding it here AND adding a case in `parseRenderedBody` AND
 *  the matching DOM renderer. New ids do not require a parser change
 *  beyond inclusion in this set. */
export type RendererId =
  | "text"
  | "longtext"
  | "num"
  | "pct"
  | "lineGraph"
  | "array"
  | "link"
  | "time"
  | "eta";

/** Semantic colour tokens map to existing `--tau-*` palette vars at
 *  render time. Keep this list small; rendering modules reach for raw
 *  hex via `--color` if they need anything else. */
export type SemanticToken = "ok" | "warn" | "err" | "info";

const RENDERER_IDS: ReadonlySet<RendererId> = new Set([
  "text",
  "longtext",
  "num",
  "pct",
  "lineGraph",
  "array",
  "link",
  "time",
  "eta",
]);

const SEMANTIC_IDS: ReadonlySet<SemanticToken> = new Set([
  "ok",
  "warn",
  "err",
  "info",
]);

/** Layout intent each renderer prefers in the sidebar workspace card.
 *  The bottom status bar is always inline; sidebar respects the hint. */
const RENDERER_LAYOUT: Record<RendererId, "inline" | "block"> = {
  text: "inline",
  longtext: "block",
  num: "inline",
  pct: "inline",
  lineGraph: "block",
  array: "block",
  link: "inline",
  time: "inline",
  eta: "inline",
};

export interface ParsedStatusKey {
  /** The original key as the script wrote it. Useful for tooltips. */
  rawKey: string;
  /** Whether the leading `_` opt-out was present. Hidden keys are
   *  still rendered in the bottom bar (the bar is always opt-in via
   *  the user's `statusBarKeys` setting); they just stay out of the
   *  sidebar workspace card. */
  hidden: boolean;
  /** Human-friendly label (the underscore-stripped prefix, with
   *  remaining underscores rendered as spaces). Falls back to the raw
   *  key minus the leading `_` when there's no recognised suffix. */
  displayName: string;
  /** Trailing renderer suffixes in left-to-right order. The dispatcher
   *  picks the first id with a registered renderer; subsequent
   *  entries decorate (e.g. `lineGraph` first, semantic second). */
  renderers: RendererId[];
  /** Semantic colour token if present, else null. */
  semantic: SemanticToken | null;
  /** Layout intent for the sidebar workspace card. Inline when the
   *  primary renderer fits in a row; block when it needs vertical
   *  space (lineGraph, array, longtext). */
  layout: "inline" | "block";
}

/** Parse a `ht set-status` key into its DSL components. Pure / O(n)
 *  in the key length; safe to call on every render. */
export function parseStatusKey(rawKey: string): ParsedStatusKey {
  const hidden = rawKey.startsWith("_");
  const stripped = hidden ? rawKey.slice(1) : rawKey;

  // Empty after stripping `_` is degenerate — treat the whole thing as
  // a literal label so the user sees *something* instead of nothing.
  if (!stripped) {
    return {
      rawKey,
      hidden,
      displayName: rawKey,
      renderers: ["text"],
      semantic: null,
      layout: "inline",
    };
  }

  const parts = stripped.split("_");

  // Pull semantic from the very tail first (right-to-left): it sits
  // *after* renderer suffixes by convention (`*_pct_warn`).
  let semantic: SemanticToken | null = null;
  if (
    parts.length > 1 &&
    SEMANTIC_IDS.has(parts[parts.length - 1] as SemanticToken)
  ) {
    semantic = parts.pop() as SemanticToken;
  }

  // Then pull renderer suffixes off the tail until we hit a non-renderer.
  const renderers: RendererId[] = [];
  while (
    parts.length > 1 &&
    RENDERER_IDS.has(parts[parts.length - 1] as RendererId)
  ) {
    renderers.unshift(parts.pop() as RendererId);
  }

  // Default to text when no renderer suffix was present.
  if (renderers.length === 0) renderers.push("text");

  // What's left is the display label. Underscores → spaces so multi-
  // word labels (`build_step_pct` → "build step") stay readable.
  const displayName = parts.join(" ").trim() || stripped;

  const primary = renderers[0];
  const layout: "inline" | "block" = RENDERER_LAYOUT[primary] ?? "inline";

  return {
    rawKey,
    hidden,
    displayName,
    renderers,
    semantic,
    layout,
  };
}

/**
 * Body parsers — each returns a typed payload the renderer can use
 * directly. All gracefully fall back to a `text` shape when the body
 * doesn't match the expected grammar, so a misformatted payload never
 * blanks the entry.
 */

export type ParsedBody =
  | { kind: "text"; value: string }
  | { kind: "longtext"; value: string }
  | { kind: "num"; value: number; raw: string }
  | { kind: "pct"; value: number; raw: string } // 0..100
  | { kind: "lineGraph"; samples: number[]; raw: string }
  | { kind: "array"; rows: string[][]; raw: string }
  | { kind: "link"; label: string; url: string }
  | { kind: "time"; ts: number; raw: string }
  | { kind: "eta"; ts: number; raw: string };

/** Parse `value` according to the primary renderer. Falls through to
 *  `{kind:"text"}` whenever the body doesn't match — *never* throws. */
export function parseStatusBody(
  primary: RendererId,
  value: string,
): ParsedBody {
  const raw = value ?? "";
  switch (primary) {
    case "text":
      return { kind: "text", value: raw };
    case "longtext":
      return { kind: "longtext", value: raw };
    case "num": {
      const n = Number(raw);
      if (Number.isFinite(n)) return { kind: "num", value: n, raw };
      return { kind: "text", value: raw };
    }
    case "pct": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { kind: "text", value: raw };
      // Heuristic: strictly fractional (0 < n < 1) means the script
      // gave us a fraction; multiply for human-readable percent. 0
      // and 1 are ambiguous but common honest readings (0% / 1%); we
      // pick "1%" for `1` because that's almost always what scripts
      // mean when they emit `0..100` integers.
      const value = n > 0 && n < 1 ? n * 100 : n;
      return { kind: "pct", value: clamp(value, 0, 100), raw };
    }
    case "lineGraph": {
      // Comma list, optionally with whitespace; ignore non-numeric
      // entries so a stray header column doesn't break the chart.
      const samples = raw
        .split(/[,\s]+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));
      if (samples.length === 0) return { kind: "text", value: raw };
      // Cap to keep render cost bounded — a runaway script that
      // re-publishes thousands of samples shouldn't drag the UI down.
      const capped = samples.length > 256 ? samples.slice(-256) : samples;
      return { kind: "lineGraph", samples: capped, raw };
    }
    case "array": {
      try {
        const json = JSON.parse(raw);
        if (Array.isArray(json) && json.every((row) => Array.isArray(row))) {
          const rows = (json as unknown[][]).map((row) =>
            row.map((cell) =>
              typeof cell === "string" ? cell : String(cell ?? ""),
            ),
          );
          return { kind: "array", rows, raw };
        }
      } catch {
        /* not JSON — fall through */
      }
      return { kind: "text", value: raw };
    }
    case "link": {
      // `<label>|<url>` or just `<url>`.
      const idx = raw.indexOf("|");
      if (idx >= 0) {
        const label = raw.slice(0, idx).trim() || raw.slice(idx + 1).trim();
        const url = raw.slice(idx + 1).trim();
        if (url && /^https?:\/\//i.test(url)) {
          return { kind: "link", label, url };
        }
      }
      if (/^https?:\/\//i.test(raw.trim())) {
        const url = raw.trim();
        return { kind: "link", label: url, url };
      }
      return { kind: "text", value: raw };
    }
    case "time": {
      const ts = parseTimestamp(raw);
      if (ts === null) return { kind: "text", value: raw };
      return { kind: "time", ts, raw };
    }
    case "eta": {
      const ts = parseTimestamp(raw);
      if (ts === null) return { kind: "text", value: raw };
      return { kind: "eta", ts, raw };
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Best-effort timestamp parser. Accepts:
 *  - epoch milliseconds (10–13 digit integer)
 *  - ISO-8601 string (anything `Date.parse` understands)
 *  Returns null on anything else so callers can fall back to text. */
function parseTimestamp(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Pure integer → epoch (s or ms). Disambiguate by magnitude.
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    // > 1e12 → already ms; otherwise assume seconds.
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
