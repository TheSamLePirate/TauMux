// Plan #09 commit C — auto-continue RPC handler unit tests.
//
// Drives the handler map directly without spawning the socket
// server. Verifies status / audit / set / fire / pause / resume
// shapes against the engine + a tiny in-memory settings stub.

import { describe, expect, mock, test } from "bun:test";
import {
  registerAutoContinue,
  type AutoContinueDeps,
} from "../src/bun/rpc-handlers/auto-continue";
import { AutoContinueEngine } from "../src/bun/auto-continue-engine";
import type { AutoContinueSettings } from "../src/shared/settings";
import type { AutoContinueHost } from "../src/bun/auto-continue-host";
import type { HandlerDeps } from "../src/bun/rpc-handlers/types";

function settings(
  overrides: Partial<AutoContinueSettings> = {},
): AutoContinueSettings {
  return {
    engine: "off",
    dryRun: true,
    cooldownMs: 3000,
    maxConsecutive: 5,
    modelProvider: "anthropic",
    modelName: "claude-haiku-4-5-20251001",
    modelApiKeyEnv: "ANTHROPIC_API_KEY",
    ...overrides,
  };
}

function build(initialSettings: AutoContinueSettings = settings()): {
  handlers: Record<string, (params: Record<string, unknown>) => unknown>;
  engine: AutoContinueEngine;
  host: AutoContinueHost;
  current: { autoContinue: AutoContinueSettings };
  fireNow: ReturnType<typeof mock>;
} {
  const current = { autoContinue: initialSettings };
  const engine = new AutoContinueEngine({
    getSettings: () => current.autoContinue,
    sendText: () => {},
  });
  const fireNow = mock(async () => ({ kind: "skipped", reason: "stub" }));
  const host: AutoContinueHost = {
    lookupPlanForSurface: () => null,
    lookupSurfaceTail: () => [],
    dispatchForNotification: () => {},
    fireNow,
  };
  const settingsManager = {
    get: () =>
      ({ autoContinue: current.autoContinue }) as {
        autoContinue: AutoContinueSettings;
      },
    update: (partial: { autoContinue?: AutoContinueSettings }) => {
      if (partial.autoContinue) current.autoContinue = partial.autoContinue;
      return { autoContinue: current.autoContinue };
    },
  };
  const deps: AutoContinueDeps = {
    engine,
    host,
    // Cast the stub — the handler only reads `.get()` and `.update()`.
    settingsManager:
      settingsManager as unknown as AutoContinueDeps["settingsManager"],
  };
  const handlers = registerAutoContinue({} as HandlerDeps, deps);
  return { handlers, engine, host, current, fireNow };
}

describe("registerAutoContinue", () => {
  test("autocontinue.status returns engine config + paused list", () => {
    const { handlers, engine } = build();
    engine.pause("s1");
    const out = handlers["autocontinue.status"]!({}) as {
      engine: string;
      paused: string[];
    };
    expect(out.engine).toBe("off");
    expect(out.paused).toEqual(["s1"]);
  });

  test("autocontinue.audit returns the most recent N entries", () => {
    const { handlers, engine } = build();
    engine.pause("s1");
    engine.pause("s2");
    engine.resume("s1");
    const out = handlers["autocontinue.audit"]!({ limit: 2 }) as {
      audit: { surfaceId: string }[];
    };
    expect(out.audit.length).toBe(2);
    expect(out.audit[1]?.surfaceId).toBe("s1"); // resumed event last
  });

  test("autocontinue.set persists a partial patch", () => {
    const { handlers, current } = build();
    handlers["autocontinue.set"]!({
      engine: "heuristic",
      dryRun: false,
      cooldownMs: 1000,
      maxConsecutive: 7,
    });
    expect(current.autoContinue.engine).toBe("heuristic");
    expect(current.autoContinue.dryRun).toBe(false);
    expect(current.autoContinue.cooldownMs).toBe(1000);
    expect(current.autoContinue.maxConsecutive).toBe(7);
  });

  test("autocontinue.set rejects unknown engine values", () => {
    const { handlers } = build();
    expect(() => handlers["autocontinue.set"]!({ engine: "wat" })).toThrow(
      /invalid engine/,
    );
  });

  test("autocontinue.fire requires surface_id and forwards through host.fireNow", async () => {
    const { handlers, fireNow } = build();
    const result = await handlers["autocontinue.fire"]!({
      surface_id: "s1",
      notification_text: "hello",
    });
    expect(fireNow).toHaveBeenCalledWith("s1", "hello");
    expect(result).toEqual({ outcome: { kind: "skipped", reason: "stub" } });
  });

  test("autocontinue.fire throws when surface_id is missing", () => {
    const { handlers } = build();
    expect(() => handlers["autocontinue.fire"]!({})).toThrow(/surface_id/);
  });

  test("autocontinue.pause / resume drive the engine and return paused list", () => {
    const { handlers, engine } = build();
    handlers["autocontinue.pause"]!({ surface_id: "s1" });
    expect(engine.isPaused("s1")).toBe(true);
    handlers["autocontinue.resume"]!({ surface_id: "s1" });
    expect(engine.isPaused("s1")).toBe(false);
  });
});
