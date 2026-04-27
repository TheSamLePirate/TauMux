/**
 * Smart status-key parser (full v2).
 *
 * `ht set-status <key> <value> [--icon I] [--color C]` accepts an
 * opaque string body, but the *key name* carries rendering intent
 * encoded as a suffix DSL. This module is the single place that
 * translates the DSL into a structured `ParsedStatusKey` — consumed by
 * both the bottom status bar and the sidebar workspace card so they
 * render identical content with consistent semantics.
 *
 * Grammar (right-to-left):
 *
 *   _foo_bar_pct_warn
 *   ↑    ↑     ↑   ↑
 *   |    |     |   semantic colour token (optional, very last)
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
 * also deterministic: malformed input falls back to a `text` payload
 * (rendering the raw string) rather than throwing — scripts that
 * misformat their payload still get *something* in the bar.
 *
 * ## Catalogue (v2)
 *
 *   numeric:  text · longtext · code · num · count · pct · bytes · ms
 *             duration · currency · rating
 *   time:     time · eta · date · clock
 *   state:    bool · status · dot · badge
 *   chart:    bar · vbar · gauge · lineGraph · sparkline · area
 *             histogram · heatmap · dotGraph · pie · donut
 *   data:     array · kv · json · list · tags
 *   rich:     link · image · md · color · kbd · file
 */

/* ── Renderer ids + semantic palette ─────────────────────────── */

export type RendererId =
  // numeric
  | "text"
  | "longtext"
  | "code"
  | "num"
  | "count"
  | "pct"
  | "bytes"
  | "ms"
  | "duration"
  | "currency"
  | "rating"
  // time
  | "time"
  | "eta"
  | "date"
  | "clock"
  // state
  | "bool"
  | "status"
  | "dot"
  | "badge"
  // chart
  | "bar"
  | "vbar"
  | "gauge"
  | "lineGraph"
  | "sparkline"
  | "area"
  | "histogram"
  | "heatmap"
  | "dotGraph"
  | "pie"
  | "donut"
  // data
  | "array"
  | "kv"
  | "json"
  | "list"
  | "tags"
  // rich
  | "link"
  | "image"
  | "md"
  | "color"
  | "kbd"
  | "file";

export type SemanticToken = "ok" | "warn" | "err" | "info";

const RENDERER_IDS: ReadonlySet<RendererId> = new Set([
  "text",
  "longtext",
  "code",
  "num",
  "count",
  "pct",
  "bytes",
  "ms",
  "duration",
  "currency",
  "rating",
  "time",
  "eta",
  "date",
  "clock",
  "bool",
  "status",
  "dot",
  "badge",
  "bar",
  "vbar",
  "gauge",
  "lineGraph",
  "sparkline",
  "area",
  "histogram",
  "heatmap",
  "dotGraph",
  "pie",
  "donut",
  "array",
  "kv",
  "json",
  "list",
  "tags",
  "link",
  "image",
  "md",
  "color",
  "kbd",
  "file",
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
  // numeric / scalar
  text: "inline",
  longtext: "block",
  code: "inline",
  num: "inline",
  count: "inline",
  pct: "inline",
  bytes: "inline",
  ms: "inline",
  duration: "inline",
  currency: "inline",
  rating: "inline",
  // time
  time: "inline",
  eta: "inline",
  date: "inline",
  clock: "inline",
  // state
  bool: "inline",
  status: "inline",
  dot: "inline",
  badge: "inline",
  // charts — most are block-ish in card, but render compact in bar
  bar: "inline",
  vbar: "block",
  gauge: "block",
  lineGraph: "block",
  sparkline: "inline",
  area: "block",
  histogram: "block",
  heatmap: "block",
  dotGraph: "inline",
  pie: "block",
  donut: "block",
  // data
  array: "block",
  kv: "block",
  json: "block",
  list: "block",
  tags: "inline",
  // rich
  link: "inline",
  image: "block",
  md: "block",
  color: "inline",
  kbd: "inline",
  file: "inline",
};

export interface ParsedStatusKey {
  /** Original key as the script wrote it — useful for tooltips. */
  rawKey: string;
  /** Whether the leading `_` opt-out was present. Hidden keys are
   *  still rendered in the bottom bar (the bar is opt-in via the
   *  user's `statusBarKeys` setting); they just stay out of the
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
  /** Layout intent for the sidebar workspace card. */
  layout: "inline" | "block";
}

export function parseStatusKey(rawKey: string): ParsedStatusKey {
  const hidden = rawKey.startsWith("_");
  const stripped = hidden ? rawKey.slice(1) : rawKey;

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

  // Pull semantic from the very tail first (right-to-left).
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

  if (renderers.length === 0) renderers.push("text");

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

/* ── Body grammar — typed payload per renderer ───────────────── */

export interface PieSlice {
  label: string;
  value: number;
}
export interface KvPair {
  key: string;
  value: string;
}

export type ParsedBody =
  | { kind: "text"; value: string }
  | { kind: "longtext"; value: string }
  | { kind: "code"; value: string }
  | { kind: "num"; value: number; raw: string }
  | { kind: "count"; value: number; raw: string }
  | { kind: "pct"; value: number; raw: string }
  | { kind: "bytes"; value: number; raw: string }
  | { kind: "ms"; value: number; raw: string }
  | { kind: "duration"; seconds: number; raw: string }
  | { kind: "currency"; value: number; unit: string; raw: string }
  | { kind: "rating"; value: number; max: number; raw: string }
  | { kind: "time"; ts: number; raw: string }
  | { kind: "eta"; ts: number; raw: string }
  | { kind: "date"; ts: number; raw: string }
  | { kind: "clock"; ts: number; raw: string }
  | { kind: "bool"; value: boolean; raw: string }
  | { kind: "status"; state: string; message: string; raw: string }
  | { kind: "dot"; state: string; raw: string }
  | { kind: "badge"; value: string; raw: string }
  | { kind: "bar"; value: number; max: number; unit?: string; raw: string }
  | { kind: "vbar"; samples: number[]; raw: string }
  | { kind: "gauge"; value: number; max: number; unit?: string; raw: string }
  | { kind: "lineGraph"; samples: number[]; raw: string }
  | { kind: "sparkline"; samples: number[]; raw: string }
  | { kind: "area"; samples: number[]; raw: string }
  | { kind: "histogram"; samples: number[]; raw: string }
  | { kind: "heatmap"; samples: number[]; raw: string }
  | { kind: "dotGraph"; samples: number[]; raw: string }
  | { kind: "pie"; slices: PieSlice[]; raw: string }
  | { kind: "donut"; slices: PieSlice[]; raw: string }
  | { kind: "array"; rows: string[][]; raw: string }
  | { kind: "kv"; pairs: KvPair[]; raw: string }
  | { kind: "json"; value: unknown; raw: string }
  | { kind: "list"; items: string[]; raw: string }
  | { kind: "tags"; items: string[]; raw: string }
  | { kind: "link"; label: string; url: string }
  | { kind: "image"; src: string; alt: string }
  | { kind: "md"; value: string }
  | { kind: "color"; hex: string; raw: string }
  | { kind: "kbd"; keys: string[]; raw: string }
  | { kind: "file"; path: string; basename: string };

/** Parse `value` according to the primary renderer. Falls back to
 *  `{kind:"text"}` whenever the body doesn't match — never throws. */
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
    case "code":
      return { kind: "code", value: raw };
    case "num": {
      const n = Number(raw);
      if (Number.isFinite(n)) return { kind: "num", value: n, raw };
      return { kind: "text", value: raw };
    }
    case "count": {
      const n = Number(raw);
      if (Number.isFinite(n))
        return { kind: "count", value: Math.round(n), raw };
      return { kind: "text", value: raw };
    }
    case "pct": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { kind: "text", value: raw };
      const value = n > 0 && n < 1 ? n * 100 : n;
      return { kind: "pct", value: clamp(value, 0, 100), raw };
    }
    case "bytes": {
      const n = Number(raw);
      if (Number.isFinite(n)) return { kind: "bytes", value: n, raw };
      return { kind: "text", value: raw };
    }
    case "ms": {
      const n = Number(raw);
      if (Number.isFinite(n)) return { kind: "ms", value: n, raw };
      return { kind: "text", value: raw };
    }
    case "duration": {
      const n = Number(raw);
      if (Number.isFinite(n)) return { kind: "duration", seconds: n, raw };
      return { kind: "text", value: raw };
    }
    case "currency": {
      // `<value>` or `<value>|<unit>` (e.g. `42.50|USD`).
      const [vRaw, unit] = splitPipe(raw, 2);
      const n = Number(vRaw);
      if (!Number.isFinite(n)) return { kind: "text", value: raw };
      return { kind: "currency", value: n, unit: unit || "USD", raw };
    }
    case "rating": {
      // `<value>|<max>` or just `<value>` (max defaults to 5).
      const [vRaw, mRaw] = splitPipe(raw, 2);
      const v = Number(vRaw);
      if (!Number.isFinite(v)) return { kind: "text", value: raw };
      const m = Number(mRaw);
      const max = Number.isFinite(m) && m > 0 ? m : 5;
      return {
        kind: "rating",
        value: clamp(v, 0, max),
        max,
        raw,
      };
    }
    case "time": {
      const ts = parseTimestamp(raw);
      return ts === null
        ? { kind: "text", value: raw }
        : { kind: "time", ts, raw };
    }
    case "eta": {
      const ts = parseTimestamp(raw);
      return ts === null
        ? { kind: "text", value: raw }
        : { kind: "eta", ts, raw };
    }
    case "date": {
      const ts = parseTimestamp(raw);
      return ts === null
        ? { kind: "text", value: raw }
        : { kind: "date", ts, raw };
    }
    case "clock": {
      const ts = parseTimestamp(raw);
      return ts === null
        ? { kind: "text", value: raw }
        : { kind: "clock", ts, raw };
    }
    case "bool": {
      const lc = raw.trim().toLowerCase();
      if (["true", "yes", "y", "1", "on", "ok"].includes(lc))
        return { kind: "bool", value: true, raw };
      if (["false", "no", "n", "0", "off"].includes(lc))
        return { kind: "bool", value: false, raw };
      return { kind: "text", value: raw };
    }
    case "status": {
      // `<state>:<message>` or just `<state>`.
      const idx = raw.indexOf(":");
      if (idx > 0) {
        const state = raw.slice(0, idx).trim();
        const message = raw.slice(idx + 1).trim();
        return { kind: "status", state, message, raw };
      }
      return { kind: "status", state: raw.trim(), message: "", raw };
    }
    case "dot":
      return { kind: "dot", state: raw.trim(), raw };
    case "badge":
      return { kind: "badge", value: raw, raw };
    case "bar": {
      // `<value>` (max=100) or `<value>|<max>` or `<value>|<max>|<unit>`.
      const parts = splitPipe(raw, 3);
      const v = Number(parts[0]);
      if (!Number.isFinite(v)) return { kind: "text", value: raw };
      const m = Number(parts[1]);
      const max = Number.isFinite(m) && m > 0 ? m : 100;
      const unit = parts[2] || undefined;
      return { kind: "bar", value: clamp(v, 0, max), max, unit, raw };
    }
    case "vbar": {
      const samples = parseNumList(raw);
      if (samples.length === 0) return { kind: "text", value: raw };
      const capped = capSamples(samples, 64);
      return { kind: "vbar", samples: capped, raw };
    }
    case "gauge": {
      // `<value>` (max=100) or `<value>|<max>` or `<value>|<max>|<unit>`.
      const parts = splitPipe(raw, 3);
      const v = Number(parts[0]);
      if (!Number.isFinite(v)) return { kind: "text", value: raw };
      const m = Number(parts[1]);
      const max = Number.isFinite(m) && m > 0 ? m : 100;
      const unit = parts[2] || undefined;
      return { kind: "gauge", value: clamp(v, 0, max), max, unit, raw };
    }
    case "lineGraph": {
      const samples = parseNumList(raw);
      if (samples.length === 0) return { kind: "text", value: raw };
      return { kind: "lineGraph", samples: capSamples(samples, 256), raw };
    }
    case "sparkline": {
      const samples = parseNumList(raw);
      if (samples.length === 0) return { kind: "text", value: raw };
      return { kind: "sparkline", samples: capSamples(samples, 128), raw };
    }
    case "area": {
      const samples = parseNumList(raw);
      if (samples.length === 0) return { kind: "text", value: raw };
      return { kind: "area", samples: capSamples(samples, 256), raw };
    }
    case "histogram": {
      const samples = parseNumList(raw);
      if (samples.length === 0) return { kind: "text", value: raw };
      return { kind: "histogram", samples: capSamples(samples, 64), raw };
    }
    case "heatmap": {
      const samples = parseNumList(raw);
      if (samples.length === 0) return { kind: "text", value: raw };
      return { kind: "heatmap", samples: capSamples(samples, 256), raw };
    }
    case "dotGraph": {
      const samples = parseNumList(raw);
      if (samples.length === 0) return { kind: "text", value: raw };
      return { kind: "dotGraph", samples: capSamples(samples, 128), raw };
    }
    case "pie":
    case "donut": {
      const slices = parsePieSlices(raw);
      if (!slices) return { kind: "text", value: raw };
      return { kind: primary, slices, raw } as ParsedBody;
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
        // Single flat array → render each item as a one-cell row.
        if (Array.isArray(json)) {
          const rows = (json as unknown[]).map((cell) => [
            typeof cell === "string" ? cell : String(cell ?? ""),
          ]);
          return { kind: "array", rows, raw };
        }
      } catch {
        /* fall through */
      }
      return { kind: "text", value: raw };
    }
    case "kv": {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          const pairs: KvPair[] = Object.entries(
            obj as Record<string, unknown>,
          ).map(([k, v]) => ({
            key: k,
            value: stringifyKvValue(v),
          }));
          return { kind: "kv", pairs, raw };
        }
      } catch {
        /* fall through */
      }
      return { kind: "text", value: raw };
    }
    case "json": {
      try {
        const value = JSON.parse(raw);
        return { kind: "json", value, raw };
      } catch {
        return { kind: "text", value: raw };
      }
    }
    case "list": {
      const items = raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) return { kind: "text", value: raw };
      return { kind: "list", items, raw };
    }
    case "tags": {
      const items = raw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) return { kind: "text", value: raw };
      return { kind: "tags", items, raw };
    }
    case "link": {
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
    case "image": {
      // `<src>` or `<alt>|<src>`. Accept data:image/* and http(s).
      const idx = raw.indexOf("|");
      let alt = "";
      let src = raw.trim();
      if (idx >= 0) {
        alt = raw.slice(0, idx).trim();
        src = raw.slice(idx + 1).trim();
      }
      if (!isSafeImageSrc(src)) return { kind: "text", value: raw };
      return { kind: "image", src, alt };
    }
    case "md":
      return { kind: "md", value: raw };
    case "color": {
      const hex = parseColor(raw);
      if (hex === null) return { kind: "text", value: raw };
      return { kind: "color", hex, raw };
    }
    case "kbd": {
      const keys = raw
        .split(/[+\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (keys.length === 0) return { kind: "text", value: raw };
      return { kind: "kbd", keys, raw };
    }
    case "file": {
      const path = raw.trim();
      if (!path) return { kind: "text", value: raw };
      const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      const basename = idx >= 0 ? path.slice(idx + 1) : path;
      return { kind: "file", path, basename };
    }
  }
}

/* ── Helpers ─────────────────────────────────────────────────── */

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function splitPipe(raw: string, n: number): string[] {
  // Split by `|` into at most `n` parts (last one keeps trailing `|`s).
  const parts: string[] = [];
  let rest = raw;
  for (let i = 0; i < n - 1; i++) {
    const idx = rest.indexOf("|");
    if (idx < 0) {
      parts.push(rest);
      rest = "";
      break;
    }
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  if (rest.length > 0 || parts.length < n) parts.push(rest);
  return parts.map((s) => s.trim());
}

function parseNumList(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function capSamples(samples: number[], cap: number): number[] {
  return samples.length > cap ? samples.slice(-cap) : samples;
}

/** Parse the body of a pie/donut renderer.
 *  Accepts:
 *    1. JSON object `{label: number, …}`
 *    2. JSON array of `{label, value}` or `[label, value]` rows
 *    3. Comma list like `a:3,b:7,c:5`
 *  Returns null when the body is unparseable. */
function parsePieSlices(raw: string): PieSlice[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Try JSON first.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        const slices: PieSlice[] = [];
        for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0) slices.push({ label: k, value: n });
        }
        return slices.length > 0 ? slices : null;
      }
      if (Array.isArray(json)) {
        const slices: PieSlice[] = [];
        for (const item of json as unknown[]) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const o = item as Record<string, unknown>;
            const n = Number(o["value"]);
            if (Number.isFinite(n) && n >= 0)
              slices.push({ label: String(o["label"] ?? ""), value: n });
          } else if (Array.isArray(item) && item.length >= 2) {
            const n = Number(item[1]);
            if (Number.isFinite(n) && n >= 0)
              slices.push({ label: String(item[0]), value: n });
          }
        }
        return slices.length > 0 ? slices : null;
      }
    } catch {
      /* fall through */
    }
  }
  // `a:3,b:7` syntax.
  const slices: PieSlice[] = [];
  for (const seg of trimmed.split(",")) {
    const idx = seg.indexOf(":");
    if (idx <= 0) continue;
    const label = seg.slice(0, idx).trim();
    const n = Number(seg.slice(idx + 1).trim());
    if (label && Number.isFinite(n) && n >= 0) slices.push({ label, value: n });
  }
  return slices.length > 0 ? slices : null;
}

function stringifyKvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const COLOR_KEYWORDS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff5b5b",
  orange: "#ffa040",
  yellow: "#ffd84d",
  green: "#7be07b",
  cyan: "#6fe9ff",
  blue: "#6f9bff",
  purple: "#b48bff",
  magenta: "#ff7be0",
  pink: "#ff9ed1",
  gray: "#9aa3aa",
  grey: "#9aa3aa",
};

function parseColor(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t))
    return t.toLowerCase();
  if (/^rgba?\([^)]+\)$/i.test(t) || /^hsla?\([^)]+\)$/i.test(t)) return t;
  const kw = COLOR_KEYWORDS[t.toLowerCase()];
  return kw ?? null;
}

function isSafeImageSrc(src: string): boolean {
  if (!src) return false;
  if (/^https?:\/\//i.test(src)) return true;
  if (/^data:image\//i.test(src)) return true;
  return false;
}

/** Best-effort timestamp parser. Accepts:
 *  - epoch milliseconds (>1e12)
 *  - epoch seconds (10-digit integer)
 *  - ISO-8601 / anything Date.parse understands
 *  Returns null on anything else. */
function parseTimestamp(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
