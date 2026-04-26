/** HTML-escape a string for safe interpolation into an HTML
 *  template. Used by every lib module to prevent script injection
 *  when rendering arbitrary user / file content. Identical
 *  semantics to the standard "amp/lt/gt/quot/apos" replacement
 *  sequence — kept in one module so test coverage on it transfers
 *  to every consumer. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a value for use as an HTML attribute. Practically the
 *  same as `escapeHtml` but accepts non-string inputs (arrays /
 *  objects / numbers) by stringifying them first. */
export function escapeAttr(v: unknown): string {
  return escapeHtml(typeof v === "string" ? v : String(v ?? ""));
}
