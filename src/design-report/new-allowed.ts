/**
 * Parse `tests-e2e-baselines/.new-allowed` — one canonical key per
 * line, `#` comments allowed. Lets maintainers introduce a shot
 * intentionally without tripping the gate while the baseline is being
 * reviewed.
 */
import { existsSync, readFileSync } from "node:fs";

export const NEW_ALLOWED_FILENAME = ".new-allowed";

export function parseNewAllowed(body: string): Set<string> {
  const set = new Set<string>();
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    set.add(line);
  }
  return set;
}

export function readNewAllowed(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  try {
    return parseNewAllowed(readFileSync(path, "utf8"));
  } catch {
    return new Set();
  }
}
