/**
 * Translates inbound v2 protocol envelopes into store dispatches (+
 * a small set of callbacks for concerns that live outside the store).
 *
 * Before this module existed, `handleServerMessage` was a 135-line
 * switch inside the boot closure of src/web-client/main.ts. The
 * switch mixed reducer-friendly actions (surface/resized, focus/set,
 * notification/add…) with imperative side effects (writing to xterm
 * on history/output, sending subscribeSurface over the transport).
 * Extracting the switch makes the protocol contract explicit and
 * removes ~135 lines from main.ts's already-crowded boot.
 *
 * The web mirror deliberately keeps xterm instances out of the store
 * (they're stateful mutable objects), so the dispatcher needs a
 * `writeOutput` hook. Likewise, `subscribeSurface` is the one
 * transport-outbound action the handler fires.
 */

import type { Store } from "./store";
import type { AutoContinueAuditEntry, Plan } from "../shared/types";
import { playNotificationSound } from "./sounds";

export interface ProtocolDispatcherDeps {
  store: Store;
  /** Write raw terminal data to a surface's xterm instance. When
   *  `reset` is true, clear the terminal first (history replay on
   *  reconnect). Called for `history` + `output` messages. */
  writeOutput: (surfaceId: string, data: string, reset: boolean) => void;
  /** Ask the server to stream output for a surface. Called right
   *  after receiving `surfaceCreated` so the new pane starts filling
   *  in immediately. */
  subscribeSurface: (surfaceId: string) => void;
  /** Plan #09 commit B — drop the latest plan snapshot into the
   *  sidebar plan panel. The mirror is read-only; the bun side is
   *  authoritative. */
  setPlans?: (plans: Plan[]) => void;
  /** Plan #09 commit B — feed the audit ring into the panel so the
   *  mirror sees auto-continue activity. */
  setAutoContinueAudit?: (audit: AutoContinueAuditEntry[]) => void;
}

/** eslint-disable: server payloads are untyped at the boundary. */

type Payload = any;

export function createProtocolDispatcher(
  deps: ProtocolDispatcherDeps,
): (type: string, payload: Payload) => void {
  const {
    store,
    writeOutput,
    subscribeSurface,
    setPlans,
    setAutoContinueAudit,
  } = deps;

  return (type, p) => {
    switch (type) {
      case "hello": {
        store.dispatch({
          kind: "connection/hello",
          sessionId: p.sessionId,
          serverInstanceId: p.serverInstanceId,
          lastSeenSeq: store.getState().connection.lastSeenSeq,
        });
        if (p.snapshot)
          store.dispatch({ kind: "snapshot/apply", snapshot: p.snapshot });
        if (p.sessionId)
          console.info("[web] session", p.sessionId, "v", p.protocolVersion);
        break;
      }
      case "snapshot":
        store.dispatch({ kind: "snapshot/apply", snapshot: p });
        break;
      case "history":
        // Replay after reconnect: reset the terminal, then write.
        writeOutput(p.surfaceId, p.data, true);
        break;
      case "output":
        writeOutput(p.surfaceId, p.data, false);
        break;
      case "resize":
        store.dispatch({
          kind: "surface/resized",
          surfaceId: p.surfaceId,
          cols: p.cols,
          rows: p.rows,
        });
        break;
      case "surfaceCreated":
        store.dispatch({
          kind: "surface/created",
          surfaceId: p.surfaceId,
          title: p.title || p.surfaceId,
        });
        subscribeSurface(p.surfaceId);
        break;
      case "surfaceRenamed":
        store.dispatch({
          kind: "surface/renamed",
          surfaceId: p.surfaceId,
          title: p.title,
        });
        break;
      case "surfaceClosed":
        store.dispatch({ kind: "surface/closed", surfaceId: p.surfaceId });
        break;
      case "surfaceExited":
        // Informational; surfaceClosed does the teardown.
        break;
      case "nativeViewport":
        store.dispatch({
          kind: "native-viewport",
          width: p.width,
          height: p.height,
        });
        break;
      case "layoutChanged":
        store.dispatch({
          kind: "layout/changed",
          workspaces: p.workspaces ?? [],
          activeWorkspaceId: p.activeWorkspaceId ?? null,
          focusedSurfaceId: p.focusedSurfaceId ?? null,
        });
        break;
      case "focusChanged":
        store.dispatch({ kind: "focus/set", surfaceId: p.surfaceId });
        break;
      case "notification":
        store.dispatch({
          kind: "notification/add",
          entry: {
            // Server-supplied stable id; enables matching a later
            // `notificationDismiss` envelope to this entry. Falls back
            // to a locally-minted id for older servers / reconnect
            // snapshots that predate the id field.
            id:
              p.id ||
              `n:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
            title: p.title || "",
            body: p.body || "",
            surfaceId: p.surfaceId,
            at: p.at || Date.now(),
          },
        });
        // Bun only emits "notification" on create (not on dismiss/clear
        // rebroadcasts), so this is the right place to fire the cue.
        playNotificationSound();
        break;
      case "notificationDismiss":
        store.dispatch({ kind: "notification/remove", id: p.id });
        break;
      case "notificationClear":
        store.dispatch({ kind: "notification/clear" });
        break;
      case "surfaceMetadata":
        store.dispatch({
          kind: "surface/metadata",
          surfaceId: p.surfaceId,
          metadata: p.metadata,
        });
        break;
      case "sidebarState":
        store.dispatch({
          kind: "sidebar/visible",
          visible: Boolean(p.visible),
        });
        break;
      case "sidebarAction":
        store.dispatch({
          kind: "sidebar/action",
          action: p.action,
          payload: p.payload || {},
        });
        break;
      case "sidebandMeta":
        store.dispatch({
          kind: "panel/meta",
          surfaceId: p.surfaceId,
          meta: p.meta,
        });
        break;
      case "sidebandDataFailed":
        store.dispatch({ kind: "panel/data-failed", panelId: p.id });
        break;
      case "panelEvent":
        store.dispatch({
          kind: "panel/event",
          panelId: p.id,
          event: p.event,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
        });
        break;
      case "telegramSurfaceCreated":
        store.dispatch({
          kind: "surface/created",
          surfaceId: p.surfaceId,
          title: "Telegram",
        });
        // No subscribeSurface — telegram panes don't stream stdout.
        break;
      case "telegramState":
        store.dispatch({
          kind: "telegram/state",
          status: p.status ?? { state: "disabled" },
          chats: Array.isArray(p.chats) ? p.chats : [],
        });
        break;
      case "telegramHistory":
        store.dispatch({
          kind: "telegram/history",
          chatId: p.chatId,
          messages: Array.isArray(p.messages) ? p.messages : [],
        });
        break;
      case "telegramMessage":
        if (p.message) {
          store.dispatch({ kind: "telegram/message", message: p.message });
          // Inbound message → chime + pulse glow on every telegram
          // surface that isn't currently focused. Outbound echoes don't
          // chime (that's just our own send landing back).
          if (p.message.direction === "in") {
            playNotificationSound();
            store.dispatch({ kind: "telegram/glow-incoming" });
          }
        }
        break;
      // Plan #09 commit B — agent plans + auto-continue audit ring
      // mirror over to the read-only sidebar widget. The mirror does
      // not store these in AppState; the panel renders directly from
      // the latest snapshot.
      case "plansSnapshot":
        if (Array.isArray(p.plans)) setPlans?.(p.plans as Plan[]);
        break;
      case "autoContinueAudit":
        if (Array.isArray(p.audit))
          setAutoContinueAudit?.(p.audit as AutoContinueAuditEntry[]);
        break;
      // Plan #10 commit C — bun broadcasts ask-user shown / resolved
      // for the webview modal. The web mirror has no modal UI yet
      // (Plan #13 covers web parity); we silently absorb both frames
      // so they don't trip the unknown-message log on every question
      // that crosses the wire.
      case "askUserShown":
      case "askUserResolved":
        break;
      default: {
        // Issue N2 in doc/full_analysis.md — the dispatcher used to
        // silently drop unknown message types, which made it hard to
        // diagnose protocol drift after a server upgrade. Warn once
        // per type so a noisy stream doesn't flood the console.
        if (!warnedUnknownTypes.has(type)) {
          warnedUnknownTypes.add(type);
          console.warn(`[mirror] unknown server message type: ${type}`);
        }
        break;
      }
    }
  };
}

const warnedUnknownTypes = new Set<string>();
