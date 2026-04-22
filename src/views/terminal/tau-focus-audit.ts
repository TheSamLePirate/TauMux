/**
 * τ-mux focus-state dev auditor.
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §4.
 *
 *   "The focused pane is the *only* element in the UI with a glow."
 *
 * Running `tauAuditFocus()` at runtime walks every chrome element
 * (τ-mux classes + legacy titlebar / sidebar / surface-container /
 * overlay selectors) and reports the ones currently painting a
 * chromatic glow — a `box-shadow` whose blur radius is ≥ 4 px AND
 * whose colour has non-zero alpha AND is NOT the default black drop
 * shadow we use for elevation.
 *
 * Expected result:
 *   • at most one focused pane (.tau-pane.is-focused) with a glow,
 *   • the outer window chrome (which lives outside the webview and
 *     is not enumerable from here),
 *   • optional τ logo drop-shadow on .titlebar-app-icon (filter, not
 *     box-shadow — excluded by design).
 *
 * Anything else is a drift and gets logged. Call from DevTools when
 * inspecting the UI; also re-used by Phase 13's validation smoke.
 *
 * Not wired into `bun test` because it needs a live webview. Phase 13
 * wires it into the Playwright visual smoke.
 */

interface GlowHit {
  selector: string;
  shadow: string;
  role: "focus" | "leak";
}

/** Parse a `box-shadow` declaration into individual shadow layers. */
function splitShadows(decl: string): string[] {
  if (!decl || decl === "none") return [];
  // A declaration can hold multiple comma-separated layers; commas inside
  // rgba() need to be skipped.
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < decl.length; i++) {
    const ch = decl[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(decl.slice(last, i).trim());
      last = i + 1;
    }
  }
  out.push(decl.slice(last).trim());
  return out;
}

/** Is this layer a chromatic glow vs a non-coloured drop shadow / hairline? */
function isGlow(layer: string): boolean {
  // Look for blur radius ≥ 4 px (third length token in a box-shadow layer).
  const parts = layer.split(/\s+(?![^(]*\))/).filter(Boolean);
  let blur = 0;
  for (const p of parts) {
    const m = p.match(/^(-?\d+(?:\.\d+)?)px$/);
    if (m) {
      // Third numeric token = blur (after offsetX / offsetY).
      const n = Number(m[1]);
      if (!Number.isNaN(n)) blur = n;
    }
  }
  if (blur < 4) return false;
  // Extract colour alpha — a near-zero alpha is a fade-out, ignore.
  const rgba = layer.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const parts = rgba[1]!.split(",").map((s) => s.trim());
    const a = parts.length >= 4 ? Number(parts[3]) : 1;
    if (Number.isNaN(a) || a <= 0.02) return false;
    // Pure black with low alpha is an elevation shadow, not a chromatic glow.
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (r + g + b <= 24) return false;
  }
  return true;
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
  const cls = (el as HTMLElement).className
    ? "." +
      (typeof (el as HTMLElement).className === "string"
        ? (el as HTMLElement).className
        : String((el as HTMLElement).className)
      )
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(".")
    : "";
  return `${tag}${id}${cls}`;
}

/** Walk the visible chrome and return every element currently glowing. */
export function auditFocusGlow(root: ParentNode = document): GlowHit[] {
  const hits: GlowHit[] = [];
  const candidates = root.querySelectorAll<HTMLElement>(
    [
      ".tau-pane",
      ".surface-container",
      "#titlebar *",
      "#sidebar *",
      ".tau-status-bar *",
      ".tau-pane-header *",
    ].join(", "),
  );
  for (const el of candidates) {
    const style = window.getComputedStyle(el);
    const layers = splitShadows(style.boxShadow || "");
    const glowing = layers.filter(isGlow);
    if (glowing.length === 0) continue;
    const isFocusedPane =
      el.classList.contains("tau-pane") && el.classList.contains("is-focused");
    for (const g of glowing) {
      hits.push({
        selector: describe(el),
        shadow: g,
        role: isFocusedPane ? "focus" : "leak",
      });
    }
  }
  return hits;
}

/** Pretty-print the audit result. `window.tauAuditFocus()` in DevTools. */
export function tauAuditFocus(): void {
  const hits = auditFocusGlow();
  const leaks = hits.filter((h) => h.role === "leak");
  const focus = hits.filter((h) => h.role === "focus");
  console.groupCollapsed(
    `%c[τ-mux] focus audit — ${leaks.length === 0 ? "clean" : `${leaks.length} glow leak(s)`}`,
    leaks.length === 0 ? "color: #8ce99a" : "color: #ff8a8a",
  );
  if (focus.length === 0) {
    console.info("no focused pane glowing");
  } else {
    console.info(
      "focused pane glow (expected):",
      focus.map((h) => h.selector).join(", "),
    );
  }
  if (leaks.length > 0) {
    console.table(
      leaks.map((h) => ({ selector: h.selector, shadow: h.shadow })),
    );
  }
  console.groupEnd();
}

// Expose on window so it can be invoked from DevTools without an import.
declare global {
  interface Window {
    tauAuditFocus?: () => void;
  }
}
if (typeof window !== "undefined") {
  window.tauAuditFocus = tauAuditFocus;
}
