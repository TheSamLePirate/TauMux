/**
 * WS5 — ClaudeAgentManager driven by a fake SDK `query` (no subprocess).
 */
import { describe, test, expect } from "bun:test";
import type {
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentManager } from "../src/bun/claude-agent-manager";

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<PermissionResult>;

/** Fake SDK: replies to every user turn with one assistant message and a
 *  result; exposes the received inputs + the canUseTool callback. */
function makeFakeQuery() {
  const received: SDKUserMessage[] = [];
  let canUseTool: CanUseTool | undefined;
  let interrupted = 0;
  const setModels: Array<string | undefined> = [];

  const queryFn = ((params: {
    prompt: AsyncIterable<SDKUserMessage>;
    options?: Record<string, unknown>;
  }) => {
    canUseTool = params.options?.["canUseTool"] as CanUseTool | undefined;
    const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
      yield {
        type: "system",
        subtype: "init",
        session_id: "sdk-sess-1",
        model: "claude-opus-5",
        permissionMode: "default",
      } as unknown as SDKMessage;
      for await (const user of params.prompt) {
        received.push(user);
        yield {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hi" }],
          },
          session_id: "sdk-sess-1",
        } as unknown as SDKMessage;
        yield {
          type: "result",
          subtype: "success",
          total_cost_usd: 0.12,
          session_id: "sdk-sess-1",
        } as unknown as SDKMessage;
      }
    })();
    const q = gen as unknown as Query & Record<string, unknown>;
    q["interrupt"] = async () => {
      interrupted += 1;
      return undefined as unknown;
    };
    q["setModel"] = async (m: string | undefined) => {
      setModels.push(m);
    };
    q["setPermissionMode"] = async () => {};
    return q;
  }) as unknown as typeof import("@anthropic-ai/claude-agent-sdk").query;

  return {
    queryFn,
    received,
    askedTool: () => canUseTool,
    interruptCount: () => interrupted,
    setModels,
  };
}

async function drainUntil(
  events: SDKMessage[],
  pred: () => boolean,
  ms = 2000,
): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) {
      throw new Error(`condition not met; events=${JSON.stringify(events)}`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("ClaudeAgentManager", () => {
  test("prompt round-trip: events stream, state digests model/cost", async () => {
    const fake = makeFakeQuery();
    const mgr = new ClaudeAgentManager({ queryFn: fake.queryFn });
    const inst = mgr.create({ cwd: "/tmp" });
    const events: SDKMessage[] = [];
    inst.onEvent = (e) => events.push(e);

    inst.prompt("hello there");
    await drainUntil(events, () =>
      events.some((e) => (e as { type: string }).type === "result"),
    );

    expect(fake.received).toHaveLength(1);
    const content = fake.received[0]!.message.content;
    expect(JSON.stringify(content)).toContain("hello there");
    expect(inst.state.sessionId).toBe("sdk-sess-1");
    expect(inst.state.model).toBe("claude-opus-5");
    expect(inst.state.totalCostUsd).toBe(0.12);
    expect(inst.state.isStreaming).toBe(false);
    await mgr.dispose();
  });

  test("canUseTool routes through askUser: allow and deny paths", async () => {
    const fake = makeFakeQuery();
    const answers: Array<"allow" | "deny" | null> = ["allow", "deny", null];
    const asked: string[] = [];
    const mgr = new ClaudeAgentManager({
      queryFn: fake.queryFn,
      askUser: async ({ toolName }) => {
        asked.push(toolName);
        return answers.shift() ?? null;
      },
    });
    const inst = mgr.create({});
    const events: SDKMessage[] = [];
    inst.onEvent = (e) => events.push(e);
    inst.prompt("x");
    await drainUntil(events, () => events.length >= 1);

    const canUse = fake.askedTool()!;
    expect(canUse).toBeDefined();
    const r1 = await canUse("Bash", { command: "ls" });
    expect(r1.behavior).toBe("allow");
    const r2 = await canUse("Write", { file_path: "/x" });
    expect(r2.behavior).toBe("deny");
    const r3 = await canUse("Bash", { command: "rm" });
    expect(r3.behavior).toBe("deny"); // timeout → deny, with a distinct message
    expect((r3 as { message?: string }).message).toContain("timed out");
    expect(asked).toEqual(["Bash", "Write", "Bash"]);
    await mgr.dispose();
  });

  test("no askUser wired → tools auto-allow (SDK default trust)", async () => {
    const fake = makeFakeQuery();
    const mgr = new ClaudeAgentManager({ queryFn: fake.queryFn });
    const inst = mgr.create({});
    inst.prompt("x");
    const events: SDKMessage[] = [];
    inst.onEvent = (e) => events.push(e);
    await drainUntil(events, () => fake.askedTool() !== undefined);
    const r = await fake.askedTool()!("Bash", { command: "ls" });
    expect(r.behavior).toBe("allow");
    await mgr.dispose();
  });

  test("close ends the stream and fires onExit exactly once", async () => {
    const fake = makeFakeQuery();
    const mgr = new ClaudeAgentManager({ queryFn: fake.queryFn });
    const inst = mgr.create({});
    let exits = 0;
    inst.onExit = () => {
      exits += 1;
    };
    await mgr.close(inst.id);
    await drainUntil([], () => exits === 1);
    expect(inst.state.exited).toBe(true);
    expect(fake.interruptCount()).toBe(1);
    expect(mgr.get(inst.id)).toBeUndefined();
    // idempotent
    expect(await mgr.close(inst.id)).toBe(false);
  });

  test("a crashing stream reports the error through onExit", async () => {
    const boomQuery = ((_p: unknown) => {
      const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
        yield { type: "system", subtype: "init" } as unknown as SDKMessage;
        throw new Error("subprocess died");
      })();
      const q = gen as unknown as Query & Record<string, unknown>;
      q["interrupt"] = async () => undefined;
      return q;
    }) as unknown as typeof import("@anthropic-ai/claude-agent-sdk").query;
    const mgr = new ClaudeAgentManager({ queryFn: boomQuery });
    const inst = mgr.create({});
    let exitError: string | null = null;
    let fired = 0;
    inst.onExit = (e) => {
      fired += 1;
      exitError = e;
    };
    await drainUntil([], () => fired === 1);
    expect(exitError).toContain("subprocess died");
    expect(inst.state.exited).toBe(true);
  });

  test("a throwing onEvent consumer does not kill the stream", async () => {
    const fake = makeFakeQuery();
    const mgr = new ClaudeAgentManager({ queryFn: fake.queryFn });
    const inst = mgr.create({});
    let seen = 0;
    inst.onEvent = () => {
      seen += 1;
      throw new Error("consumer bug");
    };
    inst.prompt("x");
    await drainUntil([], () => seen >= 3);
    expect(inst.state.exited).toBe(false);
    await mgr.dispose();
  });

  test("replace rebinds a fresh instance under the SAME id and silences the old one", async () => {
    const fake = makeFakeQuery();
    const mgr = new ClaudeAgentManager({ queryFn: fake.queryFn });
    const first = mgr.create({});
    const id = first.id;
    let oldExitSeen = 0;
    first.onExit = () => {
      oldExitSeen += 1;
    };
    const second = await mgr.replace(id, { resume: "old-session" });
    expect(second.id).toBe(id);
    expect(mgr.get(id)).toBe(second);
    // The old pump drains asynchronously after close(); give it a tick.
    await new Promise((r) => setTimeout(r, 20));
    expect(first.state.exited).toBe(true);
    // The pane must NOT get a "session ended" from the old stream after
    // the swap — replace detaches observers before closing.
    expect(oldExitSeen).toBe(0);
    expect(second.config.resume).toBe("old-session");
    await mgr.dispose();
  });

  test("ids are stable and sequential per manager", () => {
    const fake = makeFakeQuery();
    const mgr = new ClaudeAgentManager({ queryFn: fake.queryFn });
    expect(mgr.create({}).id).toBe("claude-agent:1");
    expect(mgr.create({}).id).toBe("claude-agent:2");
    expect(mgr.list()).toHaveLength(2);
  });
});
