/**
 * Tiny CLI scaffold shared by every shareBin `show_*` utility.
 *
 * Every utility duplicates the same shape:
 *
 *   - require ht.available (we are running inside τ-mux)
 *   - parse a small set of common flags (--inline / --x / --y /
 *     --width / --height / --no-wait) plus a handful of utility-
 *     specific flags
 *   - read input from a positional arg (file path) or from stdin
 *     when piped
 *   - render → ht.showHtml(...) → optionally waitForClose()
 *
 * `cli.ts` collapses that scaffold to two calls:
 *
 *   const { positional, flags } = parseArgs(argv, { schema });
 *   const input = readInput(positional[0]);
 *
 * The flag parser is deliberately minimal — no dashed-arg-passing,
 * no double-dash terminator, no abbrev matching. The shareBin
 * scripts are never invoked with hostile argv; they are agent-
 * dropped one-shot panel renderers. Keeping it small keeps the
 * test surface small.
 *
 * Pure functions; no I/O except `readInput` (which is exposed as a
 * sibling so the parser stays unit-testable).
 */

import { readFileSync } from "node:fs";

// ── Flag schema ───────────────────────────────────────────────

export interface FlagBase<Name extends string> {
  name: Name;
  /** Long flag spelling (without leading `--`). */
  long: string;
}

export interface BooleanFlag<Name extends string> extends FlagBase<Name> {
  kind: "boolean";
  default?: boolean;
}

export interface NumberFlag<Name extends string> extends FlagBase<Name> {
  kind: "number";
  default?: number;
}

export interface StringFlag<Name extends string> extends FlagBase<Name> {
  kind: "string";
  default?: string;
}

export type Flag<Name extends string = string> =
  | BooleanFlag<Name>
  | NumberFlag<Name>
  | StringFlag<Name>;

export type FlagValue<F extends Flag> =
  F extends BooleanFlag<string>
    ? boolean
    : F extends NumberFlag<string>
      ? number
      : F extends StringFlag<string>
        ? string
        : never;

export type FlagsResult<S extends readonly Flag[]> = {
  [K in S[number]["name"]]: FlagValue<Extract<S[number], { name: K }>>;
};

export interface ParseArgsResult<S extends readonly Flag[]> {
  positional: string[];
  flags: FlagsResult<S>;
}

/** Parse a vector of `--flag value` style args. Unknown flags
 *  throw — agents type long flag names in dump scripts; silent
 *  drop hides bugs. Bare strings collect into `positional`. */
export function parseArgs<const S extends readonly Flag[]>(
  argv: readonly string[],
  schema: { schema: S },
): ParseArgsResult<S> {
  const byLong = new Map<string, Flag>();
  for (const f of schema.schema) byLong.set(f.long, f);

  // Seed defaults — every flag has a deterministic default so the
  // output type is total (never undefined).
  const flags = {} as Record<string, boolean | number | string>;
  for (const f of schema.schema) {
    if (f.kind === "boolean") flags[f.name] = f.default ?? false;
    else if (f.kind === "number") flags[f.name] = f.default ?? 0;
    else flags[f.name] = f.default ?? "";
  }

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    if (!raw.startsWith("--")) {
      positional.push(raw);
      continue;
    }
    // Support `--flag=value` and `--flag value`.
    const eq = raw.indexOf("=");
    const long = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const inlineValue = eq === -1 ? null : raw.slice(eq + 1);
    const def = byLong.get(long);
    if (!def) {
      throw new Error(`unknown flag: --${long}`);
    }
    if (def.kind === "boolean") {
      // --flag      → true
      // --flag=true → true
      // --flag=false → false
      if (inlineValue === null) {
        flags[def.name] = true;
      } else {
        flags[def.name] = inlineValue !== "false" && inlineValue !== "0";
      }
      continue;
    }
    const next = inlineValue ?? argv[++i];
    if (next === undefined) {
      throw new Error(`flag --${long} expects a value`);
    }
    if (def.kind === "number") {
      const n = Number(next);
      if (!Number.isFinite(n)) {
        throw new Error(`flag --${long} expects a number, got "${next}"`);
      }
      flags[def.name] = n;
    } else {
      flags[def.name] = next;
    }
  }

  return { positional, flags: flags as FlagsResult<S> };
}

// ── Input ─────────────────────────────────────────────────────

export interface ReadInputOptions {
  /** Label inserted into the "no input" error message. */
  utility: string;
  /** Friendly description of expected input ("JSON", "CSV/TSV", "a unified diff"). */
  expecting: string;
  /** When stdin is a TTY and no path is given, exit with this
   *  error message. Defaults to `process.exit(1)` after stderr. */
  onMissing?: () => never;
}

/** Read input either from `path` (if non-empty) or from stdin
 *  (when not a TTY). Throws a process-fatal error otherwise. */
export function readInput(path: string, opts: ReadInputOptions): string {
  if (path) {
    try {
      return readFileSync(path, "utf8");
    } catch (err) {
      console.error(
        `${opts.utility}: cannot read ${path}: ${(err as Error).message}`,
      );
      process.exit(1);
    }
  }
  if (!process.stdin.isTTY) {
    return readFileSync(0, "utf8");
  }
  if (opts.onMissing) opts.onMissing();
  console.error(
    `${opts.utility}: no input — pass a file path or pipe ${opts.expecting} into stdin`,
  );
  process.exit(1);
}

// ── Common flag presets ───────────────────────────────────────

/** The five flags every panel-renderer utility ships:
 *  --inline / --x / --y / --width / --no-wait. Use:
 *
 *    const { positional, flags } = parseArgs(argv, {
 *      schema: [...PANEL_FLAGS, { name: "depth", long: "depth", kind: "number", default: 2 }],
 *    });
 */
export const PANEL_FLAGS = [
  { name: "inline", long: "inline", kind: "boolean", default: false },
  { name: "noWait", long: "no-wait", kind: "boolean", default: false },
  { name: "x", long: "x", kind: "number", default: 100 },
  { name: "y", long: "y", kind: "number", default: 100 },
  { name: "width", long: "width", kind: "number", default: 520 },
  { name: "height", long: "height", kind: "number", default: 480 },
] as const satisfies readonly Flag[];

export interface PanelFlagValues {
  inline: boolean;
  noWait: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}
