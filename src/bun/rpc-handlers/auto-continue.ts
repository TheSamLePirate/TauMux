/**
 * Auto-continue RPC handlers (Plan #09 commit C).
 *
 * Exposes the engine + settings to the socket layer so `ht
 * autocontinue …` can drive it. The handlers are deliberately thin:
 *  - `autocontinue.status`  — engine config + per-surface state
 *  - `autocontinue.audit`   — last N decisions from the audit ring
 *  - `autocontinue.set`     — persist a partial settings update
 *  - `autocontinue.fire`    — manual dispatch (uses host helpers)
 *  - `autocontinue.pause`   — per-surface pause latch
 *  - `autocontinue.resume`  — clear the pause + reset runaway counter
 */

import type { Handler, HandlerDeps } from "./types";
import type { AutoContinueEngine } from "../auto-continue-engine";
import type { AutoContinueHost } from "../auto-continue-host";
import type { SettingsManager } from "../settings-manager";
import type { AutoContinueSettings } from "../../shared/settings";
import type { AutoContinueAuditEntry } from "../../shared/types";

export interface AutoContinueDeps {
  engine: AutoContinueEngine;
  host: AutoContinueHost;
  settingsManager: SettingsManager;
}

export function registerAutoContinue(
  _deps: HandlerDeps,
  ac: AutoContinueDeps,
): Record<string, Handler> {
  return {
    /** Snapshot the engine config + per-surface paused list so the CLI
     *  / settings UI can render the same view. Cheap; no I/O. */
    "autocontinue.status": () => {
      const s = ac.settingsManager.get().autoContinue;
      return {
        engine: s.engine,
        dryRun: s.dryRun,
        cooldownMs: s.cooldownMs,
        maxConsecutive: s.maxConsecutive,
        modelProvider: s.modelProvider,
        modelName: s.modelName,
        modelApiKeyEnv: s.modelApiKeyEnv,
        paused: ac.engine.listPaused(),
      };
    },

    /** Return the latest audit entries (default 20, cap 50 by the
     *  engine's ring). `--limit` lets a CLI caller scope down without
     *  client-side slicing. */
    "autocontinue.audit": (params) => {
      const limit = clampInt(params["limit"], 1, 50, 20);
      const audit = ac.engine.getAudit();
      const sliced: AutoContinueAuditEntry[] = audit.slice(-limit);
      return { audit: sliced };
    },

    /** Persist a partial settings update. Re-uses
     *  `validateAutoContinue` via SettingsManager so unknown engine
     *  values fall back to "off" and out-of-range numbers clamp. */
    "autocontinue.set": (params) => {
      const current = ac.settingsManager.get().autoContinue;
      const patch: AutoContinueSettings = { ...current };
      if (typeof params["engine"] === "string") {
        const e = params["engine"];
        if (
          e === "off" ||
          e === "heuristic" ||
          e === "model" ||
          e === "hybrid"
        ) {
          patch.engine = e;
        } else {
          throw new Error(
            `autocontinue.set: invalid engine "${e}" (expect off|heuristic|model|hybrid)`,
          );
        }
      }
      if (typeof params["dryRun"] === "boolean") {
        patch.dryRun = params["dryRun"];
      }
      if (typeof params["cooldownMs"] === "number") {
        patch.cooldownMs = params["cooldownMs"];
      }
      if (typeof params["maxConsecutive"] === "number") {
        patch.maxConsecutive = params["maxConsecutive"];
      }
      if (typeof params["modelName"] === "string" && params["modelName"]) {
        patch.modelName = params["modelName"];
      }
      if (
        typeof params["modelApiKeyEnv"] === "string" &&
        params["modelApiKeyEnv"]
      ) {
        patch.modelApiKeyEnv = params["modelApiKeyEnv"];
      }
      const updated = ac.settingsManager.update({ autoContinue: patch });
      return { autoContinue: updated.autoContinue };
    },

    /** Force a dispatch on a surface using the same plan + tail
     *  pipeline `notification.create` would use. Returns the engine
     *  outcome so `ht autocontinue fire` can show what the engine
     *  decided. */
    "autocontinue.fire": async (params) => {
      const surfaceId = stringOrThrow(params, "surface_id");
      const note =
        typeof params["notification_text"] === "string"
          ? params["notification_text"]
          : undefined;
      const outcome = await ac.host.fireNow(surfaceId, note);
      return { outcome };
    },

    "autocontinue.pause": (params) => {
      const surfaceId = stringOrThrow(params, "surface_id");
      const reason =
        typeof params["reason"] === "string" && params["reason"].length > 0
          ? params["reason"]
          : undefined;
      ac.engine.pause(surfaceId, reason);
      return { paused: ac.engine.listPaused() };
    },

    "autocontinue.resume": (params) => {
      const surfaceId = stringOrThrow(params, "surface_id");
      const reason =
        typeof params["reason"] === "string" && params["reason"].length > 0
          ? params["reason"]
          : undefined;
      ac.engine.resume(surfaceId, reason);
      return { paused: ac.engine.listPaused() };
    },
  };
}

function stringOrThrow(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`autocontinue: missing required string param "${key}"`);
  }
  return v;
}

function clampInt(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const n = Math.round(raw);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
