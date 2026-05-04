/**
 * Active-label observer — the "Pi : <task>" sidebar pill.
 *
 *   before_agent_start → instant "Thinking…" pill, fast-model upgrade.
 *   agent_end          → clear pill + notification "Agent End : <summary>".
 *   session_shutdown   → safety-net clear so a stale pill never lingers.
 *
 * Calls go through the shared HtClient (socket-first, CLI fallback)
 * so agent_end's notification benefits from the same low-latency path
 * as the other observers.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import { debugEnabled } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import { formatDuration, sliceTurn, truncate } from "../lib/messages";
import {
  callFastModel,
  donePrompt,
  FALLBACK_END,
  FALLBACK_START,
  taskPrompt,
} from "../lib/summarizer";

export function registerActiveLabel(
  pi: ExtensionAPI,
  cfg: Config,
  ht: HtClient,
): void {
  // Incrementing token so a late-arriving fast-model reply for turn N
  // can never overwrite the status of turn N+1.
  let turnToken = 0;
  let turnStartMs = 0;

  const setStatus = (value: string) => {
    ht.callSoft("sidebar.set_status", {
      key: cfg.statusKey,
      value,
      icon: cfg.statusIcon,
      color: cfg.statusColor,
    });
  };
  const clearStatus = () => {
    ht.callSoft("sidebar.clear_status", { key: cfg.statusKey });
  };

  pi.on("before_agent_start", (event: any, ctx: ExtensionContext) => {
    const myToken = ++turnToken;
    turnStartMs = Date.now();
    const userText = typeof event?.prompt === "string" ? event.prompt : "";

    setStatus("Thinking…");

    // Fire-and-forget — never block the agent loop on the summarizer.
    (async () => {
      const label = await callFastModel(
        cfg,
        ctx,
        taskPrompt(cfg, userText),
        FALLBACK_START,
      );
      if (myToken === turnToken) setStatus(label);
    })().catch(() => {
      /* swallowed — fallback already shown */
    });
  });

  pi.on("agent_end", async (event: any, ctx: ExtensionContext) => {
    const elapsedMs = turnStartMs > 0 ? Date.now() - turnStartMs : 0;
    turnStartMs = 0;
    turnToken++; // invalidate any in-flight start-status update
    clearStatus();

    try {
      const slice = sliceTurn(event?.messages ?? event);
      const summary = await callFastModel(
        cfg,
        ctx,
        donePrompt(cfg, slice),
        FALLBACK_END,
      );
      const duration = elapsedMs > 0 ? formatDuration(elapsedMs) : "";
      const prompt = truncate(slice.userPrompt || "Agent finished", 140);
      const body = duration ? `${prompt}\nTook ${duration}` : prompt;
      ht.callSoft("notification.create", {
        title: `Agent End : ${summary}`,
        body,
        subtitle: cfg.notifySubtitle,
      });
    } catch (err) {
      if (debugEnabled()) {
        console.error(`[ht-bridge] agent_end fatal: ${(err as Error).message}`);
      }
    }
  });

  pi.on("session_shutdown", () => {
    clearStatus();
  });
}
