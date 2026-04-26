/**
 * JSON value → collapsible HTML tree for shareBin's `show_json`.
 *
 * Each node renders as a `<details>` element where containers are
 * collapsible (open by default at depth ≤ N). Primitive values get
 * a `data-type` attribute so a stylesheet can colour numbers /
 * strings / booleans / null distinctly. Strings are HTML-escaped
 * (via the shared escape helper) — agent-dropped JSON often
 * contains shell-quoted error messages with `<` / `>` / `"`.
 *
 * Pure function; the renderer carries no state. Recursion depth is
 * capped to keep a runaway cycle from blowing the call stack.
 */

import { escapeHtml } from "./escape";

const MAX_DEPTH = 64;
const DEFAULT_OPEN_DEPTH = 2;

export interface JsonTreeOptions {
  /** Containers shallower than this default to expanded. */
  openDepth?: number;
  /** Optional root label. */
  rootLabel?: string;
}

/** Render the value to a self-contained HTML fragment. The caller
 *  wraps it with chrome + stylesheet (`show_json` provides both). */
export function renderJsonTree(
  value: unknown,
  opts: JsonTreeOptions = {},
): string {
  const openDepth = opts.openDepth ?? DEFAULT_OPEN_DEPTH;
  const root = renderNode(value, 0, openDepth, opts.rootLabel);
  return `<div class="jt-root">${root}</div>`;
}

function renderNode(
  value: unknown,
  depth: number,
  openDepth: number,
  label: string | undefined,
): string {
  if (depth > MAX_DEPTH) {
    return `<span class="jt-err">…depth limit</span>`;
  }
  if (value === null) return primitive("null", "null", label);
  if (typeof value === "boolean") {
    return primitive("boolean", String(value), label);
  }
  if (typeof value === "number") {
    return primitive("number", String(value), label);
  }
  if (typeof value === "string") {
    return primitive("string", `"${escapeHtml(value)}"`, label);
  }
  if (Array.isArray(value)) {
    return container(value, depth, openDepth, label, "array");
  }
  if (value && typeof value === "object") {
    return container(
      value as Record<string, unknown>,
      depth,
      openDepth,
      label,
      "object",
    );
  }
  // undefined, function, symbol — JSON-style "unknown" rendering.
  return primitive("unknown", escapeHtml(String(value)), label);
}

function primitive(
  kind: "null" | "boolean" | "number" | "string" | "unknown",
  display: string,
  label: string | undefined,
): string {
  const labelHtml =
    label !== undefined
      ? `<span class="jt-key">${escapeHtml(label)}</span>: `
      : "";
  return `<div class="jt-leaf">${labelHtml}<span class="jt-val" data-type="${kind}">${display}</span></div>`;
}

function container(
  value: unknown[] | Record<string, unknown>,
  depth: number,
  openDepth: number,
  label: string | undefined,
  kind: "array" | "object",
): string {
  const isArray = kind === "array";
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const len = entries.length;
  const open = depth < openDepth ? " open" : "";
  const labelHtml =
    label !== undefined
      ? `<span class="jt-key">${escapeHtml(label)}</span>: `
      : "";
  const summaryBracket = isArray ? `[${len}]` : `{${len}}`;
  const summary = `<summary>${labelHtml}<span class="jt-bracket">${summaryBracket}</span></summary>`;
  const children = entries
    .map(([k, v]) =>
      renderNode(v, depth + 1, openDepth, isArray ? undefined : k),
    )
    .join("");
  return `<details class="jt-${kind}"${open}>${summary}<div class="jt-children">${children}</div></details>`;
}
