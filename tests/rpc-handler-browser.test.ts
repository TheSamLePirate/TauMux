import { describe, test, expect } from "bun:test";
import { createRpcHandler } from "../src/bun/rpc-handler";
import { BrowserSurfaceManager } from "../src/bun/browser-surface-manager";
import { BrowserHistoryStore } from "../src/bun/browser-history";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Minimal mock SessionManager
const mockSessions = {
  getAllSurfaces: () => [],
  getSurface: () => undefined,
  closeSurface: () => {},
  writeStdin: () => {},
  renameSurface: () => {},
  surfaceCount: 0,
} as any;

function setup() {
  const browserSurfaces = new BrowserSurfaceManager();
  const dir = mkdtempSync(join(tmpdir(), "ht-rpc-browser-"));
  const browserHistory = new BrowserHistoryStore(dir);
  const pendingEvals = new Map<string, (v: string) => void>();
  const dispatched: { action: string; payload: any }[] = [];

  const state = {
    focusedSurfaceId: null as string | null,
    workspaces: [] as any[],
    activeWorkspaceId: null as string | null,
  };

  const handler = createRpcHandler(
    mockSessions,
    () => state,
    (action, payload) => dispatched.push({ action, payload }),
    undefined,
    undefined,
    browserSurfaces,
    browserHistory,
    pendingEvals,
  );

  return { handler, browserSurfaces, browserHistory, dispatched, state, pendingEvals };
}

describe("RPC handler browser methods", () => {
  test("browser.list returns empty initially", () => {
    const { handler } = setup();
    expect(handler("browser.list", {})).toEqual([]);
  });

  test("browser.open dispatches createBrowserSurface", () => {
    const { handler, dispatched } = setup();
    handler("browser.open", { url: "https://example.com" });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].action).toBe("createBrowserSurface");
    expect(dispatched[0].payload.url).toBe("https://example.com");
  });

  test("browser.open_split dispatches splitBrowserSurface", () => {
    const { handler, dispatched } = setup();
    handler("browser.open_split", { url: "https://example.com", direction: "down" });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].action).toBe("splitBrowserSurface");
    expect(dispatched[0].payload.direction).toBe("vertical");
  });

  test("browser.navigate dispatches browser.navigateTo", () => {
    const { handler, dispatched } = setup();
    handler("browser.navigate", { surface_id: "browser:1", url: "https://a.com" });
    expect(dispatched[0].action).toBe("browser.navigateTo");
  });

  test("browser.back dispatches browser.goBack", () => {
    const { handler, dispatched } = setup();
    handler("browser.back", { surface_id: "browser:1" });
    expect(dispatched[0].action).toBe("browser.goBack");
  });

  test("browser.forward dispatches browser.goForward", () => {
    const { handler, dispatched } = setup();
    handler("browser.forward", { surface_id: "browser:1" });
    expect(dispatched[0].action).toBe("browser.goForward");
  });

  test("browser.reload dispatches browser.reload", () => {
    const { handler, dispatched } = setup();
    handler("browser.reload", { surface_id: "browser:1" });
    expect(dispatched[0].action).toBe("browser.reload");
  });

  test("browser.url returns url from surface", () => {
    const { handler, browserSurfaces } = setup();
    const id = browserSurfaces.createSurface("https://github.com");
    const result = handler("browser.url", { surface_id: id });
    expect(result).toBe("https://github.com");
  });

  test("browser.click dispatches evalJs with click script", () => {
    const { handler, dispatched } = setup();
    handler("browser.click", { surface_id: "browser:1", selector: "#btn" });
    expect(dispatched[0].action).toBe("browser.evalJs");
    expect(dispatched[0].payload.script).toContain("click");
  });

  test("browser.fill dispatches evalJs with fill script", () => {
    const { handler, dispatched } = setup();
    handler("browser.fill", { surface_id: "browser:1", selector: "#email", text: "test@test.com" });
    expect(dispatched[0].action).toBe("browser.evalJs");
    expect(dispatched[0].payload.script).toContain("test@test.com");
  });

  test("browser.type dispatches evalJs with type script", () => {
    const { handler, dispatched } = setup();
    handler("browser.type", { surface_id: "browser:1", selector: "#input", text: "hello" });
    expect(dispatched[0].action).toBe("browser.evalJs");
    expect(dispatched[0].payload.script).toContain("hello");
  });

  test("browser.addscript dispatches evalJs", () => {
    const { handler, dispatched } = setup();
    handler("browser.addscript", { surface_id: "browser:1", script: "console.log('hi')" });
    expect(dispatched[0].action).toBe("browser.evalJs");
  });

  test("browser.addstyle dispatches evalJs with style injection", () => {
    const { handler, dispatched } = setup();
    handler("browser.addstyle", { surface_id: "browser:1", css: "body { color: red }" });
    expect(dispatched[0].action).toBe("browser.evalJs");
    expect(dispatched[0].payload.script).toContain("style");
  });

  test("browser.console_list returns captured logs", () => {
    const { handler, browserSurfaces } = setup();
    const id = browserSurfaces.createSurface();
    browserSurfaces.addConsoleLog(id, { level: "log", args: ["hello"], timestamp: 1000 });
    browserSurfaces.addConsoleLog(id, { level: "error", args: ["oops"], timestamp: 2000 });
    const result = handler("browser.console_list", { surface_id: id }) as any[];
    expect(result).toHaveLength(2);
    expect(result[0].level).toBe("log");
    expect(result[1].args[0]).toBe("oops");
  });

  test("browser.console_clear removes all logs", () => {
    const { handler, browserSurfaces } = setup();
    const id = browserSurfaces.createSurface();
    browserSurfaces.addConsoleLog(id, { level: "log", args: ["hello"], timestamp: 1000 });
    handler("browser.console_clear", { surface_id: id });
    const result = handler("browser.console_list", { surface_id: id }) as any[];
    expect(result).toHaveLength(0);
  });

  test("browser.errors_list returns captured errors", () => {
    const { handler, browserSurfaces } = setup();
    const id = browserSurfaces.createSurface();
    browserSurfaces.addError(id, { message: "TypeError", timestamp: 1000 });
    const result = handler("browser.errors_list", { surface_id: id }) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("TypeError");
  });

  test("browser.history returns recorded history", () => {
    const { handler, browserHistory } = setup();
    browserHistory.record("https://example.com", "Example");
    const result = handler("browser.history", {}) as any[];
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].url).toBe("https://example.com");
  });

  test("browser.clear_history clears history", () => {
    const { handler, browserHistory } = setup();
    browserHistory.record("https://example.com", "Example");
    handler("browser.clear_history", {});
    const result = handler("browser.history", {}) as any[];
    expect(result).toHaveLength(0);
  });

  test("browser.identify returns surface info", () => {
    const { handler, browserSurfaces } = setup();
    const id = browserSurfaces.createSurface("https://test.com");
    const result = handler("browser.identify", { surface_id: id }) as any;
    expect(result.id).toBe(id);
    expect(result.url).toBe("https://test.com");
  });

  test("browser.close removes surface", () => {
    const { handler, browserSurfaces } = setup();
    const id = browserSurfaces.createSurface();
    expect(browserSurfaces.surfaceCount).toBe(1);
    handler("browser.close", { surface_id: id });
    expect(browserSurfaces.surfaceCount).toBe(0);
  });

  test("browser.highlight dispatches evalJs with outline style", () => {
    const { handler, dispatched } = setup();
    handler("browser.highlight", { surface_id: "browser:1", selector: "#el" });
    expect(dispatched[0].payload.script).toContain("outline");
  });

  test("browser.scroll dispatches evalJs with scrollBy", () => {
    const { handler, dispatched } = setup();
    handler("browser.scroll", { surface_id: "browser:1", dy: 500 });
    expect(dispatched[0].payload.script).toContain("scrollBy");
  });

  test("browser.get rejects unknown getter", async () => {
    const { handler } = setup();
    try {
      await handler("browser.get", { surface_id: "browser:1", what: "nonexistent" });
      expect(false).toBe(true); // should not reach
    } catch (e: any) {
      expect(e.message).toContain("Unknown getter");
    }
  });

  test("browser.wait throws without condition", async () => {
    const { handler } = setup();
    try {
      await handler("browser.wait", { surface_id: "browser:1" });
      expect(false).toBe(true);
    } catch (e: any) {
      expect(e.message).toContain("required");
    }
  });
});
