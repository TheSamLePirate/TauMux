import { ContextMenu, Utils } from "electrobun/bun";
import { buildContextMenu } from "../native-menus";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "showContextMenu"
  | "toggleWebServer"
  | "updateSettings"
  | "openExternal"
  | "revealLogFile"
  | "killPid"
  | "webviewFault";

/** Throttle for webview fault reports: a render-loop exception can
 *  fire hundreds of times per second; without a cap each one would be
 *  a log line + a health write. We keep the first few per window and
 *  summarise the rest. */
const WEBVIEW_FAULT_WINDOW_MS = 60_000;
const WEBVIEW_FAULT_MAX_PER_WINDOW = 10;
let webviewFaultCount = 0;
let webviewFaultWindowStart = 0;
let webviewFaultSuppressed = 0;

/** Catch-all "host integration" surface — context menus, settings,
 *  external links, log reveal, killing processes, web-server toggle.
 *  These are all small one-shots that touch host APIs rather than any
 *  one domain object, so they share a file. */
export function registerSystemWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    showContextMenu: (payload) => {
      ContextMenu.showContextMenu(buildContextMenu(payload));
    },
    toggleWebServer: () => {
      ctx.toggleWebServer();
    },
    updateSettings: (payload) => {
      const previous = ctx.settingsManager.get();
      const updated = ctx.settingsManager.update(payload.settings);
      if (updated.shellPath !== previous.shellPath) {
        ctx.sessions.setShell(updated.shellPath);
      }
      if (updated.webMirrorPort !== previous.webMirrorPort) {
        ctx.applyWebMirrorPort(updated.webMirrorPort);
      }
      // W1-1: apply bind / auth-token changes to the live mirror. A bind
      // change needs a re-listen; a token change is applied in place.
      // (A port change above already rebuilt with the latest settings.)
      else if (updated.webMirrorBind !== previous.webMirrorBind) {
        ctx.restartWebMirror();
      }
      if (updated.webMirrorAuthToken !== previous.webMirrorAuthToken) {
        ctx.setWebMirrorAuthToken(updated.webMirrorAuthToken);
      }
      if (updated.ideBridgeEnabled !== previous.ideBridgeEnabled) {
        ctx.setIdeBridgeEnabled(updated.ideBridgeEnabled);
      }
      if (
        updated.telegramEnabled !== previous.telegramEnabled ||
        updated.telegramBotToken !== previous.telegramBotToken ||
        updated.telegramAllowedUserIds !== previous.telegramAllowedUserIds
      ) {
        void ctx.applyTelegramSettings();
      }
      if (
        updated.auditsGitUserNameExpected !== previous.auditsGitUserNameExpected
      ) {
        ctx.rebuildAudits();
        // P7 S4 — re-run the rebuilt registry so health + audit.list
        // reflect the new config without a restart.
        void ctx.runAndPublishAudits();
      }
      ctx.rpc.send("settingsChanged", { settings: updated });
    },
    openExternal: (payload) => {
      // Only pass through http(s) and localhost-ish URLs from the webview;
      // protects against accidentally opening file:// or javascript: URLs
      // from hostile script output reaching the chip render path.
      const url = payload.url;
      if (!/^https?:\/\//i.test(url)) return;
      try {
        Utils.openExternal(url);
      } catch (err) {
        console.error("[openExternal] failed:", err);
      }
    },
    revealLogFile: () => {
      ctx.revealLogFile();
    },
    // The webview holds 100% of the UI and historically had NO failure
    // reporting: a throw in SurfaceManager produced no log line, no
    // health row, nothing — every "sidebar froze" report was
    // unreproducible by construction. The webview forwards window
    // `error` / `unhandledrejection` events here; we log and publish a
    // health row so `ht health` reflects a sick UI layer.
    webviewFault: (payload) => {
      const now = Date.now();
      if (now - webviewFaultWindowStart > WEBVIEW_FAULT_WINDOW_MS) {
        webviewFaultWindowStart = now;
        webviewFaultCount = 0;
        if (webviewFaultSuppressed > 0) {
          console.error(
            `[webview] …plus ${webviewFaultSuppressed} suppressed fault(s) in the last window`,
          );
          webviewFaultSuppressed = 0;
        }
      }
      webviewFaultCount++;
      const where = payload.source ? ` (${payload.source})` : "";
      if (webviewFaultCount > WEBVIEW_FAULT_MAX_PER_WINDOW) {
        webviewFaultSuppressed++;
        return;
      }
      console.error(
        `[webview] ${payload.kind}${where}: ${payload.message}`,
        payload.stack ? `\n${payload.stack}` : "",
      );
      ctx.health.set(
        "webview",
        "error",
        `${payload.kind}${where}: ${payload.message}`.slice(0, 200),
      );
    },
    killPid: (payload) => {
      const pid = Number(payload.pid);
      if (!Number.isFinite(pid) || pid <= 0) return;
      const raw = payload.signal || "SIGTERM";
      const signal = (
        raw.startsWith("SIG") ? raw : `SIG${raw}`
      ) as NodeJS.Signals;
      try {
        process.kill(pid, signal);
      } catch (err) {
        console.error(`[killPid ${pid} ${signal}]`, err);
      }
    },
  };
}
