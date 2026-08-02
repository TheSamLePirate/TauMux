/**
 * Regression test for the pane-close bug (user report, 0.8.1): bun's
 * polymorphic `closeSurface` had branches for pi/browser/ext/tg/editor
 * but let `claude-agent:` ids fall through to the PTY close, which
 * no-ops on unknown ids — so no `surfaceClosed` echo, and the X button
 * did nothing. Locks the routing for every non-PTY prefix.
 */
import { describe, test, expect } from "bun:test";
import { registerSurfaceWebviewHandlers } from "../src/bun/webview-handlers/surface";
import type { WebviewHandlerContext } from "../src/bun/webview-handlers/types";

function setup() {
  const sends: Array<[string, unknown]> = [];
  const claudeClosed: string[] = [];
  const ptyClosed: string[] = [];
  const extStopped: string[] = [];
  const ctx = {
    piAgentManager: { isAgentSurface: () => false },
    browserSurfaces: { isBrowserSurface: () => false },
    extensionManager: {
      stop: (id: string) => {
        extStopped.push(id);
      },
    },
    claudeAgentManager: {
      close: async (id: string) => {
        claudeClosed.push(id);
        return true;
      },
    },
    sessions: {
      closeSurface: (id: string) => {
        ptyClosed.push(id);
      },
    },
    rpc: {
      send: (m: string, p: unknown) => {
        sends.push([m, p]);
      },
    },
    app: { webServer: undefined },
    dispatch: () => {},
  } as unknown as WebviewHandlerContext;
  const handlers = registerSurfaceWebviewHandlers(ctx);
  return { handlers, sends, claudeClosed, ptyClosed, extStopped };
}

describe("closeSurface routing", () => {
  test("claude-agent: closes the SDK agent and echoes surfaceClosed", () => {
    const { handlers, sends, claudeClosed, ptyClosed } = setup();
    handlers.closeSurface({ surfaceId: "claude-agent:3" });
    expect(claudeClosed).toEqual(["claude-agent:3"]);
    expect(sends).toContainEqual([
      "surfaceClosed",
      { surfaceId: "claude-agent:3" },
    ]);
    expect(ptyClosed).toEqual([]); // must NOT fall through to the PTY path
  });

  test("tg:/editor: echo without touching the PTY; plain ids go to PTY", () => {
    const { handlers, sends, ptyClosed, claudeClosed } = setup();
    handlers.closeSurface({ surfaceId: "tg:1" });
    expect(sends).toContainEqual(["surfaceClosed", { surfaceId: "tg:1" }]);
    handlers.closeSurface({ surfaceId: "surface:5" });
    expect(ptyClosed).toEqual(["surface:5"]);
    expect(claudeClosed).toEqual([]);
  });
});
