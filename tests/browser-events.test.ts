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
  return await import("../src/views/terminal/browser-events");
}

function emit(name: string, detail: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

let teardown: (() => void) | null = null;
let rpc: { send: ReturnType<typeof mock> };

beforeEach(async () => {
  rpc = { send: mock(() => {}) };
  const { registerBrowserEvents } = await loadModule();
  teardown = registerBrowserEvents(rpc);
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe("registerBrowserEvents — routes", () => {
  test("ht-browser-navigated fills defaults for url/title", () => {
    emit("ht-browser-navigated", { surfaceId: "s1" });
    expect(rpc.send).toHaveBeenCalledWith("browserNavigated", {
      surfaceId: "s1",
      url: "",
      title: "",
    });
  });

  test("ht-browser-navigated requires surfaceId", () => {
    emit("ht-browser-navigated", { url: "https://example.com" });
    expect(rpc.send).not.toHaveBeenCalled();
  });

  test("ht-browser-title-changed forwards title", () => {
    emit("ht-browser-title-changed", { surfaceId: "s1", title: "Hello" });
    expect(rpc.send).toHaveBeenCalledWith("browserTitleChanged", {
      surfaceId: "s1",
      title: "Hello",
    });
  });

  test("ht-browser-eval-result requires surfaceId and reqId", () => {
    emit("ht-browser-eval-result", { surfaceId: "s1" });
    expect(rpc.send).not.toHaveBeenCalled();
    emit("ht-browser-eval-result", {
      surfaceId: "s1",
      reqId: "r1",
      result: "42",
    });
    expect(rpc.send).toHaveBeenCalledWith("browserEvalResult", {
      surfaceId: "s1",
      reqId: "r1",
      result: "42",
      error: undefined,
    });
  });

  test("ht-browser-zoom defaults zoom to 1.0", () => {
    emit("ht-browser-zoom", { surfaceId: "s1" });
    expect(rpc.send).toHaveBeenCalledWith("browserSetZoom", {
      surfaceId: "s1",
      zoom: 1.0,
    });
  });

  test("ht-browser-zoom forwards explicit zoom value", () => {
    emit("ht-browser-zoom", { surfaceId: "s1", zoom: 1.5 });
    expect(rpc.send).toHaveBeenCalledWith("browserSetZoom", {
      surfaceId: "s1",
      zoom: 1.5,
    });
  });

  test("ht-browser-console-log fills level/args/timestamp defaults", () => {
    emit("ht-browser-console-log", { surfaceId: "s1" });
    const [method, payload] = rpc.send.mock.calls[0]!;
    expect(method).toBe("browserConsoleLog");
    expect(payload).toMatchObject({
      surfaceId: "s1",
      level: "log",
      args: [],
    });
    expect(typeof (payload as any).timestamp).toBe("number");
  });

  test("ht-browser-error defaults message to empty string", () => {
    emit("ht-browser-error", { surfaceId: "s1" });
    const [method, payload] = rpc.send.mock.calls[0]!;
    expect(method).toBe("browserError");
    expect(payload).toMatchObject({
      surfaceId: "s1",
      message: "",
    });
  });

  test("ht-browser-dom-ready requires url", () => {
    emit("ht-browser-dom-ready", { surfaceId: "s1" });
    expect(rpc.send).not.toHaveBeenCalled();
    emit("ht-browser-dom-ready", {
      surfaceId: "s1",
      url: "https://example.com",
    });
    expect(rpc.send).toHaveBeenCalledWith("browserDomReady", {
      surfaceId: "s1",
      url: "https://example.com",
    });
  });
});

describe("registerBrowserEvents — cookie actions", () => {
  test("ht-cookie-import requires data field", () => {
    emit("ht-cookie-import", {});
    expect(rpc.send).not.toHaveBeenCalled();
  });

  test("ht-cookie-import forwards data and format", () => {
    emit("ht-cookie-import", { data: "cookies.json", format: "json" });
    expect(rpc.send).toHaveBeenCalledWith("browserCookieAction", {
      action: "import",
      data: "cookies.json",
      format: "json",
    });
  });

  test("ht-cookie-export defaults format to json", () => {
    emit("ht-cookie-export", {});
    expect(rpc.send).toHaveBeenCalledWith("browserCookieAction", {
      action: "export",
      format: "json",
    });
  });

  test("ht-cookie-export respects explicit format", () => {
    emit("ht-cookie-export", { format: "netscape" });
    expect(rpc.send).toHaveBeenCalledWith("browserCookieAction", {
      action: "export",
      format: "netscape",
    });
  });

  test("ht-cookie-clear sends clear action with no payload fields", () => {
    emit("ht-cookie-clear", {});
    expect(rpc.send).toHaveBeenCalledWith("browserCookieAction", {
      action: "clear",
    });
  });
});

describe("registerBrowserEvents teardown", () => {
  test("teardown detaches listeners", () => {
    teardown?.();
    teardown = null;
    emit("ht-browser-navigated", { surfaceId: "s1" });
    emit("ht-cookie-clear", {});
    expect(rpc.send).not.toHaveBeenCalled();
  });
});
