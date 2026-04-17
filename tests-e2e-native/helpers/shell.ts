import type { SocketRpc } from "../client";
import { waitFor } from "./wait";

/** Send a command to the surface's PTY (appending Enter) and wait for the
 *  screen text to contain the expected marker. Returns the screen contents. */
export async function runCommand(
  rpc: SocketRpc,
  surfaceId: string,
  command: string,
  expectMarker: string | RegExp,
  timeoutMs = 5_000,
): Promise<string> {
  await rpc.surface.send_text({ surface_id: surfaceId, text: command + "\r" });
  return waitForScreen(rpc, surfaceId, expectMarker, timeoutMs);
}

/** Poll `surface.read_text` until the expected text appears on screen. */
export async function waitForScreen(
  rpc: SocketRpc,
  surfaceId: string,
  expect: string | RegExp,
  timeoutMs = 5_000,
): Promise<string> {
  return waitFor<string>(
    async () => {
      const text = await rpc.surface.read_text({ surface_id: surfaceId });
      const hit =
        typeof expect === "string" ? text.includes(expect) : expect.test(text);
      return hit ? text : undefined;
    },
    { timeoutMs, intervalMs: 100, message: `waitForScreen ${String(expect)}` },
  );
}
