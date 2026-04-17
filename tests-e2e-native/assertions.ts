import { expect } from "@playwright/test";
import type { SocketRpc } from "./client";

const DEFAULT_TIMEOUT = 3_000;
const DEFAULT_INTERVAL = 150;

/** Polling semantic matchers over the RPC surface. Wraps Playwright's
 *  `expect.poll` so failures show the actual last value and the right
 *  stack, not a stringified lambda. */
export function expectSurface(rpc: SocketRpc, surfaceId: string) {
  return {
    async toHaveTitle(
      title: string,
      timeoutMs = DEFAULT_TIMEOUT,
    ): Promise<void> {
      await expect
        .poll(
          async () => {
            const s = (await rpc.surface.list()).find(
              (x) => x.id === surfaceId,
            );
            return s?.title ?? null;
          },
          { timeout: timeoutMs, intervals: [DEFAULT_INTERVAL] },
        )
        .toBe(title);
    },
    async toHaveCwd(cwd: string, timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
      await expect
        .poll(
          async () =>
            (await rpc.surface.metadata({ surface_id: surfaceId }))?.cwd ??
            null,
          { timeout: timeoutMs, intervals: [DEFAULT_INTERVAL] },
        )
        .toBe(cwd);
    },
    async toHaveForegroundCommand(
      re: RegExp,
      timeoutMs = DEFAULT_TIMEOUT,
    ): Promise<void> {
      await expect
        .poll(
          async () => {
            const meta = await rpc.surface.metadata({ surface_id: surfaceId });
            if (!meta) return "";
            const fg = meta.tree.find((n) => n.pid === meta.foregroundPid);
            return fg?.command ?? "";
          },
          { timeout: timeoutMs, intervals: [DEFAULT_INTERVAL] },
        )
        .toMatch(re);
    },
    async toHaveListeningPort(port: number, timeoutMs = 5_000): Promise<void> {
      await expect
        .poll(
          async () => {
            const meta = await rpc.surface.metadata({ surface_id: surfaceId });
            return meta?.listeningPorts.some((p) => p.port === port) ?? false;
          },
          { timeout: timeoutMs, intervals: [DEFAULT_INTERVAL] },
        )
        .toBe(true);
    },
    async toShowOnScreen(
      expectText: string | RegExp,
      timeoutMs = 5_000,
    ): Promise<void> {
      await expect
        .poll(async () => rpc.surface.read_text({ surface_id: surfaceId }), {
          timeout: timeoutMs,
          intervals: [DEFAULT_INTERVAL],
        })
        .toMatch(
          typeof expectText === "string"
            ? new RegExp(escapeRe(expectText))
            : expectText,
        );
    },
  };
}

export function expectApp(rpc: SocketRpc) {
  return {
    async toHaveWorkspaceCount(
      n: number,
      timeoutMs = DEFAULT_TIMEOUT,
    ): Promise<void> {
      await expect
        .poll(async () => (await rpc.workspace.list()).length, {
          timeout: timeoutMs,
          intervals: [DEFAULT_INTERVAL],
        })
        .toBe(n);
    },
    async toHaveSurfaceCount(
      n: number,
      timeoutMs = DEFAULT_TIMEOUT,
    ): Promise<void> {
      await expect
        .poll(async () => (await rpc.surface.list()).length, {
          timeout: timeoutMs,
          intervals: [DEFAULT_INTERVAL],
        })
        .toBe(n);
    },
    async toHaveNotificationCount(
      n: number,
      timeoutMs = DEFAULT_TIMEOUT,
    ): Promise<void> {
      await expect
        .poll(async () => (await rpc.notification.list()).length, {
          timeout: timeoutMs,
          intervals: [DEFAULT_INTERVAL],
        })
        .toBe(n);
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
