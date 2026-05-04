/**
 * Fast-model summarization for active-label and agent-end pills.
 *
 * Calls a small model (Haiku by default) with `reasoningEffort: "off"`
 * so it returns in <1 s, then post-processes the reply to enforce the
 * configured length window. On any failure (no API key, timeout, junk
 * text) returns the supplied fallback so the UI never goes empty.
 */

import { complete, getModel } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Config } from "./config";
import { debugEnabled } from "./config";
import type { TurnSlice } from "./messages";

export const FALLBACK_START = "Working";
export const FALLBACK_END = "Task complete";

export function taskPrompt(cfg: Config, userText: string): string {
  const { minWords, maxWords } = cfg;
  return [
    `You write ultra-short active task labels.`,
    `In ${minWords}-${maxWords} words, describe what an AI assistant is ABOUT to do for the user.`,
    `Rules:`,
    `- Output ONLY the label. No quotes, no trailing punctuation, no prefix.`,
    `- Title Case.`,
    `- Present-continuous or gerund form when natural ("Fixing Login Bug", "Reading Config Files").`,
    `- Never exceed ${maxWords} words.`,
    ``,
    `<user_request>`,
    userText || "(no user text)",
    `</user_request>`,
  ].join("\n");
}

export function donePrompt(cfg: Config, slice: TurnSlice): string {
  const { minWords, maxWords } = cfg;
  return [
    `You write ultra-short task summaries.`,
    `Summarize what the AI assistant just did for the user in ${minWords}-${maxWords} words.`,
    `Rules:`,
    `- Output ONLY the summary. No quotes, no trailing punctuation, no prefix.`,
    `- Title Case.`,
    `- Past-tense or noun-phrase ("Fixed Login Bug", "Added Payment Tests").`,
    `- Never exceed ${maxWords} words.`,
    ``,
    `<user_request>`,
    slice.userPrompt || "(no user text)",
    `</user_request>`,
    ``,
    `<assistant_reply_tail>`,
    slice.assistantTail.slice(-1200) || "(no assistant text)",
    `</assistant_reply_tail>`,
  ].join("\n");
}

export function cleanSummary(
  raw: string,
  cfg: Config,
  fallback: string,
): string {
  let s = (raw || "").trim();
  s = s.replace(/^["'`]+|["'`]+$/g, "");
  s = s.replace(/^(summary|label|title)\s*[:\-]\s*/i, "");
  s = s.split(/\s+/).filter(Boolean).slice(0, cfg.maxWords).join(" ");
  s = s.replace(/[.!?,;:]+$/g, "");
  return s || fallback;
}

export async function callFastModel(
  cfg: Config,
  ctx: ExtensionContext,
  prompt: string,
  fallback: string,
): Promise<string> {
  // Prefer the active pi session's model so label/summary calls follow
  // whatever the user has selected in pi (auth + base URL match too).
  // Fall back to the configured fast model when the session has no
  // model yet, or when the user explicitly opts out via config.
  const sessionModel = cfg.useSessionModel ? ctx.model : undefined;
  const model = sessionModel ?? getModel(cfg.provider, cfg.modelId);
  if (!model) return fallback;

  if (debugEnabled()) {
    const source = sessionModel ? "session" : "config";
    console.error(
      `[ht-bridge] fast-model: using ${source} model ${(model as any).id ?? "?"}`,
    );
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth?.ok || !auth.apiKey) return fallback;

  try {
    const response = await complete(
      model,
      {
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: prompt }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        reasoningEffort: "off",
      },
    );

    const text = response.content
      .filter(
        (c: any): c is { type: "text"; text: string } => c?.type === "text",
      )
      .map((c: any) => c.text)
      .join(" ")
      .trim();

    return cleanSummary(text, cfg, fallback);
  } catch (err) {
    if (debugEnabled()) {
      console.error(
        `[ht-bridge] fast-model call failed: ${(err as Error).message}`,
      );
    }
    return fallback;
  }
}
