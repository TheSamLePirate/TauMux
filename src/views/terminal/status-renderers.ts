/**
 * Renderers for the smart status-key DSL — full v2.
 *
 * Given a `ParsedStatusKey` + raw value, `renderStatusEntry` returns
 * a single DOM element that visualises the entry. Both the bottom
 * status bar and the sidebar workspace card go through this dispatcher
 * so identical keys render identically in both places.
 *
 * Layout context:
 *   - "bar"   bottom status bar — always inline / single row.
 *   - "card"  sidebar workspace card — block when `parsed.layout` says
 *             so AND the renderer has a block variant; otherwise inline.
 *
 * Every renderer is total: malformed input is parsed back to `text`
 * by the body parser and the dispatcher falls through to the text
 * renderer. No throws, never blanks the chip.
 *
 * Catalogue (v2):
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

import type {
  KvPair,
  ParsedBody,
  ParsedStatusKey,
  PieSlice,
  RendererId,
  SemanticToken,
} from "../../shared/status-key";
import { parseStatusBody } from "../../shared/status-key";
import { Meter } from "./tau-primitives";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface RenderEntryInput {
  parsed: ParsedStatusKey;
  value: string;
  /** Optional script-supplied colour. Falls back to the parsed
   *  semantic when omitted. Accepts hex, rgb(a), hsl(a), keyword
   *  aliases (`cyan`, `agent`, `ok`, `warn`, `err`, etc.). */
  color?: string;
  /** Optional icon hint from the script. Stored on `data-icon` for
   *  CSS / future glyph rendering; renderers that have a natural icon
   *  slot (status, badge, file, link) will consume it inline. */
  icon?: string;
  /** Where the entry will live. */
  context: "bar" | "card";
}

export function renderStatusEntry(input: RenderEntryInput): HTMLElement {
  const { parsed, value, context, color, icon } = input;
  const primary = parsed.renderers[0] ?? "text";
  const body = parseStatusBody(primary, value);
  // If the body parser fell back to text (malformed), force the text
  // renderer regardless of what the key claimed.
  const effective: RendererId = body.kind === "text" ? "text" : primary;
  const useBlock =
    context === "card" &&
    parsed.layout === "block" &&
    BLOCK_RENDERERS.has(effective);
  const dom = useBlock
    ? renderBlock(parsed, body, effective, icon)
    : renderInline(parsed, body, effective, icon);
  applySemantic(dom, parsed.semantic, color);
  if (icon) dom.dataset["icon"] = icon;
  return dom;
}

const BLOCK_RENDERERS: ReadonlySet<RendererId> = new Set([
  "longtext",
  "lineGraph",
  "array",
  "kv",
  "json",
  "list",
  "vbar",
  "gauge",
  "area",
  "histogram",
  "heatmap",
  "pie",
  "donut",
  "image",
  "md",
]);

/* ── Inline dispatcher ───────────────────────────────────────── */

function renderInline(
  parsed: ParsedStatusKey,
  body: ParsedBody,
  effective: RendererId,
  icon: string | undefined,
): HTMLElement {
  switch (effective) {
    case "text":
      return inlineKv(parsed.displayName, textValue(body), icon);
    case "longtext":
      return inlineKv(parsed.displayName, truncate(textValue(body), 40), icon);
    case "code":
      return inlineCode(parsed.displayName, textValue(body));
    case "num":
      return inlineKv(
        parsed.displayName,
        body.kind === "num" ? formatNum(body.value) : textValue(body),
        icon,
      );
    case "count":
      return inlineKv(
        parsed.displayName,
        body.kind === "count" ? formatCount(body.value) : textValue(body),
        icon,
      );
    case "pct":
      if (body.kind !== "pct")
        return inlineKv(parsed.displayName, textValue(body), icon);
      return Meter({
        label: parsed.displayName,
        value: Math.round(body.value),
        max: 100,
        semantic: meterSemantic(parsed.semantic, body.value, 100),
        width: 60,
        valueText: `${Math.round(body.value)}%`,
      });
    case "bytes":
      return inlineKv(
        parsed.displayName,
        body.kind === "bytes" ? formatBytes(body.value) : textValue(body),
        icon,
      );
    case "ms":
      return inlineKv(
        parsed.displayName,
        body.kind === "ms" ? formatMs(body.value) : textValue(body),
        icon,
      );
    case "duration":
      return inlineKv(
        parsed.displayName,
        body.kind === "duration"
          ? formatDuration(body.seconds)
          : textValue(body),
        icon,
      );
    case "currency":
      return inlineKv(
        parsed.displayName,
        body.kind === "currency"
          ? formatCurrency(body.value, body.unit)
          : textValue(body),
        icon,
      );
    case "rating":
      if (body.kind !== "rating")
        return inlineKv(parsed.displayName, "—", icon);
      return inlineRating(parsed.displayName, body.value, body.max);
    case "time":
      if (body.kind !== "time") return inlineKv(parsed.displayName, "—", icon);
      return inlineKv(parsed.displayName, formatRelative(body.ts, false), icon);
    case "eta":
      if (body.kind !== "eta") return inlineKv(parsed.displayName, "—", icon);
      return inlineKv(parsed.displayName, formatRelative(body.ts, true), icon);
    case "date":
      if (body.kind !== "date") return inlineKv(parsed.displayName, "—", icon);
      return inlineKv(parsed.displayName, formatDate(body.ts), icon);
    case "clock":
      if (body.kind !== "clock") return inlineKv(parsed.displayName, "—", icon);
      return inlineKv(parsed.displayName, formatClock(body.ts), icon);
    case "bool":
      if (body.kind !== "bool") return inlineKv(parsed.displayName, "—", icon);
      return inlineBool(parsed.displayName, body.value);
    case "status":
      if (body.kind !== "status")
        return inlineKv(parsed.displayName, "—", icon);
      return inlineStatus(parsed.displayName, body.state, body.message, icon);
    case "dot":
      if (body.kind !== "dot") return inlineKv(parsed.displayName, "—", icon);
      return inlineDot(parsed.displayName, body.state);
    case "badge":
      if (body.kind !== "badge") return inlineKv(parsed.displayName, "—", icon);
      return inlineBadge(parsed.displayName, body.value, icon);
    case "bar":
      if (body.kind !== "bar")
        return inlineKv(parsed.displayName, textValue(body), icon);
      return Meter({
        label: parsed.displayName,
        value: body.value,
        max: body.max,
        semantic: meterSemantic(parsed.semantic, body.value, body.max),
        width: 70,
        valueText: formatBarValue(body.value, body.max, body.unit),
      });
    case "vbar":
      if (body.kind !== "vbar") return inlineKv(parsed.displayName, "—", icon);
      return inlineVbar(parsed.displayName, body.samples);
    case "gauge":
      if (body.kind !== "gauge") return inlineKv(parsed.displayName, "—", icon);
      return inlineGauge(parsed.displayName, body.value, body.max, body.unit);
    case "lineGraph":
      if (body.kind !== "lineGraph")
        return inlineKv(parsed.displayName, "—", icon);
      return inlineSparkline(parsed.displayName, body.samples);
    case "sparkline":
      if (body.kind !== "sparkline")
        return inlineKv(parsed.displayName, "—", icon);
      return inlineSparkline(parsed.displayName, body.samples);
    case "area":
      if (body.kind !== "area") return inlineKv(parsed.displayName, "—", icon);
      return inlineSparkline(parsed.displayName, body.samples, /*area*/ true);
    case "histogram":
      if (body.kind !== "histogram")
        return inlineKv(parsed.displayName, "—", icon);
      return inlineVbar(parsed.displayName, body.samples);
    case "heatmap":
      if (body.kind !== "heatmap")
        return inlineKv(parsed.displayName, "—", icon);
      return inlineHeatmap(parsed.displayName, body.samples);
    case "dotGraph":
      if (body.kind !== "dotGraph")
        return inlineKv(parsed.displayName, "—", icon);
      return inlineDotGraph(parsed.displayName, body.samples);
    case "pie":
    case "donut":
      if (body.kind !== "pie" && body.kind !== "donut")
        return inlineKv(parsed.displayName, "—", icon);
      return inlinePie(parsed.displayName, body.slices, effective === "donut");
    case "array":
      if (body.kind !== "array") return inlineKv(parsed.displayName, "—", icon);
      return inlineKv(parsed.displayName, `${body.rows.length} item(s)`, icon);
    case "kv":
      if (body.kind !== "kv") return inlineKv(parsed.displayName, "—", icon);
      return inlineKv(parsed.displayName, `${body.pairs.length} pair(s)`, icon);
    case "json":
      if (body.kind !== "json")
        return inlineKv(parsed.displayName, textValue(body), icon);
      return inlineKv(parsed.displayName, truncate(body.raw, 32), icon);
    case "list":
      if (body.kind !== "list") return inlineKv(parsed.displayName, "—", icon);
      return inlineKv(parsed.displayName, body.items.join(", "), icon);
    case "tags":
      if (body.kind !== "tags") return inlineKv(parsed.displayName, "—", icon);
      return inlineTags(parsed.displayName, body.items);
    case "link":
      if (body.kind !== "link") return inlineKv(parsed.displayName, "—", icon);
      return inlineLink(parsed.displayName, body.label, body.url);
    case "image":
      if (body.kind !== "image") return inlineKv(parsed.displayName, "—", icon);
      return inlineImage(
        parsed.displayName,
        body.src,
        body.alt,
        /*small*/ true,
      );
    case "md":
      if (body.kind !== "md")
        return inlineKv(parsed.displayName, textValue(body), icon);
      return inlineKv(parsed.displayName, truncate(body.value, 40), icon);
    case "color":
      if (body.kind !== "color") return inlineKv(parsed.displayName, "—", icon);
      return inlineColor(parsed.displayName, body.hex);
    case "kbd":
      if (body.kind !== "kbd") return inlineKv(parsed.displayName, "—", icon);
      return inlineKbd(parsed.displayName, body.keys);
    case "file":
      if (body.kind !== "file") return inlineKv(parsed.displayName, "—", icon);
      return inlineFile(parsed.displayName, body.path, body.basename);
  }
}

/* ── Block dispatcher ────────────────────────────────────────── */

function renderBlock(
  parsed: ParsedStatusKey,
  body: ParsedBody,
  effective: RendererId,
  icon: string | undefined,
): HTMLElement {
  switch (effective) {
    case "longtext":
      return blockLongText(parsed.displayName, textValue(body));
    case "lineGraph":
      if (body.kind !== "lineGraph")
        return blockLongText(parsed.displayName, "—");
      return blockLineGraph(parsed.displayName, body.samples, /*area*/ false);
    case "area":
      if (body.kind !== "area") return blockLongText(parsed.displayName, "—");
      return blockLineGraph(parsed.displayName, body.samples, /*area*/ true);
    case "vbar":
      if (body.kind !== "vbar") return blockLongText(parsed.displayName, "—");
      return blockVbar(parsed.displayName, body.samples);
    case "histogram":
      if (body.kind !== "histogram")
        return blockLongText(parsed.displayName, "—");
      return blockVbar(parsed.displayName, body.samples);
    case "gauge":
      if (body.kind !== "gauge") return blockLongText(parsed.displayName, "—");
      return blockGauge(
        parsed.displayName,
        body.value,
        body.max,
        body.unit,
        parsed.semantic,
      );
    case "heatmap":
      if (body.kind !== "heatmap")
        return blockLongText(parsed.displayName, "—");
      return blockHeatmap(parsed.displayName, body.samples);
    case "pie":
    case "donut":
      if (body.kind !== "pie" && body.kind !== "donut")
        return blockLongText(parsed.displayName, "—");
      return blockPie(parsed.displayName, body.slices, effective === "donut");
    case "array":
      if (body.kind !== "array") return blockLongText(parsed.displayName, "—");
      return blockArray(parsed.displayName, body.rows);
    case "kv":
      if (body.kind !== "kv") return blockLongText(parsed.displayName, "—");
      return blockKv(parsed.displayName, body.pairs);
    case "json":
      if (body.kind !== "json")
        return blockLongText(parsed.displayName, textValue(body));
      return blockJson(parsed.displayName, body.value);
    case "list":
      if (body.kind !== "list") return blockLongText(parsed.displayName, "—");
      return blockList(parsed.displayName, body.items);
    case "image":
      if (body.kind !== "image") return blockLongText(parsed.displayName, "—");
      return blockImage(parsed.displayName, body.src, body.alt);
    case "md":
      if (body.kind !== "md")
        return blockLongText(parsed.displayName, textValue(body));
      return blockMd(parsed.displayName, body.value);
    default:
      return renderInline(parsed, body, effective, icon);
  }
}

/* ── Inline building blocks ──────────────────────────────────── */

function inlineKv(
  label: string,
  value: string | number,
  icon?: string,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status";
  wrap.dataset["key"] = label;
  wrap.dataset["value"] = String(value);
  if (icon) appendIcon(wrap, icon);
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

function inlineCode(label: string, value: string): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status tau-ht-code-wrap";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const code = document.createElement("code");
  code.className = "tau-ht-code";
  code.textContent = truncate(value, 60);
  wrap.appendChild(code);
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
  a.addEventListener("click", (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("ht-open-url", { detail: { url } }));
  });
  wrap.appendChild(a);
  return wrap;
}

function inlineSparkline(
  label: string,
  samples: number[],
  area = false,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  wrap.appendChild(buildSparklineSvg(samples, { width: 80, height: 14, area }));
  return wrap;
}

function inlineRating(
  label: string,
  value: number,
  max: number,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status tau-ht-rating";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const stars = document.createElement("span");
  stars.className = "tau-ht-rating-stars";
  const filled = Math.round(value);
  for (let i = 0; i < max; i++) {
    const star = document.createElement("span");
    star.className = "tau-ht-rating-star" + (i < filled ? " is-filled" : "");
    star.appendChild(buildStarSvg(i < filled));
    stars.appendChild(star);
  }
  wrap.appendChild(stars);
  const v = document.createElement("span");
  v.className = "tau-status-value tau-ht-rating-value";
  v.textContent = `${formatNum(value)}/${max}`;
  wrap.appendChild(v);
  return wrap;
}

function inlineBool(label: string, value: boolean): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = `tau-status-kv tau-ht-status tau-ht-bool ${value ? "is-true" : "is-false"}`;
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const v = document.createElement("span");
  v.className = "tau-status-value tau-ht-bool-value";
  v.textContent = value ? "yes" : "no";
  wrap.appendChild(v);
  return wrap;
}

function inlineStatus(
  label: string,
  state: string,
  message: string,
  icon: string | undefined,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = `tau-status-kv tau-ht-status tau-ht-status-pill tau-ht-state-${stateClass(state)}`;
  if (icon) appendIcon(wrap, icon);
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const dot = document.createElement("span");
  dot.className = "tau-ht-status-dot";
  wrap.appendChild(dot);
  wrap.appendChild(document.createTextNode(" "));
  const v = document.createElement("span");
  v.className = "tau-status-value";
  v.textContent = message ? `${state}: ${message}` : state;
  wrap.appendChild(v);
  return wrap;
}

function inlineDot(label: string, state: string): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = `tau-status-kv tau-ht-status tau-ht-dot-wrap tau-ht-state-${stateClass(state)}`;
  const dot = document.createElement("span");
  dot.className = "tau-ht-dot";
  wrap.appendChild(dot);
  wrap.appendChild(document.createTextNode(" "));
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  if (state) {
    wrap.appendChild(document.createTextNode(" "));
    const v = document.createElement("span");
    v.className = "tau-status-value";
    v.textContent = state;
    wrap.appendChild(v);
  }
  return wrap;
}

function inlineBadge(
  label: string,
  value: string,
  icon: string | undefined,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const badge = document.createElement("span");
  badge.className = "tau-ht-badge";
  if (icon) {
    const ic = document.createElement("span");
    ic.className = "tau-ht-badge-icon";
    ic.textContent = icon;
    badge.appendChild(ic);
  }
  const text = document.createElement("span");
  text.className = "tau-ht-badge-text";
  text.textContent = value;
  badge.appendChild(text);
  wrap.appendChild(badge);
  return wrap;
}

function inlineVbar(label: string, samples: number[]): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  wrap.appendChild(
    buildVbarSvg(samples, {
      width: Math.min(120, samples.length * 4),
      height: 14,
    }),
  );
  return wrap;
}

function inlineGauge(
  label: string,
  value: number,
  max: number,
  unit: string | undefined,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status tau-ht-gauge-inline";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  wrap.appendChild(buildGaugeSvg(value, max, { width: 38, height: 22 }));
  const v = document.createElement("span");
  v.className = "tau-status-value tau-ht-gauge-readout";
  v.textContent = formatBarValue(value, max, unit);
  wrap.appendChild(v);
  return wrap;
}

function inlineHeatmap(label: string, samples: number[]): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  wrap.appendChild(buildHeatmapStrip(samples, { width: 120, height: 12 }));
  return wrap;
}

function inlineDotGraph(label: string, samples: number[]): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status tau-ht-dotgraph";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const dots = document.createElement("span");
  dots.className = "tau-ht-dotgraph-dots";
  for (const s of samples) {
    const dot = document.createElement("span");
    dot.className =
      "tau-ht-dotgraph-dot " +
      (s > 0.66 ? "is-on" : s > 0.33 ? "is-mid" : s > 0 ? "is-low" : "is-off");
    dots.appendChild(dot);
  }
  wrap.appendChild(dots);
  return wrap;
}

function inlinePie(
  label: string,
  slices: PieSlice[],
  donut: boolean,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status tau-ht-pie-inline";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  wrap.appendChild(buildPieSvg(slices, { size: 16, donut }));
  const total = slices.reduce((a, s) => a + s.value, 0);
  const top = slices.reduce((a, s) => (s.value > a.value ? s : a), {
    label: "",
    value: -Infinity,
  } as PieSlice);
  const v = document.createElement("span");
  v.className = "tau-status-value";
  v.textContent =
    total > 0 ? `${top.label} ${Math.round((top.value / total) * 100)}%` : "—";
  wrap.appendChild(v);
  return wrap;
}

function inlineTags(label: string, items: string[]): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status tau-ht-tags-wrap";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  for (const t of items.slice(0, 12)) {
    const tag = document.createElement("span");
    tag.className = "tau-ht-tag";
    tag.textContent = t;
    wrap.appendChild(tag);
  }
  if (items.length > 12) {
    const more = document.createElement("span");
    more.className = "tau-ht-tag tau-ht-tag-more";
    more.textContent = `+${items.length - 12}`;
    wrap.appendChild(more);
  }
  return wrap;
}

function inlineImage(
  label: string,
  src: string,
  alt: string,
  small: boolean,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const img = document.createElement("img");
  img.className = small ? "tau-ht-image-inline" : "tau-ht-image";
  img.src = src;
  img.alt = alt || label;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  wrap.appendChild(img);
  return wrap;
}

function inlineColor(label: string, hex: string): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status tau-ht-color-wrap";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const swatch = document.createElement("span");
  swatch.className = "tau-ht-color-swatch";
  swatch.style.background = hex;
  wrap.appendChild(swatch);
  wrap.appendChild(document.createTextNode(" "));
  const v = document.createElement("code");
  v.className = "tau-status-value tau-ht-color-hex";
  v.textContent = hex;
  wrap.appendChild(v);
  return wrap;
}

function inlineKbd(label: string, keys: string[]): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status tau-ht-kbd-wrap";
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  keys.forEach((k, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "tau-ht-kbd-sep";
      sep.textContent = "+";
      wrap.appendChild(sep);
    }
    const kbd = document.createElement("kbd");
    kbd.className = "tau-ht-kbd";
    kbd.textContent = k;
    wrap.appendChild(kbd);
  });
  return wrap;
}

function inlineFile(
  label: string,
  path: string,
  basename: string,
): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv tau-ht-status tau-ht-file";
  wrap.title = path;
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const file = document.createElement("code");
  file.className = "tau-status-value tau-ht-file-name";
  file.textContent = basename;
  wrap.appendChild(file);
  return wrap;
}

/* ── Block building blocks ───────────────────────────────────── */

function blockLongText(label: string, text: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-longtext";
  appendBlockLabel(wrap, label);
  const v = document.createElement("div");
  v.className = "tau-ht-block-body";
  v.textContent = text;
  wrap.appendChild(v);
  return wrap;
}

function blockLineGraph(
  label: string,
  samples: number[],
  area: boolean,
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-lineGraph";
  appendBlockLabel(wrap, label);
  wrap.appendChild(
    buildSparklineSvg(samples, { width: 220, height: 36, area }),
  );
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const last = samples[samples.length - 1];
  const meta = document.createElement("div");
  meta.className = "tau-ht-block-meta";
  meta.textContent = `min ${formatNum(min)} · max ${formatNum(max)} · last ${formatNum(last)}`;
  wrap.appendChild(meta);
  return wrap;
}

function blockVbar(label: string, samples: number[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-vbar";
  appendBlockLabel(wrap, label);
  wrap.appendChild(
    buildVbarSvg(samples, {
      width: Math.min(220, Math.max(60, samples.length * 8)),
      height: 36,
    }),
  );
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const meta = document.createElement("div");
  meta.className = "tau-ht-block-meta";
  meta.textContent = `n ${samples.length} · min ${formatNum(min)} · max ${formatNum(max)}`;
  wrap.appendChild(meta);
  return wrap;
}

function blockGauge(
  label: string,
  value: number,
  max: number,
  unit: string | undefined,
  semantic: SemanticToken | null,
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-gauge";
  appendBlockLabel(wrap, label);
  const sem = meterSemantic(semantic, value, max);
  const svg = buildGaugeSvg(value, max, { width: 120, height: 70 });
  svg.classList.add(`tau-ht-gauge-${sem}`);
  wrap.appendChild(svg);
  const meta = document.createElement("div");
  meta.className = "tau-ht-block-meta tau-ht-gauge-readout";
  meta.textContent = formatBarValue(value, max, unit);
  wrap.appendChild(meta);
  return wrap;
}

function blockHeatmap(label: string, samples: number[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-heatmap";
  appendBlockLabel(wrap, label);
  wrap.appendChild(
    buildHeatmapStrip(samples, { width: 220, height: 16, gridded: true }),
  );
  return wrap;
}

function blockPie(
  label: string,
  slices: PieSlice[],
  donut: boolean,
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-pie";
  appendBlockLabel(wrap, label);
  const row = document.createElement("div");
  row.className = "tau-ht-pie-row";
  row.appendChild(buildPieSvg(slices, { size: 64, donut }));
  const legend = document.createElement("ul");
  legend.className = "tau-ht-pie-legend";
  const total = slices.reduce((a, s) => a + s.value, 0);
  slices.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "tau-ht-pie-legend-item";
    const sw = document.createElement("span");
    sw.className = "tau-ht-pie-swatch";
    sw.style.background = pieColor(i);
    li.appendChild(sw);
    const label = document.createElement("span");
    label.className = "tau-ht-pie-legend-label";
    label.textContent = s.label;
    li.appendChild(label);
    const value = document.createElement("span");
    value.className = "tau-ht-pie-legend-value";
    value.textContent =
      total > 0
        ? `${formatNum(s.value)} (${Math.round((s.value / total) * 100)}%)`
        : formatNum(s.value);
    li.appendChild(value);
    legend.appendChild(li);
  });
  row.appendChild(legend);
  wrap.appendChild(row);
  return wrap;
}

function blockArray(label: string, rows: string[][]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-array";
  appendBlockLabel(wrap, label);
  const list = document.createElement("ul");
  list.className = "tau-ht-array-list";
  for (const row of rows) {
    const li = document.createElement("li");
    li.className = "tau-ht-array-row";
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

function blockKv(label: string, pairs: KvPair[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-kv";
  appendBlockLabel(wrap, label);
  const list = document.createElement("dl");
  list.className = "tau-ht-kv-list";
  for (const p of pairs) {
    const dt = document.createElement("dt");
    dt.className = "tau-ht-kv-key";
    dt.textContent = p.key;
    const dd = document.createElement("dd");
    dd.className = "tau-ht-kv-value";
    dd.textContent = p.value;
    list.appendChild(dt);
    list.appendChild(dd);
  }
  wrap.appendChild(list);
  return wrap;
}

function blockJson(label: string, value: unknown): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-json";
  appendBlockLabel(wrap, label);
  const pre = document.createElement("pre");
  pre.className = "tau-ht-json-body";
  let formatted: string;
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    formatted = String(value);
  }
  pre.textContent = formatted;
  wrap.appendChild(pre);
  return wrap;
}

function blockList(label: string, items: string[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-list";
  appendBlockLabel(wrap, label);
  const list = document.createElement("ul");
  list.className = "tau-ht-list-items";
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "tau-ht-list-item";
    li.textContent = item;
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

function blockImage(label: string, src: string, alt: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-image-block";
  appendBlockLabel(wrap, label);
  const img = document.createElement("img");
  img.className = "tau-ht-image";
  img.src = src;
  img.alt = alt || label;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  wrap.appendChild(img);
  return wrap;
}

function blockMd(label: string, value: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-ht-block tau-ht-md";
  appendBlockLabel(wrap, label);
  const body = document.createElement("div");
  body.className = "tau-ht-block-body tau-ht-md-body";
  body.append(...renderMd(value));
  wrap.appendChild(body);
  return wrap;
}

function appendBlockLabel(wrap: HTMLElement, label: string): void {
  const l = document.createElement("div");
  l.className = "tau-ht-block-label";
  l.textContent = label;
  wrap.appendChild(l);
}

/* ── Helpers ─────────────────────────────────────────────────── */

function textValue(body: ParsedBody): string {
  switch (body.kind) {
    case "text":
    case "longtext":
    case "code":
    case "md":
      return body.value;
    case "num":
    case "count":
    case "pct":
    case "bytes":
    case "ms":
    case "duration":
    case "currency":
    case "rating":
    case "lineGraph":
    case "sparkline":
    case "area":
    case "histogram":
    case "heatmap":
    case "dotGraph":
    case "vbar":
    case "bar":
    case "gauge":
    case "array":
    case "kv":
    case "json":
    case "list":
    case "tags":
    case "time":
    case "eta":
    case "date":
    case "clock":
    case "status":
    case "dot":
    case "badge":
    case "color":
    case "kbd":
    case "pie":
    case "donut":
      return body.raw;
    case "bool":
      return body.value ? "yes" : "no";
    case "link":
      return body.label;
    case "image":
      return body.alt || body.src;
    case "file":
      return body.basename;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function formatCount(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${Math.round(bytes)} B`;
  if (abs < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (abs < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (abs < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}

function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} m`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatCurrency(value: number, unit: string): string {
  const u = unit.trim();
  const sym = currencySymbol(u);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const body =
    abs >= 1_000_000
      ? `${(abs / 1_000_000).toFixed(2)}M`
      : abs >= 1000
        ? `${(abs / 1000).toFixed(1)}k`
        : abs.toFixed(2);
  return sym ? `${sign}${sym}${body}` : `${sign}${body} ${u}`;
}

function currencySymbol(code: string): string | null {
  switch (code.toUpperCase()) {
    case "USD":
    case "$":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "JPY":
    case "¥":
      return "¥";
    case "CHF":
      return "CHF ";
    case "CAD":
      return "CA$";
    case "AUD":
      return "A$";
    default:
      return null;
  }
}

function formatBarValue(
  value: number,
  max: number,
  unit: string | undefined,
): string {
  const v = formatNum(value);
  const m = formatNum(max);
  if (unit === "%" || max === 100) return `${Math.round(value)}%`;
  if (unit) return `${v} ${unit}/${m}`;
  return `${v}/${m}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

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

function meterSemantic(
  semantic: SemanticToken | null,
  value: number,
  max: number,
): "ok" | "warn" | "err" {
  if (semantic === "warn") return "warn";
  if (semantic === "err") return "err";
  if (semantic === "ok" || semantic === "info") return "ok";
  const pct = max > 0 ? (value / max) * 100 : 0;
  if (pct > 80) return "err";
  if (pct > 50) return "warn";
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
    case "info":
    case "blue":
      return "var(--tau-cyan)";
    default:
      return c;
  }
}

function stateClass(state: string): string {
  const lc = state.trim().toLowerCase();
  if (
    lc === "done" ||
    lc === "complete" ||
    lc === "completed" ||
    lc === "ok" ||
    lc === "success" ||
    lc === "pass" ||
    lc === "passed"
  )
    return "done";
  if (
    lc === "active" ||
    lc === "running" ||
    lc === "in_progress" ||
    lc === "in-progress" ||
    lc === "wip"
  )
    return "active";
  if (
    lc === "waiting" ||
    lc === "pending" ||
    lc === "todo" ||
    lc === "queued" ||
    lc === "blocked" ||
    lc === "paused"
  )
    return "waiting";
  if (
    lc === "err" ||
    lc === "error" ||
    lc === "failed" ||
    lc === "fail" ||
    lc === "fatal" ||
    lc === "critical"
  )
    return "err";
  if (lc === "warn" || lc === "warning" || lc === "skipped" || lc === "drift")
    return "warn";
  if (lc === "info") return "info";
  return "neutral";
}

function appendIcon(wrap: HTMLElement, icon: string): void {
  const el = document.createElement("span");
  el.className = "tau-ht-icon";
  el.textContent = icon;
  el.setAttribute("aria-hidden", "true");
  wrap.appendChild(el);
  wrap.appendChild(document.createTextNode(" "));
}

/* ── SVG primitives ──────────────────────────────────────────── */

function buildSparklineSvg(
  samples: number[],
  opts: { width: number; height: number; area?: boolean },
): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
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

  if (opts.area) {
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute(
      "points",
      `0,${opts.height} ${points} ${opts.width},${opts.height}`,
    );
    polygon.setAttribute("fill", "currentColor");
    polygon.setAttribute("fill-opacity", "0.2");
    polygon.setAttribute("stroke", "none");
    svg.appendChild(polygon);
  }
  const polyline = document.createElementNS(SVG_NS, "polyline");
  polyline.setAttribute("points", points);
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "currentColor");
  polyline.setAttribute("stroke-width", "1.25");
  polyline.setAttribute("stroke-linejoin", "round");
  polyline.setAttribute("stroke-linecap", "round");
  svg.appendChild(polyline);
  return svg;
}

function buildVbarSvg(
  samples: number[],
  opts: { width: number; height: number },
): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "tau-vbar");
  svg.setAttribute("width", String(opts.width));
  svg.setAttribute("height", String(opts.height));
  svg.setAttribute("viewBox", `0 0 ${opts.width} ${opts.height}`);
  if (samples.length === 0) return svg;
  const max = Math.max(...samples, 0);
  const min = Math.min(...samples, 0);
  const range = max - min || 1;
  const slot = opts.width / samples.length;
  const barW = Math.max(1, slot - 1.5);
  samples.forEach((v, i) => {
    const h = ((v - min) / range) * (opts.height - 2);
    const x = i * slot + (slot - barW) / 2;
    const y = opts.height - h - 1;
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", x.toFixed(1));
    r.setAttribute("y", y.toFixed(1));
    r.setAttribute("width", barW.toFixed(1));
    r.setAttribute("height", Math.max(0.5, h).toFixed(1));
    r.setAttribute("fill", "currentColor");
    r.setAttribute("opacity", String(0.55 + 0.45 * ((v - min) / range)));
    svg.appendChild(r);
  });
  return svg;
}

function buildGaugeSvg(
  value: number,
  max: number,
  opts: { width: number; height: number },
): SVGElement {
  // Half-circle arc from 180° (left) to 0° (right). Gauge axis runs
  // along the bottom edge of the bbox so it reads naturally.
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "tau-gauge");
  svg.setAttribute("width", String(opts.width));
  svg.setAttribute("height", String(opts.height));
  svg.setAttribute("viewBox", `0 0 ${opts.width} ${opts.height}`);
  const cx = opts.width / 2;
  const cy = opts.height - 2;
  const r = Math.min(opts.width / 2 - 2, opts.height - 4);
  const stroke = Math.max(2, r * 0.18);

  // Track (full half-circle).
  const track = document.createElementNS(SVG_NS, "path");
  track.setAttribute("d", arcPath(cx, cy, r, 180, 0));
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "currentColor");
  track.setAttribute("stroke-opacity", "0.18");
  track.setAttribute("stroke-width", String(stroke));
  track.setAttribute("stroke-linecap", "round");
  svg.appendChild(track);

  // Value arc.
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const endAngle = 180 - ratio * 180;
  const arc = document.createElementNS(SVG_NS, "path");
  arc.setAttribute("d", arcPath(cx, cy, r, 180, endAngle));
  arc.setAttribute("fill", "none");
  arc.setAttribute("stroke", "currentColor");
  arc.setAttribute("stroke-width", String(stroke));
  arc.setAttribute("stroke-linecap", "round");
  svg.appendChild(arc);

  return svg;
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad(startDeg));
  const y0 = cy - r * Math.sin(rad(startDeg));
  const x1 = cx + r * Math.cos(rad(endDeg));
  const y1 = cy - r * Math.sin(rad(endDeg));
  const sweep = endDeg < startDeg ? 1 : 0;
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function buildHeatmapStrip(
  samples: number[],
  opts: { width: number; height: number; gridded?: boolean },
): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "tau-heatmap");
  svg.setAttribute("width", String(opts.width));
  svg.setAttribute("height", String(opts.height));
  svg.setAttribute("viewBox", `0 0 ${opts.width} ${opts.height}`);
  if (samples.length === 0) return svg;
  const max = Math.max(...samples);
  const min = Math.min(...samples);
  const range = max - min || 1;
  const slot = opts.width / samples.length;
  samples.forEach((v, i) => {
    const t = (v - min) / range;
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", (i * slot).toFixed(2));
    r.setAttribute("y", "0");
    r.setAttribute(
      "width",
      Math.max(1, slot - (opts.gridded ? 1 : 0)).toFixed(2),
    );
    r.setAttribute("height", String(opts.height));
    r.setAttribute("fill", heatColor(t));
    svg.appendChild(r);
  });
  return svg;
}

function heatColor(t: number): string {
  const stops = [
    [0.0, [13, 18, 23]],
    [0.25, [33, 96, 130]],
    [0.5, [111, 233, 255]],
    [0.75, [255, 197, 107]],
    [1.0, [255, 91, 91]],
  ] as const;
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1];
    const [b, cb] = stops[i];
    if (t <= b) {
      const k = (t - a) / (b - a || 1);
      const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
      const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
      const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
      return `rgb(${r}, ${g}, ${bl})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(",")})`;
}

function buildPieSvg(
  slices: PieSlice[],
  opts: { size: number; donut: boolean },
): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `tau-pie${opts.donut ? " is-donut" : ""}`);
  svg.setAttribute("width", String(opts.size));
  svg.setAttribute("height", String(opts.size));
  svg.setAttribute("viewBox", `0 0 ${opts.size} ${opts.size}`);
  const cx = opts.size / 2;
  const cy = opts.size / 2;
  const r = opts.size / 2 - 1;
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return svg;
  let acc = 0;
  slices.forEach((s, i) => {
    const start = (acc / total) * 360 - 90;
    acc += s.value;
    const end = (acc / total) * 360 - 90;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute(
      "d",
      sliceArcPath(cx, cy, r, start, end, opts.donut ? r * 0.55 : 0),
    );
    path.setAttribute("fill", pieColor(i));
    svg.appendChild(path);
  });
  return svg;
}

function sliceArcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  innerR: number,
): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad(startDeg));
  const y0 = cy + r * Math.sin(rad(startDeg));
  const x1 = cx + r * Math.cos(rad(endDeg));
  const y1 = cy + r * Math.sin(rad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  if (innerR > 0) {
    const ix0 = cx + innerR * Math.cos(rad(endDeg));
    const iy0 = cy + innerR * Math.sin(rad(endDeg));
    const ix1 = cx + innerR * Math.cos(rad(startDeg));
    const iy1 = cy + innerR * Math.sin(rad(startDeg));
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix0} ${iy0} A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1} Z`;
  }
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

const PIE_PALETTE = [
  "#6fe9ff",
  "#ffc56b",
  "#8ce99a",
  "#ff8a8a",
  "#b48bff",
  "#ff9ed1",
  "#6f9bff",
  "#ffd84d",
];

function pieColor(i: number): string {
  return PIE_PALETTE[i % PIE_PALETTE.length];
}

/** 5-point star, drawn as a single SVG path so the chrome stays free
 *  of emoji glyphs (audit §0). `filled=true` paints with currentColor;
 *  `filled=false` outlines only. */
function buildStarSvg(filled: boolean): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "11");
  svg.setAttribute("height", "11");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    "M5 0.7 L6.27 3.66 L9.5 4 L7 6.13 L7.78 9.3 L5 7.6 L2.22 9.3 L3 6.13 L0.5 4 L3.73 3.66 Z",
  );
  if (filled) {
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "none");
  } else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "0.8");
    path.setAttribute("stroke-linejoin", "round");
  }
  svg.appendChild(path);
  return svg;
}

/* ── Tiny markdown subset (md renderer) ──────────────────────── */

/** Inline-only markdown subset: **bold**, *italic*, `code`, [text](url),
 *  newlines = paragraph break. No HTML, no script — safe. */
function renderMd(text: string): Node[] {
  const nodes: Node[] = [];
  const blocks = text.split(/\n{2,}/);
  blocks.forEach((block, bi) => {
    if (bi > 0) nodes.push(document.createElement("br"));
    const p = document.createElement("p");
    p.className = "tau-ht-md-p";
    for (const line of block.split(/\n/)) {
      p.append(...renderMdInline(line));
      p.append(document.createElement("br"));
    }
    if (p.lastChild?.nodeName === "BR") p.removeChild(p.lastChild);
    nodes.push(p);
  });
  return nodes;
}

function renderMdInline(line: string): Node[] {
  const out: Node[] = [];
  let rest = line;
  // Order matters: links → code → bold → italic.
  while (rest.length > 0) {
    const link = rest.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
    if (link) {
      const a = document.createElement("a");
      a.className = "tau-status-link";
      a.href = link[2];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = link[1];
      a.addEventListener("click", (e) => {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("ht-open-url", { detail: { url: link[2] } }),
        );
      });
      out.push(a);
      rest = rest.slice(link[0].length);
      continue;
    }
    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      const c = document.createElement("code");
      c.className = "tau-ht-md-code";
      c.textContent = code[1];
      out.push(c);
      rest = rest.slice(code[0].length);
      continue;
    }
    const bold = rest.match(/^\*\*([^*]+)\*\*/);
    if (bold) {
      const b = document.createElement("strong");
      b.className = "tau-ht-md-bold";
      b.textContent = bold[1];
      out.push(b);
      rest = rest.slice(bold[0].length);
      continue;
    }
    const italic = rest.match(/^\*([^*]+)\*/);
    if (italic) {
      const i = document.createElement("em");
      i.className = "tau-ht-md-italic";
      i.textContent = italic[1];
      out.push(i);
      rest = rest.slice(italic[0].length);
      continue;
    }
    // Plain text up to next markup char.
    const next = rest.search(/[*`[]/);
    if (next === -1) {
      out.push(document.createTextNode(rest));
      break;
    }
    if (next === 0) {
      // Markup char that didn't match — emit literally.
      out.push(document.createTextNode(rest[0]));
      rest = rest.slice(1);
      continue;
    }
    out.push(document.createTextNode(rest.slice(0, next)));
    rest = rest.slice(next);
  }
  return out;
}
