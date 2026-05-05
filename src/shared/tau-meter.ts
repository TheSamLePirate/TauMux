// τ-mux design-system Meter primitive (§8.4).
//
// 4 px tall, 50 px wide default, label-paired (never solo). Fill colour
// follows the semantic axis ok / warn / err.
//
// Extracted from `src/views/terminal/tau-primitives.ts` so it can be
// reused by the web mirror's status bar (`src/web-client/status-bar.ts`)
// without dragging the rest of the native-only design-system primitives
// (Pane, WorkspaceCard, StatusBar mount handle, etc.) into the browser
// bundle. tau-primitives.ts re-exports `Meter` from here so existing
// callers keep working with no path change.

export type MeterSemantic = "ok" | "warn" | "err";

export interface MeterOptions {
  value: number;
  max: number;
  semantic?: MeterSemantic;
  width?: number;
  label?: string;
  valueText?: string;
}

export function Meter(opts: MeterOptions): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-meter-wrap";
  if (opts.label) {
    const l = document.createElement("span");
    l.className = "tau-meter-label tau-mono";
    l.textContent = opts.label;
    wrap.appendChild(l);
  }
  const bar = document.createElement("div");
  bar.className = `tau-meter tau-meter-${opts.semantic ?? "ok"}`;
  bar.style.width = `${opts.width ?? 50}px`;
  const fill = document.createElement("div");
  fill.className = "tau-meter-fill";
  const pct = Math.max(
    0,
    Math.min(1, opts.max > 0 ? opts.value / opts.max : 0),
  );
  fill.style.width = `${(pct * 100).toFixed(1)}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);
  if (opts.valueText !== undefined) {
    const v = document.createElement("span");
    v.className = "tau-meter-value tau-mono";
    v.textContent = opts.valueText;
    wrap.appendChild(v);
  }
  return wrap;
}
