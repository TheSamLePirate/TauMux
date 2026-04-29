/**
 * Single source of truth for HTML escaping. Previously duplicated in
 * `src/web-client/sidebar.ts`, `src/shared/plan-panel-render.ts`, and
 * `src/design-report/render-html.ts` — three copies that could
 * silently diverge (e.g. one forgetting to escape `'` for an
 * attribute context). Triple-A F.3 / A13.
 *
 * Escapes the five XML-significant characters. Sufficient for both
 * text-context and double-quoted-attribute-context insertion. Do
 * NOT use for unquoted-attribute-context insertion — there's no safe
 * escape for that, and you should always quote attribute values.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
