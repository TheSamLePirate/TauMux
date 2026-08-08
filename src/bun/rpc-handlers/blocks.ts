/**
 * `blocks.*` — command blocks recovered from OSC 133 shell integration.
 *
 * The metadata poller answers "what is running"; this answers "what
 * ran, and how did it end". Nothing here works without the optional
 * integration installed (`ht shell-integration install`), which is why
 * every method reports `integration_detected` rather than silently
 * returning an empty list — "no commands yet" and "the shell is not
 * reporting" are different answers and a script needs to tell them
 * apart.
 */

import type { Handler, HandlerDeps } from "./types";
import { resolveSurfaceId } from "./shared";
import type { CommandBlock } from "../command-blocks";

/** Wire shape. snake_case to match the rest of the socket API. */
interface BlockDto {
  id: number;
  command: string;
  exit_code: number | null;
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  running: boolean;
  output?: string;
  output_truncated?: boolean;
}

function toDto(block: CommandBlock, includeOutput: boolean): BlockDto {
  const dto: BlockDto = {
    id: block.id,
    command: block.command,
    exit_code: block.exitCode,
    started_at: block.startedAt,
    ended_at: block.endedAt,
    duration_ms: block.durationMs,
    running: block.endedAt === null,
  };
  if (includeOutput) {
    dto.output = block.output;
    dto.output_truncated = block.outputTruncated;
  }
  return dto;
}

export function registerBlocks(deps: HandlerDeps): Record<string, Handler> {
  const { sessions, getState } = deps;

  const surfaceFor = (params: Record<string, unknown>) => {
    const id = resolveSurfaceId(params, getState().focusedSurfaceId);
    return id ? sessions.getSurface(id) : undefined;
  };

  return {
    /** Completed blocks for a surface, oldest first. Output is omitted
     *  unless asked for — a 50-block list with output attached is a
     *  megabyte-scale response nobody wanted. */
    "blocks.list": (params) => {
      const surface = surfaceFor(params);
      if (!surface) return { integration_detected: false, blocks: [] };
      const withOutput = params["output"] === true;
      const limitRaw = Number(params["limit"]);
      const all = surface.blocks.list();
      const limited =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? all.slice(-Math.floor(limitRaw))
          : all;
      return {
        integration_detected: surface.blocks.integrationDetected,
        blocks: limited.map((b) => toDto(b, withOutput)),
      };
    },

    /** The most recently finished block, with its output. The shape
     *  automation actually wants: "did that succeed, and what did it
     *  print". */
    "blocks.last": (params) => {
      const surface = surfaceFor(params);
      if (!surface) return { integration_detected: false, block: null };
      const block = surface.blocks.last();
      return {
        integration_detected: surface.blocks.integrationDetected,
        block: block ? toDto(block, params["output"] !== false) : null,
      };
    },

    /** The command executing right now, if any. Distinct from
     *  `surface.metadata`'s foreground command: this is the shell's own
     *  account of what it launched, not a pid-tree inference. */
    "blocks.current": (params) => {
      const surface = surfaceFor(params);
      if (!surface) return { integration_detected: false, block: null };
      const block = surface.blocks.current();
      return {
        integration_detected: surface.blocks.integrationDetected,
        block: block ? toDto(block, params["output"] === true) : null,
      };
    },
  };
}
