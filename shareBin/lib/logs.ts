/** Pure log parsing helpers for `shareBin/show_logs`. */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

export interface ParsedLogLine {
  index: number;
  raw: string;
  level: LogLevel;
  timestamp: string;
  message: string;
  json?: unknown;
}

const LEVEL_ALIASES: Record<string, LogLevel> = {
  trace: "trace",
  verbose: "trace",
  silly: "trace",
  debug: "debug",
  dbug: "debug",
  info: "info",
  information: "info",
  notice: "info",
  log: "info",
  warn: "warn",
  warning: "warn",
  err: "error",
  error: "error",
  exception: "error",
  fatal: "fatal",
  crit: "fatal",
  critical: "fatal",
  panic: "fatal",
};

const NUMERIC_LEVELS: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const TIME_RE = /\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b|\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/;

export function normalizeLogLevel(value: unknown): LogLevel {
  if (typeof value === "number" && Number.isFinite(value)) {
    return NUMERIC_LEVELS[value] ?? "unknown";
  }
  if (typeof value !== "string") return "unknown";
  const cleaned = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return LEVEL_ALIASES[cleaned] ?? "unknown";
}

export function detectLogLevel(line: string): LogLevel {
  const bracket = line.match(/\[(trace|debug|info|notice|warn|warning|err|error|fatal|critical|panic)\]/i);
  if (bracket) return normalizeLogLevel(bracket[1]);
  const word = line.match(/(?:^|\s|[=:])(?:level=)?(trace|debug|info|notice|warn|warning|err|error|fatal|critical|panic)(?:\b|\s|:)/i);
  if (word) return normalizeLogLevel(word[1]);
  return "unknown";
}

export function parseLogLine(
  raw: string,
  opts: { index?: number; json?: boolean | "auto" } = {},
): ParsedLogLine {
  const index = opts.index ?? 0;
  const trimmed = raw.trim();
  const wantsJson = opts.json === true || opts.json === "auto" || trimmed.startsWith("{");
  if (wantsJson) {
    const parsed = parseJsonLogLine(raw, index);
    if (parsed) return parsed;
    if (opts.json === true) {
      return {
        index,
        raw,
        level: "unknown",
        timestamp: "",
        message: raw,
      };
    }
  }
  return {
    index,
    raw,
    level: detectLogLevel(raw),
    timestamp: raw.match(TIME_RE)?.[0] ?? "",
    message: raw,
  };
}

export function parseJsonLogLine(raw: string, index = 0): ParsedLogLine | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const level =
      normalizeLogLevel(value.level) !== "unknown"
        ? normalizeLogLevel(value.level)
        : normalizeLogLevel(value.severity ?? value.level_name ?? value.lvl);
    const timestamp = stringField(value, ["time", "timestamp", "ts", "date", "datetime"]);
    const message =
      stringField(value, ["msg", "message", "event", "name"]) || raw;
    return { index, raw, level, timestamp, message, json: value };
  } catch {
    return null;
  }
}

export function countLevels(lines: readonly ParsedLogLine[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = {
    trace: 0,
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    fatal: 0,
    unknown: 0,
  };
  for (const line of lines) counts[line.level]++;
  return counts;
}

function stringField(obj: Record<string, unknown>, names: readonly string[]): string {
  for (const name of names) {
    const value = obj[name];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}
