/**
 * Minimal YAML → JS-value parser for shareBin's `show_yaml`.
 *
 * Supports the subset of YAML that agents typically dump:
 *
 *   key: value
 *   key:
 *     nested: value
 *     deep:
 *       leaf: 1
 *   list:
 *     - one
 *     - two
 *     - key: value
 *       other: thing
 *
 * Scalar inference (string by default; promoted when the value
 * matches a recognised pattern):
 *   - "true" / "false" / "yes" / "no"          → boolean
 *   - "null" / "~" / ""                        → null
 *   - signed integer                           → number
 *   - signed float / scientific                → number
 *   - quoted strings: "x" / 'x'                → unescaped string
 *   - everything else                          → raw trimmed string
 *
 * Out of scope (callers fall back to text mode):
 *   - flow style (`{a: 1, b: 2}`, `[1, 2, 3]`)
 *   - block scalars (`|` `>`)
 *   - anchors / aliases (`&` `*`)
 *   - multi-doc (`---`)
 *   - merge keys, tags, complex keys
 *
 * Pure function — input string in, value out. Throws on
 * malformed indentation or mixed mapping/sequence at the same
 * level so callers can drop to "raw text" rendering.
 */

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

interface Line {
  indent: number;
  content: string;
  raw: string;
}

export function parseYaml(input: string): YamlValue {
  const lines = preprocess(input);
  if (lines.length === 0) return null;
  const [value] = parseBlock(lines, 0, lines[0]!.indent);
  return value;
}

function preprocess(input: string): Line[] {
  return input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw) => {
      // Strip trailing CR + comments (only when `#` is preceded by
      // whitespace to avoid eating in-string hashes).
      const noComment = raw.replace(/(\s)#.*$/, "$1");
      const trimRight = noComment.replace(/\s+$/, "");
      return trimRight;
    })
    .map<Line | null>((raw) => {
      if (raw.trim().length === 0) return null;
      let i = 0;
      while (i < raw.length && raw[i] === " ") i++;
      // Reject tabs in indent — YAML forbids them and our parser
      // would miscount otherwise. Caller sees a clean error.
      if (raw[i] === "\t") {
        throw new Error("YAML: tab character used for indentation");
      }
      return { indent: i, content: raw.slice(i), raw };
    })
    .filter((l): l is Line => l !== null);
}

/** Parse a block starting at `lines[start]` whose lines all have
 *  indent >= `baseIndent`. Returns the value + the index *after*
 *  the last consumed line. */
function parseBlock(
  lines: Line[],
  start: number,
  baseIndent: number,
): [YamlValue, number] {
  if (start >= lines.length) return [null, start];
  const first = lines[start]!;
  if (first.content.startsWith("- ") || first.content === "-") {
    return parseSequence(lines, start, baseIndent);
  }
  return parseMapping(lines, start, baseIndent);
}

function parseSequence(
  lines: Line[],
  start: number,
  baseIndent: number,
): [YamlValue[], number] {
  const out: YamlValue[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < baseIndent) break;
    if (line.indent > baseIndent) {
      throw new Error(
        `YAML: unexpected indent at line ${i + 1} (expected ${baseIndent})`,
      );
    }
    if (!line.content.startsWith("-")) break;
    // Three shapes:
    //   - scalar              → simple element
    //   - key: value           → element is a mapping with that one pair (or more from following lines)
    //   - (empty after dash)   → element is a nested block at deeper indent
    const after = line.content.slice(1).trimStart();
    if (after.length === 0) {
      // Block element below this dash.
      i++;
      if (i >= lines.length || lines[i]!.indent <= baseIndent) {
        out.push(null);
        continue;
      }
      const [value, next] = parseBlock(lines, i, lines[i]!.indent);
      out.push(value);
      i = next;
      continue;
    }
    if (looksLikeKey(after)) {
      // Inline-mapping element. Treat the rest of the dash line as
      // the first key/value pair, then continue collecting any
      // deeper-indented lines that belong to this element.
      const synthetic: Line = {
        indent: line.indent + 2,
        content: after,
        raw: line.raw,
      };
      // Splice synthetic in place of the dash line so parseMapping
      // sees it as a real mapping line. We do this by rewriting
      // `lines[i]` to `synthetic` (mutation only inside this
      // recursion's scope is fine — we don't share `lines`).
      const replaced = [...lines];
      replaced[i] = synthetic;
      const [value, next] = parseMapping(replaced, i, synthetic.indent);
      out.push(value);
      i = next;
      continue;
    }
    // Plain scalar element.
    out.push(parseScalar(after));
    i++;
  }
  return [out, i];
}

function parseMapping(
  lines: Line[],
  start: number,
  baseIndent: number,
): [{ [key: string]: YamlValue }, number] {
  const out: Record<string, YamlValue> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < baseIndent) break;
    if (line.indent > baseIndent) {
      throw new Error(
        `YAML: unexpected indent at line ${i + 1} (expected ${baseIndent})`,
      );
    }
    if (line.content.startsWith("-")) break; // belongs to a parent sequence
    if (!looksLikeKey(line.content)) {
      throw new Error(`YAML: cannot parse line ${i + 1}: ${line.raw}`);
    }
    const colonIdx = findKeyColon(line.content);
    const key = unquoteKey(line.content.slice(0, colonIdx).trim());
    const valuePart = line.content.slice(colonIdx + 1).trim();
    if (valuePart.length > 0) {
      out[key] = parseScalar(valuePart);
      i++;
      continue;
    }
    // Empty value → nested block below.
    i++;
    if (i >= lines.length || lines[i]!.indent <= baseIndent) {
      out[key] = null;
      continue;
    }
    const [value, next] = parseBlock(lines, i, lines[i]!.indent);
    out[key] = value;
    i = next;
  }
  return [out, i];
}

function looksLikeKey(s: string): boolean {
  // A key line: starts with a non-dash, non-colon char and has a
  // colon followed by space or EOL outside quoted segments.
  if (s.startsWith("-")) return false;
  return findKeyColon(s) !== -1;
}

/** Find the first `: ` (or trailing `:`) outside quoted segments.
 *  Returns -1 when no key/value separator is present. */
function findKeyColon(s: string): number {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === ":" && !inDouble && !inSingle) {
      const next = s[i + 1];
      if (next === undefined || next === " " || next === "\t") return i;
    }
  }
  return -1;
}

function unquoteKey(raw: string): string {
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseScalar(raw: string): YamlValue {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Quoted string — strip outer quotes; unescape `\"` / `\\` in
  // double-quoted strings; single-quoted is literal save for `''`.
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed
      .slice(1, -1)
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  // Booleans / null
  const lower = trimmed.toLowerCase();
  if (lower === "true" || lower === "yes") return true;
  if (lower === "false" || lower === "no") return false;
  if (lower === "null" || trimmed === "~") return null;
  // Numbers
  if (/^[-+]?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  if (/^[-+]?\d+[eE][-+]?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return trimmed;
}
