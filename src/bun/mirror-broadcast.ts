import type { AppContext } from "./app-context";

/**
 * Web-mirror broadcast for native-only pane creation.
 *
 * Editor / extension / agent / claude panes are native webview
 * surfaces — the mirror can't host them. But it must know they EXIST:
 * before this envelope, creating one left a hole in the mirrored
 * layout (an xterm bound to no PTY), because the creation paths only
 * `rpc.send`'d to the native webview and never broadcast. The mirror
 * renders a labelled placeholder from this message.
 *
 * One helper so every creation site stays a one-liner — the "dual
 * broadcast inlined at N sites" pattern is how five creation paths
 * drifted out of the mirror in the first place.
 */
export function broadcastNonPtySurfaceCreated(
  app: AppContext,
  surfaceId: string,
  surfaceType: string,
  title?: string,
): void {
  app.webServer?.broadcast({
    type: "nonPtySurfaceCreated",
    surfaceId,
    surfaceType,
    ...(title ? { title } : {}),
  });
}
