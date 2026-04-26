/**
 * Sortable HTML table renderer for shareBin's `show_table`.
 *
 * Takes the row matrix from `parseCsv` (or any caller) and emits
 * a self-contained `<table>` fragment plus a small JS snippet that
 * wires click-to-sort on every header cell. The rendered panel is
 * static HTML — the JS lives inside the panel itself so the
 * shareBin script can exit immediately while the user clicks
 * around.
 *
 * Sorting is column-wise, alphanumeric with a numeric promotion:
 * if every cell in a column parses as a finite number, the column
 * sorts numerically; otherwise lexicographically. Three-state
 * cycle per column: ascending → descending → unsorted.
 *
 * Pure rendering — input rows + options in, HTML fragment out.
 * Caller wraps with surrounding chrome / stylesheet (the
 * `show_table` script provides both).
 */

import { escapeHtml } from "./escape";

export interface TableRenderOptions {
  /** Treat row 0 as the header row. Default true. */
  hasHeader?: boolean;
  /** Optional title rendered above the table. */
  title?: string;
}

/** Render a row matrix (strings) to a self-contained HTML table
 *  fragment + the sort-wiring JS snippet. */
export function renderTable(
  rows: readonly (readonly string[])[],
  opts: TableRenderOptions = {},
): string {
  const hasHeader = opts.hasHeader ?? true;
  if (rows.length === 0) {
    return `<div class="tbl-empty">(empty table)</div>`;
  }

  // Normalise: every row gets the same column count as the widest
  // row (helps with ragged inputs from hand-written CSV).
  const widest = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const padded = rows.map((r) => {
    if (r.length === widest) return r;
    return [...r, ...Array<string>(widest - r.length).fill("")];
  });

  const headerRow = hasHeader ? padded[0]! : null;
  const bodyRows = hasHeader ? padded.slice(1) : padded;

  const titleHtml = opts.title
    ? `<header><span>${escapeHtml(opts.title)}</span><span class="tbl-count">${bodyRows.length} row${bodyRows.length === 1 ? "" : "s"}</span></header>`
    : "";

  const thead =
    headerRow !== null
      ? `<thead><tr>${headerRow
          .map(
            (cell, i) =>
              `<th data-col="${i}" tabindex="0">${escapeHtml(cell)}<span class="tbl-sort">↕</span></th>`,
          )
          .join("")}</tr></thead>`
      : "";

  const tbody = `<tbody>${bodyRows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody>`;

  return `<div class="tbl-pane">${titleHtml}<div class="tbl-scroll"><table class="tbl">${thead}${tbody}</table></div></div>${SORT_SCRIPT}`;
}

/** The click-to-sort wiring. Scoped to `.tbl` so it doesn't
 *  collide with anything else in the panel. Three-state cycle:
 *  asc → desc → unsorted. Numeric promotion when every body cell
 *  in the column parses as a finite number. */
const SORT_SCRIPT = `<script>(function(){
  const tables = document.querySelectorAll('table.tbl');
  for (const tbl of tables) {
    const ths = tbl.querySelectorAll('thead th');
    const tbody = tbl.querySelector('tbody');
    if (!tbody) continue;
    const originalRows = [...tbody.querySelectorAll('tr')];
    let activeCol = -1;
    let direction = 0; // 0 = unsorted, 1 = asc, -1 = desc
    function setMarker(idx, dir) {
      ths.forEach((th, i) => {
        const span = th.querySelector('.tbl-sort');
        if (!span) return;
        if (i === idx && dir === 1) span.textContent = '↑';
        else if (i === idx && dir === -1) span.textContent = '↓';
        else span.textContent = '↕';
      });
    }
    function sortBy(col, dir) {
      if (dir === 0) {
        for (const r of originalRows) tbody.appendChild(r);
        return;
      }
      const cells = originalRows.map((r) => {
        const td = r.children[col];
        return td ? td.textContent || '' : '';
      });
      const allNumeric = cells.every((v) => v.length === 0 || Number.isFinite(Number(v)));
      const sorted = [...originalRows].sort((a, b) => {
        const ax = a.children[col]?.textContent || '';
        const bx = b.children[col]?.textContent || '';
        if (allNumeric) {
          const an = ax.length === 0 ? -Infinity : Number(ax);
          const bn = bx.length === 0 ? -Infinity : Number(bx);
          return (an - bn) * dir;
        }
        return ax.localeCompare(bx) * dir;
      });
      for (const r of sorted) tbody.appendChild(r);
    }
    ths.forEach((th, idx) => {
      th.addEventListener('click', () => {
        if (activeCol !== idx) { activeCol = idx; direction = 1; }
        else if (direction === 1) direction = -1;
        else if (direction === -1) direction = 0;
        else direction = 1;
        if (direction === 0) activeCol = -1;
        setMarker(activeCol, direction);
        sortBy(idx, direction);
      });
    });
  }
})();</script>`;
