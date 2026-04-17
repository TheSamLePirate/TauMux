import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function loadModule() {
  return await import("../src/views/terminal/agent-events");
}

function emit(name: string, detail: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

type Mocks = ReturnType<typeof buildMocks>;

function buildMocks() {
  const rpc = { send: mock(() => {}) };
  const surfaceManager = {
    agentAddUserMessage: mock(() => {}),
  } as any;
  return { rpc, surfaceManager };
}

let teardown: (() => void) | null = null;
let mocks: Mocks | null = null;

beforeEach(async () => {
  mocks = buildMocks();
  const { registerAgentEvents } = await loadModule();
  teardown = registerAgentEvents(mocks.rpc, mocks.surfaceManager);
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe("registerAgentEvents — pure routes", () => {
  test("ht-agent-abort → agentAbort (requires agentId)", () => {
    emit("ht-agent-abort", {});
    expect(mocks!.rpc.send).not.toHaveBeenCalled();
    emit("ht-agent-abort", { agentId: "a1" });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentAbort", {
      agentId: "a1",
    });
  });

  test("ht-agent-set-model requires agentId, provider, modelId", () => {
    emit("ht-agent-set-model", { agentId: "a1", provider: "p" });
    expect(mocks!.rpc.send).not.toHaveBeenCalled();
    emit("ht-agent-set-model", {
      agentId: "a1",
      provider: "p",
      modelId: "m",
    });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentSetModel", {
      agentId: "a1",
      provider: "p",
      modelId: "m",
    });
  });

  test("ht-agent-steer forwards agentId, message, images", () => {
    emit("ht-agent-steer", {
      agentId: "a1",
      message: "hi",
      images: [{ type: "image", data: "x", mimeType: "image/png" }],
    });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentSteer", {
      agentId: "a1",
      message: "hi",
      images: [{ type: "image", data: "x", mimeType: "image/png" }],
    });
  });

  test("ht-agent-bash forwards command + timeout", () => {
    emit("ht-agent-bash", {
      agentId: "a1",
      command: "ls",
      timeout: 5000,
    });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentBash", {
      agentId: "a1",
      command: "ls",
      timeout: 5000,
    });
  });

  test("ht-agent-bash drops events without command", () => {
    emit("ht-agent-bash", { agentId: "a1" });
    expect(mocks!.rpc.send).not.toHaveBeenCalled();
  });

  test("ht-agent-compact → agentCompact", () => {
    emit("ht-agent-compact", { agentId: "a1" });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentCompact", {
      agentId: "a1",
    });
  });

  test("ht-agent-export-html forwards outputPath", () => {
    emit("ht-agent-export-html", {
      agentId: "a1",
      outputPath: "/tmp/out.html",
    });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentExportHtml", {
      agentId: "a1",
      outputPath: "/tmp/out.html",
    });
  });
});

describe("registerAgentEvents — nullable-enabled routes", () => {
  test("ht-agent-set-auto-compaction accepts enabled=false", () => {
    emit("ht-agent-set-auto-compaction", {
      agentId: "a1",
      enabled: false,
    });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentSetAutoCompaction", {
      agentId: "a1",
      enabled: false,
    });
  });

  test("ht-agent-set-auto-compaction drops when enabled=null", () => {
    emit("ht-agent-set-auto-compaction", {
      agentId: "a1",
      enabled: null as unknown as boolean,
    });
    expect(mocks!.rpc.send).not.toHaveBeenCalled();
  });

  test("ht-agent-set-auto-retry accepts enabled=true", () => {
    emit("ht-agent-set-auto-retry", {
      agentId: "a1",
      enabled: true,
    });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentSetAutoRetry", {
      agentId: "a1",
      enabled: true,
    });
  });
});

describe("registerAgentEvents — ht-agent-prompt special case", () => {
  test("prompt echoes into surfaceManager and forwards to rpc", () => {
    emit("ht-agent-prompt", {
      agentId: "a1",
      message: "hello",
      images: [],
    });
    expect(mocks!.surfaceManager.agentAddUserMessage).toHaveBeenCalledWith(
      "a1",
      "hello",
      [],
    );
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentPrompt", {
      agentId: "a1",
      message: "hello",
      images: [],
    });
  });

  test("prompt drops on missing message", () => {
    emit("ht-agent-prompt", { agentId: "a1" });
    expect(mocks!.surfaceManager.agentAddUserMessage).not.toHaveBeenCalled();
    expect(mocks!.rpc.send).not.toHaveBeenCalled();
  });
});

describe("registerAgentEvents — extension-ui-response", () => {
  test("cancel-fallback sends cancelled:true when response missing", () => {
    emit("ht-agent-extension-ui-response", {
      agentId: "a1",
      id: "ui1",
    });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentExtensionUIResponse", {
      agentId: "a1",
      id: "ui1",
      response: { cancelled: true },
    });
  });

  test("forwards explicit response body", () => {
    emit("ht-agent-extension-ui-response", {
      agentId: "a1",
      id: "ui1",
      response: { choice: "yes" },
    });
    expect(mocks!.rpc.send).toHaveBeenCalledWith("agentExtensionUIResponse", {
      agentId: "a1",
      id: "ui1",
      response: { choice: "yes" },
    });
  });

  test("drops when agentId or id missing", () => {
    emit("ht-agent-extension-ui-response", { agentId: "a1" });
    expect(mocks!.rpc.send).not.toHaveBeenCalled();
  });
});

describe("registerAgentEvents teardown", () => {
  test("teardown detaches all listeners", () => {
    teardown?.();
    teardown = null;
    emit("ht-agent-abort", { agentId: "a1" });
    emit("ht-agent-prompt", { agentId: "a1", message: "hi" });
    expect(mocks!.rpc.send).not.toHaveBeenCalled();
  });
});
