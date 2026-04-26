/**
 * Tiny RFC 4180-ish CSV / TSV parser for shareBin's `show_table`.
 *
 * Supports:
 *   - comma or tab separator (auto-sniff or explicit)
 *   - quoted fields with `"` (RFC 4180 doubled-quote escape: `""`)
 *   - `\n` and `\r\n` line endings
 *   - empty trailing fields
 *
 * Does NOT support: line continuations, BOM stripping (caller
 * should handle), embedded comments, header-row detection (the
 * caller picks whether to treat row 0 as a header).
 *
 * Pure: no I/O, no async, deterministic output for any input.
 * Designed for files an agent dumps in a panel — not gigabyte
 * datasets. Memory + perf are linear in input length.
 */

export interface CsvParseOptions {
  /** Field separator. Default: auto-sniff (`\t` if any tab in
   *  the first 1024 chars, else `,`). */
  sep?: "," | "\t" | "auto";
}

/** Parse a CSV / TSV string into rows of strings. Always returns
 *  at least one row (empty input → `[[""]]`). Trailing newline
 *  is consumed, so an even-trailing input doesn't add a stray
 *  blank row. */
export function parseCsv(
  input: string,
  opts: CsvParseOptions = {},
): string[][] {
  const sep = resolveSep(input, opts.sep ?? "auto");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // Doubled quote → literal `"`. Otherwise close the quote.
        if (i + 1 < n && input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === sep) {
      row.push(field);
      field = "";
      i++;
      continue;
    }

    if (ch === "\r") {
      // Treat `\r\n` and bare `\r` as a row terminator.
      if (i + 1 < n && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Flush the final cell + row. We keep the last row even when
  // empty IFF the input had any content — pure empty input still
  // returns one empty row to keep callers from special-casing.
  row.push(field);
  if (rows.length === 0 || row.length > 1 || row[0] !== "") {
    rows.push(row);
  } else if (rows.length === 0) {
    rows.push(row);
  }

  return rows;
}

/** Auto-sniff delimiter — tabs win when the input has any tab in
 *  the first 1024 chars; otherwise default to comma. */
function resolveSep(input: string, hint: "," | "\t" | "auto"): "," | "\t" {
  if (hint === ",") return ",";
  if (hint === "\t") return "\t";
  const head = input.slice(0, 1024);
  return head.includes("\t") ? "\t" : ",";
}
