/**
 * Shared sidebar leaf formatters — the cwd shortener and RSS humanizer
 * used by BOTH the native sidebar (`src/views/terminal/sidebar.ts`) and
 * the web-mirror workspace card (`src/web-client/sidebar/workspace-card.ts`).
 *
 * H11 (full_app_review_2026-05.md §3.2): these had drifted into two
 * implementations that produced different strings for the same input —
 * native `shortCwd` (`…/last2`) vs web `shortenCwd` (`~/Users/x`), and
 * native `humanRss` (`512K`, `2.0M`) vs web `formatMem` (which rendered a
 * 512 KB process as the bogus `0M`). The web mirror is advertised as a
 * parity surface, so the divergence was a bug. These canonical functions
 * adopt the native behavior; both surfaces now import them.
 *
 * Pure (no DOM, no globals) so they can be unit-tested directly.
 */

/** Shorten an absolute cwd for display. Paths with ≤2 segments are shown
 *  whole (preserving a leading `/`); longer paths collapse to the last
 *  two segments prefixed with an ellipsis, e.g.
 *  `/Users/me/dev/app/src` → `…/app/src`. */
export function shortenCwd(cwd: string): string {
  if (!cwd) return "";
  const parts = cwd.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 2) {
    return cwd.startsWith("/") ? "/" + parts.join("/") : parts.join("/");
  }
  return "…/" + parts.slice(-2).join("/");
}

/** Humanize a resident-set size given in KB. Sub-MB values render in K;
 *  MB/GB values show one decimal under 10 and round above, e.g.
 *  `512 → "512K"`, `2048 → "2.0M"`, `12_345 → "12M"`,
 *  `2_200_000 → "2.1G"`. */
export function formatRss(kb: number): string {
  if (kb < 1024) return `${Math.round(kb)}K`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}M`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)}G`;
}
