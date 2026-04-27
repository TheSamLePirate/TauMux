/**
 * Plan #08 — pure dispatcher for the Telegram notification button set.
 *
 * Lives in its own module so the unit tests can drive it without
 * standing up the entire `src/bun/index.ts` runtime (which reads
 * `Resources/version.json` at import time among other side effects).
 *
 * Buttons (4-up grid; see `sendTelegramNotificationWithButtons` in
 * `src/bun/index.ts` for how they're attached to outgoing
 * notifications):
 *
 *   - `ok`              → press Enter (CR / `\r`) on the focused
 *                         prompt, then dismiss the notification
 *   - `no`              → Down arrow → wait 200 ms → Enter, then
 *                         dismiss. Pattern: a Y/N prompt where the
 *                         default cursor sits on "Yes"
 *   - `continue`        → type the literal word "Continue" + Enter
 *   - `cancel` / `stop` → real Ctrl+C (SIGINT) into the surface.
 *                         `stop` is an alias kept for legacy
 *                         `notification_links` rows persisted before
 *                         the rename
 *
 *  Unknown actions are no-ops. Surface-less links can only run `ok`
 *  (which dismisses without keystrokes); any other action exits early
 *  because there's nothing to send keys to.
 *
 *  All keystrokes resolve through the existing `surface.send_text` /
 *  `surface.send_key` socket handlers — same allow-list / audit
 *  pipeline as the CLI. `surface.send_key {key:"ctrl+c"}` requires
 *  the matching entry in `KEY_MAP` (see `src/bun/rpc-handlers/shared.ts`),
 *  which was added alongside this dispatcher.
 */

export interface DispatchTelegramButtonOpts {
  action: string;
  surfaceId: string | null;
  notificationId: string;
  dispatch: (method: string, params: Record<string, unknown>) => void;
  setTimer: (cb: () => void, ms: number) => void;
}

export function dispatchTelegramNotificationButton(
  opts: DispatchTelegramButtonOpts,
): void {
  const { action, surfaceId, notificationId, dispatch, setTimer } = opts;
  switch (action) {
    case "ok":
      if (surfaceId) {
        dispatch("surface.send_key", { surface_id: surfaceId, key: "enter" });
      }
      dispatch("notification.dismiss", { id: notificationId });
      return;
    case "no":
      if (!surfaceId) return;
      dispatch("surface.send_key", { surface_id: surfaceId, key: "down" });
      setTimer(() => {
        try {
          dispatch("surface.send_key", {
            surface_id: surfaceId,
            key: "enter",
          });
        } catch (err) {
          console.warn(
            `[telegram] no-button delayed Enter failed: ${(err as Error).message}`,
          );
        }
      }, 200);
      dispatch("notification.dismiss", { id: notificationId });
      return;
    case "continue":
      if (!surfaceId) return;
      dispatch("surface.send_text", {
        surface_id: surfaceId,
        text: "Continue",
      });
      dispatch("surface.send_key", { surface_id: surfaceId, key: "enter" });
      return;
    case "cancel":
    case "stop":
      if (!surfaceId) return;
      dispatch("surface.send_key", {
        surface_id: surfaceId,
        key: "ctrl+c",
      });
      return;
    default:
      console.warn(`[telegram] callback action unknown: ${action}`);
  }
}
