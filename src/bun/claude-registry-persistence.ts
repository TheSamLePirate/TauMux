/**
 * Claude session registry persistence.
 *
 * The registry is in-memory, and the hook bridge only reports
 * *transitions* — so an app restart used to lose every session's
 * mirrored task list permanently: the Claude Code session in your pane
 * keeps running, but its plan panel stays empty forever because no hook
 * will ever re-announce the tasks it already created. That is what the
 * user hit ("AGENT PLANS — No active agent plans" for a live session).
 *
 * This module gives the registry the same load-on-boot + debounced
 * save-on-change contract `notification-persistence.ts` gives the
 * notification store.
 *
 * What is restored is deliberately narrow — the durable *facts* about a
 * session (identity, cwd, title, task list, spend). Live state is NOT
 * restored: a session that was `working` when the app died is not
 * working now, and nothing is waiting on an approval that no longer has
 * a terminal prompt behind it. Restored sessions come back `idle` with
 * no in-flight turn, no subagents and no pending approval, and the next
 * hook event corrects everything else.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic-write";
import {
  newClaudeSessionState,
  type ClaudeSessionState,
} from "../shared/claude-types";
import type { ClaudeSessionRegistry } from "./claude-session-registry";

/** Bumped when the persisted shape changes incompatibly. */
const FORMAT = 1;

interface PersistedFile {
  format: number;
  sessions: ClaudeSessionState[];
}

/** Strip everything that describes a *live* moment rather than a fact. */
export function sanitizeForRestore(
  raw: ClaudeSessionState,
): ClaudeSessionState {
  const base = newClaudeSessionState(raw.sessionId, raw.lastEventAt || 0);
  return {
    ...base,
    // Durable identity + accumulated facts.
    sessionId: raw.sessionId,
    surfaceId: raw.surfaceId ?? null,
    cwd: raw.cwd ?? "",
    source: raw.source ?? "",
    startedAt: raw.startedAt || base.startedAt,
    lastEventAt: raw.lastEventAt || base.lastEventAt,
    turnCount: raw.turnCount ?? 0,
    label: raw.label ?? "",
    currentPrompt: raw.currentPrompt ?? "",
    sessionName: raw.sessionName ?? "",
    modelDisplayName: raw.modelDisplayName ?? "",
    costUsd: raw.costUsd ?? null,
    contextUsedPct: raw.contextUsedPct ?? null,
    contextWindowSize: raw.contextWindowSize ?? null,
    linesAdded: raw.linesAdded ?? null,
    linesRemoved: raw.linesRemoved ?? null,
    permissionMode: raw.permissionMode ?? "",
    effortLevel: raw.effortLevel ?? "",
    transcriptPath: raw.transcriptPath ?? "",
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    // Live state is NOT restored — see the module comment.
    phase: "idle",
    promptStartedAt: 0,
    subagents: [],
    approvalMessage: null,
    approvalSource: null,
    approvalSeq: 0,
    awaitingUserChoice: null,
    approvalIsQuestion: false,
    errorType: null,
    errorMessage: null,
    ended: false,
    endedReason: "",
  };
}

/** Seed a registry from `path`. Silent no-op on missing/corrupt files —
 *  boot-time IO must never throw. Returns how many sessions loaded. */
export function loadInto(
  path: string,
  registry: ClaudeSessionRegistry,
): number {
  try {
    if (!existsSync(path)) return 0;
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as PersistedFile;
    if (!parsed || parsed.format !== FORMAT) return 0;
    if (!Array.isArray(parsed.sessions)) return 0;
    let n = 0;
    for (const raw of parsed.sessions) {
      if (!raw || typeof raw.sessionId !== "string" || !raw.sessionId) continue;
      // Ended sessions are not worth restoring — they exist only so the
      // presenter can tear their UI down, which already happened.
      if (raw.ended) continue;
      registry.restore(sanitizeForRestore(raw));
      n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Debounced writer suitable for `registry.onChange`. Fire-and-forget:
 *  callers never await IO from inside event ingestion. */
export function createDebouncedPersister(
  path: string,
  registry: ClaudeSessionRegistry,
  delayMs = 800,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        const payload: PersistedFile = {
          format: FORMAT,
          // Only sessions worth reviving: live, and carrying something
          // a restart would otherwise lose.
          sessions: registry.list().filter((s) => s.tasks.length > 0),
        };
        writeFileAtomic(path, JSON.stringify(payload));
      } catch {
        /* a busted FS must never break the registry */
      }
    }, delayMs);
  };
}
