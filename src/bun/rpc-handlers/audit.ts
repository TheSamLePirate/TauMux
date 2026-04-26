import { applyFix, runAudits, type Audit, type AuditResult } from "../audits";
import type { Handler, HandlerDeps } from "./types";

/** Bun-side state needed by the audit RPCs. The aggregator owns the
 *  registry + last-results cache; this module just exposes them. */
export interface AuditRegistryHandle {
  /** Live audit registry, rebuilt when settings change so a flipped
   *  `auditsGitUserNameExpected` adds / removes the audit on the
   *  fly. */
  getAudits: () => Audit[];
  /** Cached results from the most recent run. Lets `audit.list` be
   *  cheap (no shell-out per RPC call); `audit.run` rerun the
   *  registry and refresh the cache. */
  getLast: () => AuditResult[];
  /** Replace the cache with a fresh result set. Called by the
   *  startup auditor and by `audit.run`. */
  setLast: (results: AuditResult[]) => void;
}

export function registerAudit(
  _deps: HandlerDeps,
  registry: AuditRegistryHandle,
): Record<string, Handler> {
  return {
    /** Return the most-recent audit results without re-running. Empty
     *  array before the first run completes; the runner / startup hook
     *  populates the cache. */
    "audit.list": () => registry.getLast().map(serialise),

    /** Re-run every registered audit and replace the cache. */
    "audit.run": async () => {
      const results = await runAudits(registry.getAudits());
      registry.setLast(results);
      return results.map(serialise);
    },

    /** Apply the named audit's fix, then re-run that audit and patch
     *  the matching cache entry. Throws when the id is unknown. */
    "audit.fix": async (params) => {
      const id = params["id"];
      if (typeof id !== "string" || !id) {
        throw new Error("audit.fix: missing 'id' param");
      }
      const audits = registry.getAudits();
      const last = registry.getLast();
      const target = last.find((r) => r.id === id);
      if (!target) {
        throw new Error(
          `audit.fix: no cached result for id "${id}" — run audits first`,
        );
      }
      const refreshed = await applyFix(target, audits);
      const next = last.map((r) => (r.id === id ? refreshed : r));
      registry.setLast(next);
      return serialise(refreshed);
    },
  };
}

/** Strip the `fix.action` callback off the wire result — the bound
 *  function is process-local and `JSON.stringify` would otherwise
 *  drop it silently, leaving consumers with a misleading `fix: {}`. */
function serialise(r: AuditResult): {
  id: string;
  ok: boolean;
  severity: AuditResult["severity"];
  message: string;
  fixAvailable: boolean;
  fixLabel?: string;
} {
  return {
    id: r.id,
    ok: r.ok,
    severity: r.severity,
    message: r.message,
    fixAvailable: !!r.fix,
    fixLabel: r.fix?.label,
  };
}
