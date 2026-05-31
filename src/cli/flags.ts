/**
 * `ht` CLI argv helpers — split out of `bin/ht` (§6.5).
 *
 * NOTE: `parseFlags` preserves the historical (greedy, spec-free) parsing
 * exactly — a flag consumes the next token as its value unless that token
 * itself looks like a flag. The known edge cases (a value that starts with
 * `--`, multi-char short flags, negative-number values) are documented and
 * pinned by tests; fixing them needs a per-command flag spec and is tracked
 * separately so this split stays behavior-preserving.
 */

export function parseFlags(
  a: string[],
): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < a.length) {
    if (a[i].startsWith("--")) {
      const key = a[i].slice(2);
      const val = a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : "true";
      flags[key] = val;
      i += val === "true" ? 1 : 2;
    } else if (a[i].startsWith("-") && a[i].length === 2) {
      const key = a[i].slice(1);
      const val = a[i + 1] && !a[i + 1].startsWith("-") ? a[i + 1] : "true";
      flags[key] = val;
      i += val === "true" ? 1 : 2;
    } else {
      positional.push(a[i]);
      i++;
    }
  }
  return { positional, flags };
}

export function unescapeText(s: string): string {
  return s
    .replace(/\\n/g, "\r")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\x1b/g, "\x1b")
    .replace(/\\\\/g, "\\");
}
