/**
 * Pure gate decision: given a list of classified shots + the allowlist,
 * decide whether the run fails and which status groups failed.
 */
import type { ReportShot, ShotStatus } from "./types";

export interface GateInput {
  shots: readonly ReportShot[];
  /** Canonical keys allowed to appear as `new` without tripping the gate. */
  allowedNew: ReadonlySet<string>;
}

export interface GateResult {
  failed: boolean;
  failingStatuses: ShotStatus[];
}

const HARD_FAIL: readonly ShotStatus[] = [
  "over",
  "dim-mismatch",
  "missing",
  "baseline-only",
  "corrupt",
];

export function evaluateGate(input: GateInput): GateResult {
  const { shots, allowedNew } = input;
  const failing = new Set<ShotStatus>();
  for (const shot of shots) {
    if (HARD_FAIL.includes(shot.status)) {
      failing.add(shot.status);
      continue;
    }
    if (shot.status === "new" && !allowedNew.has(shot.id)) {
      failing.add("new");
    }
  }
  return {
    failed: failing.size > 0,
    failingStatuses: [...failing].sort(),
  };
}
