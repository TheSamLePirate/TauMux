/** CSV profiling helpers for `shareBin/show_csv_profile`. */

export type ColumnKind = "empty" | "integer" | "number" | "boolean" | "date" | "string" | "mixed";

export interface HistogramBucket {
  min: number;
  max: number;
  count: number;
}

export interface TopValue {
  value: string;
  count: number;
}

export interface ColumnProfile {
  index: number;
  name: string;
  kind: ColumnKind;
  total: number;
  empty: number;
  distinct: number;
  topValues: TopValue[];
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  histogram: HistogramBucket[];
}

export interface CsvProfile {
  headers: string[];
  rowCount: number;
  sampledRowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  sampleRows: string[][];
  truncated: boolean;
}

export interface CsvProfileOptions {
  hasHeader?: boolean;
  sampleLimit?: number;
  sampleRows?: number;
}

const EMPTY_VALUES = new Set(["", "null", "nil", "undefined", "na", "n/a"]);

export function profileCsv(
  rows: readonly (readonly string[])[],
  opts: CsvProfileOptions = {},
): CsvProfile {
  const hasHeader = opts.hasHeader ?? true;
  const sampleLimit = Math.max(1, opts.sampleLimit ?? 50000);
  const sampleRowsLimit = Math.max(0, opts.sampleRows ?? 20);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = buildHeaders(rows, columnCount, hasHeader);
  const body = hasHeader ? rows.slice(1) : rows.slice();
  const sampled = body.slice(0, sampleLimit);
  const columns: ColumnProfile[] = [];
  for (let col = 0; col < columnCount; col++) {
    columns.push(profileColumn(headers[col] ?? `col_${col + 1}`, col, sampled));
  }
  return {
    headers,
    rowCount: body.length,
    sampledRowCount: sampled.length,
    columnCount,
    columns,
    sampleRows: sampled.slice(0, sampleRowsLimit).map((row) => padRow(row, columnCount)),
    truncated: body.length > sampled.length,
  };
}

function buildHeaders(
  rows: readonly (readonly string[])[],
  columnCount: number,
  hasHeader: boolean,
): string[] {
  const first = rows[0] ?? [];
  return Array.from({ length: columnCount }, (_, i) => {
    const raw = hasHeader ? (first[i] ?? "").trim() : "";
    return raw.length > 0 ? raw : `col_${i + 1}`;
  });
}

function profileColumn(
  name: string,
  index: number,
  rows: readonly (readonly string[])[],
): ColumnProfile {
  const values = rows.map((row) => row[index] ?? "");
  const total = values.length;
  const nonEmpty = values.filter((value) => !isEmpty(value));
  const distinctMap = new Map<string, number>();
  for (const value of nonEmpty) {
    const key = value.trim();
    distinctMap.set(key, (distinctMap.get(key) ?? 0) + 1);
  }
  const kind = inferKind(nonEmpty);
  const numericValues = nonEmpty
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  const stats = numericValues.length > 0 ? numericStats(numericValues) : { histogram: [] };
  return {
    index,
    name,
    kind,
    total,
    empty: total - nonEmpty.length,
    distinct: distinctMap.size,
    topValues: [...distinctMap.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([value, count]) => ({ value, count })),
    ...stats,
  };
}

function inferKind(values: readonly string[]): ColumnKind {
  if (values.length === 0) return "empty";
  const checks = values.map((value) => classify(value));
  const unique = new Set(checks);
  if (unique.size === 1) return checks[0] ?? "empty";
  if (unique.size === 2 && unique.has("integer") && unique.has("number")) return "number";
  if (unique.has("string")) return "mixed";
  return "mixed";
}

function classify(value: string): ColumnKind {
  const trimmed = value.trim();
  if (isEmpty(trimmed)) return "empty";
  if (/^(true|false|yes|no|y|n|0|1)$/i.test(trimmed)) return "boolean";
  if (/^[+-]?\d+$/.test(trimmed)) return "integer";
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return "number";
  const time = Date.parse(trimmed);
  if (Number.isFinite(time) && /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(trimmed)) return "date";
  return "string";
}

function numericStats(values: readonly number[]): Pick<ColumnProfile, "min" | "max" | "mean" | "median" | "histogram"> {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  return { min, max, mean, median, histogram: histogram(sorted, min, max, 12) };
}

function histogram(values: readonly number[], min: number, max: number, count: number): HistogramBucket[] {
  if (values.length === 0) return [];
  if (min === max) return [{ min, max, count: values.length }];
  const buckets = Array.from({ length: count }, (_, i) => {
    const start = min + ((max - min) * i) / count;
    const end = min + ((max - min) * (i + 1)) / count;
    return { min: start, max: end, count: 0 };
  });
  for (const value of values) {
    const idx = Math.min(count - 1, Math.floor(((value - min) / (max - min)) * count));
    buckets[idx]!.count++;
  }
  return buckets;
}

function isEmpty(value: string): boolean {
  return EMPTY_VALUES.has(value.trim().toLowerCase());
}

function padRow(row: readonly string[], width: number): string[] {
  return Array.from({ length: width }, (_, i) => row[i] ?? "");
}
