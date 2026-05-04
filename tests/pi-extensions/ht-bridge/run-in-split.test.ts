/**
 * ht_run_in_split — exercise the full execute() RPC sequence against
 * a recording HtClient. The pi/typebox glue lives in
 * `tools/run-in-split.ts`; the testable logic is in
 * `tools/run-in-split-core.ts`, imported here directly so the test
 * doesn't need to resolve pi-coding-agent or typebox.
 */

import { describe, expect, test } from "bun:test";
import {
  executeRunInSplit,
  type RunInSplitParams,
} from "../../../pi-extensions/ht-bridge/tools/run-in-split-core";
import {
  DEFAULT_CONFIG,
  type Config,
} from "../../../pi-extensions/ht-bridge/lib/config";
import type { HtClient } from "../../../pi-extensions/ht-bridge/lib/ht-client";

function recordingHt(replies: Record<string, any>, capture: any[]): HtClient {
  return {
    call: async (method: string, params?: object) => {
      capture.push({ method, params });
      if (Object.prototype.hasOwnProperty.call(replies, method)) {
        const r = replies[method];
        if (r instanceof Error) throw r;
        return r;
      }
      return undefined;
    },
    callSoft: () => {},
    socketAvailable: () => true,
  };
}

const CFG: Config = { ...DEFAULT_CONFIG };
const SURFACE = {
  surfaceId: "surface:1",
  workspaceId: "ws:0",
  agentId: "pi:surface:1",
  inTauMux: true,
  cwd: "/Users/me/code/foo",
  fg: "zsh",
};
const NO_SURFACE = {
  surfaceId: "",
  workspaceId: null,
  agentId: "pi:1234",
  inTauMux: false,
  cwd: null,
  fg: null,
};

async function run(
  params: RunInSplitParams,
  replies: Record<string, any>,
  cfg: Config = CFG,
  surface = SURFACE,
) {
  const calls: any[] = [];
  const ht = recordingHt(replies, calls);
  const result = await executeRunInSplit(params, cfg, ht, surface);
  return { result, calls };
}

describe("executeRunInSplit", () => {
  test("happy path: split → wait_ready → send_text → returns surface id", async () => {
    const { result, calls } = await run(
      { command: "npm run dev" },
      {
        "surface.split": { id: "surface:42" },
        "surface.wait_ready": null,
        "surface.send_text": { bytes: 13 },
      },
    );
    expect(result.isError).toBeFalsy();
    expect(result.details).toMatchObject({
      surfaceId: "surface:42",
      command: "npm run dev",
      direction: "right",
    });
    const methods = calls.map((c) => c.method);
    expect(methods).toContain("surface.split");
    expect(methods).toContain("surface.send_text");
    const sendCall = calls.find((c) => c.method === "surface.send_text");
    expect(sendCall.params).toMatchObject({
      surface_id: "surface:42",
      text: "npm run dev\r",
    });
  });

  test("propagates the chosen direction + cwd into surface.split", async () => {
    const { calls } = await run(
      {
        command: "tail -f /var/log/app.log",
        direction: "down",
        cwd: "/var/log",
      },
      { "surface.split": { id: "surface:99" }, "surface.send_text": "OK" },
    );
    const splitCall = calls.find((c) => c.method === "surface.split");
    expect(splitCall.params).toMatchObject({
      surface_id: "surface:1",
      direction: "down",
      cwd: "/var/log",
    });
  });

  test("blocks risky commands via the bash-safety gate", async () => {
    // User clicks "cancel" on the τ-mux modal.
    const { result, calls } = await run(
      { command: "rm -rf /tmp/build" },
      { "agent.ask_user": { action: "cancel" } },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/blocked/i);
    // Crucially: surface.split must NOT have been called.
    expect(calls.find((c) => c.method === "surface.split")).toBeUndefined();
  });

  test("errors clearly when running outside τ-mux (no surfaceId)", async () => {
    const { result } = await run({ command: "ls" }, {}, CFG, NO_SURFACE);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not running inside a τ-mux pane/i);
  });

  test("errors when surface.split returns no id", async () => {
    const { result } = await run(
      { command: "echo hi" },
      { "surface.split": {} },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no id/i);
  });

  test("rejects empty command", async () => {
    const { result } = await run({ command: "   " }, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/empty/i);
  });

  test("surfaces send_text failure but reports the spawned surface id", async () => {
    const { result } = await run(
      { command: "npm run dev" },
      {
        "surface.split": { id: "surface:42" },
        "surface.send_text": new Error("PTY closed"),
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/surface:42/);
    expect(result.details).toMatchObject({ surfaceId: "surface:42" });
  });

  test("includes label in the success message when supplied", async () => {
    const { result } = await run(
      { command: "npm run dev", label: "dev server" },
      {
        "surface.split": { id: "surface:42" },
        "surface.send_text": "OK",
      },
    );
    expect(result.content[0]?.text).toMatch(/dev server/);
    expect(result.details).toMatchObject({ label: "dev server" });
  });
});
