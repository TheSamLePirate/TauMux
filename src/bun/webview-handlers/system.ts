import { ContextMenu, Utils } from "electrobun/bun";
import { buildContextMenu } from "../native-menus";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "showContextMenu"
  | "toggleWebServer"
  | "updateSettings"
  | "openExternal"
  | "revealLogFile"
  | "killPid";

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
