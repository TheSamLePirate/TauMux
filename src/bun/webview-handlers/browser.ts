import {
  exportAsJson,
  exportAsNetscape,
  parseJsonCookies,
  parseNetscapeCookies,
} from "../cookie-parsers";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "createBrowserSurface"
  | "splitBrowserSurface"
  | "browserNavigated"
  | "browserTitleChanged"
  | "browserSetZoom"
  | "browserConsoleLog"
  | "browserError"
  | "browserEvalResult"
  | "browserDomReady"
  | "browserCookieAction";

/** Browser surface lifecycle + navigation / dev-tool plumbing. Also
 *  owns the cookie-injection debounce path that fires on `domReady`
 *  and the cookie import/export action used by the browser settings
 *  panel. */
export function registerBrowserWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    createBrowserSurface: (payload) => {
      ctx.createBrowserWorkspaceSurface(payload.url);
    },
    splitBrowserSurface: (payload) => {
      ctx.splitBrowserSurface(payload.direction, payload.url);
    },
    browserNavigated: async (payload) => {
      ctx.browserSurfaces.updateNavigation(
        payload.surfaceId,
        payload.url,
        payload.title,
      );
      await ctx.browserHistory.ready;
      ctx.browserHistory.record(payload.url, payload.title);
      ctx.app.webServer?.broadcast({
        type: "browserNavigated",
        surfaceId: payload.surfaceId,
        url: payload.url,
        title: payload.title,
      });
    },
    browserTitleChanged: (payload) => {
      ctx.browserSurfaces.setTitle(payload.surfaceId, payload.title);
    },
    browserSetZoom: (payload) => {
      ctx.browserSurfaces.setZoom(payload.surfaceId, payload.zoom);
    },
    browserConsoleLog: (payload) => {
      ctx.browserSurfaces.addConsoleLog(payload.surfaceId, {
        level: payload.level,
        args: payload.args,
        timestamp: payload.timestamp,
      });
    },
    browserError: (payload) => {
      ctx.browserSurfaces.addError(payload.surfaceId, {
        message: payload.message,
        filename: payload.filename,
        lineno: payload.lineno,
        timestamp: payload.timestamp,
      });
    },
    browserEvalResult: (payload) => {
      const resolve = ctx.pendingBrowserEvals.get(payload.reqId);
      if (resolve) {
        ctx.pendingBrowserEvals.delete(payload.reqId);
        resolve(
          payload.error ? `Error: ${payload.error}` : (payload.result ?? ""),
        );
      }
    },
    browserDomReady: (payload) => {
      const { surfaceId, url } = payload;
      // Debounce: coalesce rapid navigations (redirects, SPA routing)
      const existing = ctx.domReadyDebounce.get(surfaceId);
      if (existing) clearTimeout(existing);
      ctx.domReadyDebounce.set(
        surfaceId,
        setTimeout(async () => {
          ctx.domReadyDebounce.delete(surfaceId);
          await ctx.cookieStore.ready;
          const cookies = ctx.cookieStore.getForUrl(url);
          if (cookies.length > 0) {
            ctx.rpc.send("browserInjectCookies", {
              surfaceId,
              cookies: cookies.map((c) => ({
                name: c.name,
                value: c.value,
                path: c.path,
                expires: c.expires,
                secure: c.secure,
                sameSite: c.sameSite,
              })),
            });
          }
        }, 50),
      );
    },
    browserCookieAction: (payload) => {
      const { action, data, format } = payload;
      if (action === "import" && data) {
        const cookies =
          format === "netscape"
            ? parseNetscapeCookies(data)
            : parseJsonCookies(data);
        const count = ctx.cookieStore.importBulk(cookies);
        ctx.rpc.send("cookieActionResult", {
          action: "import",
          message: `Imported ${count} cookies`,
        });
      } else if (action === "export") {
        const all = ctx.cookieStore.exportAll();
        const out =
          format === "netscape" ? exportAsNetscape(all) : exportAsJson(all);
        ctx.rpc.send("cookieExportResult", {
          data: out,
          format: format || "json",
        });
      } else if (action === "clear") {
        ctx.cookieStore.clear();
        ctx.rpc.send("cookieActionResult", {
          action: "clear",
          message: "All cookies cleared",
        });
      }
    },
  };
}
