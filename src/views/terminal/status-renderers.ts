/**
 * Renderers for the smart status-key DSL (Plan #02).
 *
 * Given a `ParsedStatusKey` + raw value, `renderStatusEntry` returns
 * a single DOM element that visualises the entry. Both the bottom
 * status bar and the sidebar workspace card go through this dispatcher
 * so identical keys render identically in both places.
 *
 * Layout context:
 *   - "inline"   bottom status bar (always inline)
 *   - "block"    sidebar workspace card (block when the parsed key
 *                hints `layout: "block"`; inline otherwise)
 *
 * The bottom-bar renders use the existing `tau-status-kv` chrome so
 * they blend with the built-in keys (cpu / mem / fg / …). The sidebar
 * uses dedicated classes to allow richer multi-line layouts.
 *
 * Every renderer is total: a malformed body parsed back to `text`
 * still produces a sensible chip with the raw string.
 */

import type {
  ParsedBody,
  ParsedStatusKey,
  RendererId,
  SemanticToken,
} from "../../shared/status-key";
import { parseStatusBody } from "../../shared/status-key";
import { Meter } from "./tau-primitives";

export interface RenderEntryInput {
  /** Parsed key — display name, renderer chain, semantic, layout. */
  parsed: ParsedStatusKey;
  /** Raw value string the script wrote. */
  value: string;
  /** Optional script-supplied colour (CSS hex / token). Falls back to
   *  the parsed semantic when omitted. */
  color?: string;
  /** Optional icon hint from the script (currently unused — future). */
  icon?: string;
  /** Where the entry will live: `bar` clips to one row, `card` allows
   *  block renderers their full height. */
  context: "bar" | "card";
}

/** Public entry point. Picks a renderer based on
 *  `parsed.renderers[0]` and the layout context. */
export function renderStatusEntry(input: RenderEntryInput): HTMLElement {
  const { parsed, value, context, color, icon } = input;
  const primary = parsed.renderers[0] ?? "text";
  const body = parseStatusBody(primary, value);
  // If the body parser fell back to text (malformed input), force the
  // text renderer regardless of what the key claimed — never leave the
  // user staring at an empty chip.
  const effective: RendererId = body.kind === "text" ? "text" : primary;
  const useBlock =
    context === "card" &&
    parsed.layout === "block" &&
    blockRenderers.has(effective);
  const dom = useBlock
    ? renderBlock(parsed, body, effective)
    : renderInline(parsed, body, effective);
  applySemantic(dom, parsed.semantic, color);
  if (icon) dom.dataset["icon"] = icon;
  return dom;
}

const blockRenderers: ReadonlySet<RendererId> = new Set([
  "longtext",
  "lineGraph",
  "array",
]);

/* ── Inline renderers ───────────────────────────────────────── */

function renderInline(
  parsed: ParsedStatusKey,
  body: ParsedBody,
  effective: RendererId,
): HTMLElement {
  switch (effective) {
    case "text":
      return inlineKv(parsed.displayName, textValue(body));
    case "longtext":
      return inlineKv(parsed.displayName, truncate(textValue(body), 40));
    case "num":
      return inlineKv(
        parsed.displayName,
        body.kind === "num" ? formatNum(body.value) : textValue(body),
      );
    case "pct":
      if (body.kind !== "pct")
        return inlineKv(parsed.displayName, textValue(body));
      // Reuse the established Meter primitive so the bar matches
      // built-in keys (`cpu`, `mem`).
      return Meter({
        label: parsed.displayName,
        value: Math.round(body.value),
        max: 100,
        semantic: meterSemantic(parsed.semantic, body.value),
        width: 60,
        valueText: `${Math.round(body.value)}%`,
      });
    case "lineGraph":
      // Inline: tiny sparkline next to the label.
      if (body.kind !== "lineGraph") return inlineKv(parsed.displayName, "—");
      return inlineSparkline(parsed.displayName, body.samples);
    case "array":
      // Inline fallback (bar context only) — show the row count.
      if (body.kind !== "array") return inlineKv(parsed.displayName, "—");
      return inlineKv(parsed.displayName, `${body.rows.length} item(s)`);
    case "link":
      if (body.kind !== "link") return inlineKv(parsed.displayName, "—");
      return inlineLink(parsed.displayName, body.label, body.url);
    case "time":
      if (body.kind !== "time") return inlineKv(parsed.displayName, "—");
      return inlineKv(
        parsed.displayName,
        formatRelative(body.ts, /*future*/ false),
      );
    case "eta":
      if (body.kind !== "eta") return inlineKv(parsed.displayName, "—");
      return inlineKv(
        parsed.displayName,
        formatRelative(body.ts, /*future*/ true),
      );
  }
}

/* ── Block renderers ────────────────────────────────────────── */

function renderBlock(
  parsed: ParsedStatusKey,
  body: ParsedBody,
  effective: RendererId,
): HTMLElement {
  switch (effective) {
    case "longtext":
      return blockLongText(parsed.displayName, textValue(body));
    case "lineGraph":
      if (body.kind !== "lineGraph")
        return blockLongText(parsed.displayName, "—");
      return blockLineGraph(parsed.displayName, body.samples);
    case "array":
      if (body.kind !== "array") return blockLongText(parsed.displayName, "—");
      return blockArray(parsed.displayName, body.rows);
    default:
      // Fall through to inline — block was requested but renderer
      // doesn't support it.
      return renderInline(parsed, body, effective);
  }
}

/* ── Building blocks ────────────────────────────────────────── */

function inlineKv(label: string, value: string | number): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status";
  wrap.dataset["key"] = label;
  wrap.dataset["value"] = String(value);
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const v = document.createElement("span");
  v.className = "tau-status-value";
  v.textContent = String(value);
  wrap.appendChild(v);
  return wrap;
}

function inlineLink(label: string, text: string, url: string): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const a = document.createElement("a");
  a.className = "tau-status-value tau-status-link";
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  // Link is opened in the system browser via the existing
  // ht-open-url event so we honour the bun-side URL allowlist
  // (http(s) only).
  a.addEventListener("click", (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("ht-open-url", { detail: { url } }));
  });
  wrap.appendChild(a);
  return wrap;
}

function inlineSparkline(label: string, samples: number[]): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  wrap.appendChild(buildSparklineSvg(samples, { width: 80, height: 14 }));
  return wrap;
}

function blockLongText(label: string, text: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-longtext";
  const l = document.createElement("div");
  l.className = "tau-ht-block-label";
  l.textContent = label;
  wrap.appendChild(l);
  const v = document.createElement("div");
  v.className = "tau-ht-block-body";
  v.textContent = text;
  wrap.appendChild(v);
  return wrap;
}

function blockLineGraph(label: string, samples: number[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-lineGraph";
  const l = document.createElement("div");
  l.className = "tau-ht-block-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(buildSparklineSvg(samples, { width: 220, height: 36 }));
  // Min/max readout below the chart.
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const last = samples[samples.length - 1];
  const meta = document.createElement("div");
  meta.className = "tau-ht-block-meta";
  meta.textContent = `min ${formatNum(min)} · max ${formatNum(max)} · last ${formatNum(last)}`;
  wrap.appendChild(meta);
  return wrap;
}

function blockArray(label: string, rows: string[][]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-array";
  const l = document.createElement("div");
  l.className = "tau-ht-block-label";
  l.textContent = label;
  wrap.appendChild(l);
  const list = document.createElement("ul");
  list.className = "tau-ht-array-list";
  for (const row of rows) {
    const li = document.createElement("li");
    li.className = "tau-ht-array-row";
    // First cell is the description; second (if present) is a state
    // token that we colour-code (`done`/`active`/`waiting`/`err`).
    const desc = document.createElement("span");
    desc.className = "tau-ht-array-cell";
    desc.textContent = row[0] ?? "";
    li.appendChild(desc);
    for (let i = 1; i < row.length; i++) {
      const cell = document.createElement("span");
      const state = row[i] ?? "";
      cell.className = `tau-ht-array-state tau-ht-state-${stateClass(state)}`;
      cell.textContent = state;
      li.appendChild(cell);
    }
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

/* ── Helpers ─────────────────────────────────────────────────── */

function textValue(body: ParsedBody): string {
  switch (body.kind) {
    case "text":
    case "longtext":
      return body.value;
    case "num":
    case "pct":
    case "lineGraph":
    case "array":
    case "time":
    case "eta":
      return body.raw;
    case "link":
      return body.label;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1000) {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    return `${(n / 1000).toFixed(1)}k`;
  }
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function meterSemantic(
  semantic: SemanticToken | null,
  value: number,
): "ok" | "warn" | "err" {
  if (semantic === "warn") return "warn";
  if (semantic === "err") return "err";
  if (semantic === "ok" || semantic === "info") return "ok";
  // Fall back to value-driven thresholds so naked `cpu_pct` still
  // turns red as it climbs — matches the built-in cpu key.
  if (value > 80) return "err";
  if (value > 50) return "warn";
  return "ok";
}

function applySemantic(
  el: HTMLElement,
  semantic: SemanticToken | null,
  color?: string,
): void {
  if (semantic) el.dataset["semantic"] = semantic;
  if (color) {
    const v = el.querySelector<HTMLElement>(".tau-status-value");
    if (v) {
      v.style.color = resolveColor(color);
      v.style.fontWeight = "600";
    }
  }
}

function resolveColor(c: string): string {
  // Match the legacy keyword aliases the old renderHtEntry honoured
  // so we don't break scripts that pass `--color cyan`.
  const lc = c.toLowerCase();
  switch (lc) {
    case "cyan":
    case "human":
      return "var(--tau-cyan)";
    case "amber":
    case "agent":
      return "var(--tau-agent)";
    case "ok":
    case "green":
      return "var(--tau-ok)";
    case "warn":
    case "warning":
    case "yellow":
      return "var(--tau-warn)";
    case "err":
    case "error":
    case "red":
      return "var(--tau-err)";
    default:
      return c;
  }
}

function stateClass(state: string): string {
  const lc = state.trim().toLowerCase();
  if (lc === "done" || lc === "complete" || lc === "ok") return "done";
  if (lc === "active" || lc === "running" || lc === "wip") return "active";
  if (lc === "waiting" || lc === "pending" || lc === "todo") return "waiting";
  if (lc === "err" || lc === "error" || lc === "failed") return "err";
  return "neutral";
}

function buildSparklineSvg(
  samples: number[],
  opts: { width: number; height: number },
): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "tau-sparkline");
  svg.setAttribute("width", String(opts.width));
  svg.setAttribute("height", String(opts.height));
  svg.setAttribute("viewBox", `0 0 ${opts.width} ${opts.height}`);
  if (samples.length === 0) return svg;

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min || 1;
  const dx = samples.length > 1 ? opts.width / (samples.length - 1) : 0;
  const yFor = (v: number): number =>
    opts.height - ((v - min) / range) * (opts.height - 2) - 1;

  const points = samples
    .map((v, i) => `${(i * dx).toFixed(1)},${yFor(v).toFixed(1)}`)
    .join(" ");

  const polyline = document.createElementNS(NS, "polyline");
  polyline.setAttribute("points", points);
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "currentColor");
  polyline.setAttribute("stroke-width", "1.25");
  polyline.setAttribute("stroke-linejoin", "round");
  polyline.setAttribute("stroke-linecap", "round");
  svg.appendChild(polyline);
  return svg;
}

/** "5m ago" / "in 2h" relative formatter. `future=true` forces "in …"
 *  prefix even for negative deltas (so `eta` always reads as expected). */
function formatRelative(ts: number, future: boolean): string {
  const now = Date.now();
  const ms = future ? ts - now : now - ts;
  const sec = Math.floor(Math.abs(ms) / 1000);
  let body: string;
  if (sec < 60) body = `${sec}s`;
  else if (sec < 3600) body = `${Math.floor(sec / 60)}m`;
  else if (sec < 86400) body = `${Math.floor(sec / 3600)}h`;
  else body = `${Math.floor(sec / 86400)}d`;
  if (future) return ms >= 0 ? `in ${body}` : `${body} ago`;
  return ms >= 0 ? `${body} ago` : `in ${body}`;
}
