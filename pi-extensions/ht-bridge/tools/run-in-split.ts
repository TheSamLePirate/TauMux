/**
 * `ht_run_in_split` — pi/typebox glue. Pure execution logic lives in
 * `run-in-split-core.ts` so the unit tests don't need to resolve
 * pi-coding-agent / typebox out of the repo's node_modules.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";
import { executeRunInSplit } from "./run-in-split-core";

const DIRECTION = StringEnum(["right", "left", "up", "down"] as const, {
  description:
    "Where to put the new split relative to pi's own pane. Default: right.",
});

const PARAMS = Type.Object({
  command: Type.String({
    description:
      "Shell command to execute in the new split. Sent verbatim followed by Enter.",
  }),
  direction: Type.Optional(DIRECTION),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the new shell. Defaults to inheriting from the parent pane.",
    }),
  ),
  shell: Type.Optional(
    Type.String({
      description:
        "Override the shell binary for this split only (e.g. /bin/zsh). Default: user's login shell.",
    }),
  ),
  ratio: Type.Optional(
    Type.Number({ description: "Split ratio 0.0–1.0. Default 0.5." }),
  ),
  label: Type.Optional(
    Type.String({
      description:
        "Short human-readable label for what this command is doing — surfaced in the tool result so the user knows why a new pane appeared.",
    }),
  ),
});

export function registerRunInSplitTool(
  pi: ExtensionAPI,
  cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): void {
  pi.registerTool({
    name: "ht_run_in_split",
    label: "Run in split (τ-mux)",
    description:
      "Spawn a new τ-mux terminal split next to pi's pane and run a command in it. Use for long-running commands the user should watch — dev servers, log tails, file watchers, build watchers, test runners — rather than the bash tool, which captures output and blocks pi until the command exits. The user can interact with the new pane directly; pi receives only the new surface id, not the command's output.",
    promptSnippet:
      "Spawn a long-running command in a sibling τ-mux split for the user to watch live.",
    promptGuidelines: [
      "Use ht_run_in_split for long-running or interactive commands the user should watch live (dev servers like `npm run dev`, log tails like `tail -f`, file watchers, test runners).",
      "Do NOT use ht_run_in_split for one-shot commands whose output you need back in the conversation — use the bash tool instead.",
      "Prefer direction='right' (the default) so the user's reading flow isn't disrupted; only override when there's a layout reason.",
      "Pass `label` to describe what's running so the tool result reads naturally to the user.",
    ],
    parameters: PARAMS as any,
    async execute(_id, params: any) {
      return executeRunInSplit(params, cfg, ht, surface);
    },
  } as any);
}
