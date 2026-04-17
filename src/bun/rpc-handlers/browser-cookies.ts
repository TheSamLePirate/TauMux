import type { Handler, HandlerDeps } from "./types";
import {
  exportAsJson,
  exportAsNetscape,
  parseJsonCookies,
  parseNetscapeCookies,
} from "../cookie-parsers";

export function registerBrowserCookies(
  deps: HandlerDeps,
): Record<string, Handler> {
  const { dispatch, cookieStore, pendingBrowserEvals } = deps;

  return {
    "browser.cookie_list": (params) => {
      const domain = params["domain"] as string | undefined;
      if (domain) return cookieStore?.search(domain) ?? [];
      return cookieStore?.getAll(500) ?? [];
    },

    "browser.cookie_get": (params) => {
      const url = params["url"] as string;
      if (!url) throw new Error("url required");
      return cookieStore?.getForUrl(url) ?? [];
    },

    "browser.cookie_set": (params) => {
      const name = params["name"] as string;
      const value = params["value"] as string;
      const domain = params["domain"] as string;
      if (!name || !domain) throw new Error("name and domain required");
      cookieStore?.set({
        name,
        value: value ?? "",
        domain,
        path: (params["path"] as string) || "/",
        expires: Number(params["expires"] ?? 0),
        secure: !!params["secure"],
        httpOnly: !!params["httpOnly"],
        sameSite:
          (params["sameSite"] as string as "Strict" | "Lax" | "None" | "") ||
          "",
        source: "imported",
        updatedAt: Date.now(),
      });
      return "OK";
    },

    "browser.cookie_delete": (params) => {
      const domain = params["domain"] as string;
      const name = params["name"] as string;
      const path = (params["path"] as string) || "/";
      if (!domain || !name) throw new Error("domain and name required");
      return cookieStore?.delete(domain, path, name) ? "OK" : "NOT_FOUND";
    },

    "browser.cookie_clear": (params) => {
      const domain = params["domain"] as string | undefined;
      if (domain) {
        const count = cookieStore?.deleteForDomain(domain) ?? 0;
        return { deleted: count };
      }
      cookieStore?.clear();
      return "OK";
    },

    "browser.cookie_import": (params) => {
      const data = params["data"] as string;
      const format = (params["format"] as string) || "json";
      if (!data) throw new Error("data required");
      const cookies =
        format === "netscape"
          ? parseNetscapeCookies(data)
          : parseJsonCookies(data);
      const count = cookieStore?.importBulk(cookies) ?? 0;
      return { imported: count };
    },

    "browser.cookie_export": (params) => {
      const format = (params["format"] as string) || "json";
      const cookies = cookieStore?.exportAll() ?? [];
      if (format === "netscape") return exportAsNetscape(cookies);
      return exportAsJson(cookies);
    },

    "browser.cookie_capture": async (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      const reqId = `cookie:${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return new Promise<string>((resolve) => {
        pendingBrowserEvals?.set(reqId, (raw) => {
          try {
            const data = JSON.parse(raw);
            const url = data.url as string;
            const hostname = new URL(url).hostname;
            for (const c of data.cookies as Array<{
              name: string;
              value: string;
            }>) {
              cookieStore?.set({
                name: c.name,
                value: c.value,
                domain: hostname,
                path: "/",
                expires: 0,
                secure: url.startsWith("https"),
                httpOnly: false,
                sameSite: "",
                source: "captured",
                updatedAt: Date.now(),
              });
            }
            resolve(
              JSON.stringify({
                captured: (data.cookies as unknown[]).length,
                domain: hostname,
              }),
            );
          } catch (e) {
            resolve(`Error: ${e}`);
          }
        });
        dispatch("browser.getCookies", { surfaceId: id, reqId });
        setTimeout(() => {
          if (pendingBrowserEvals?.has(reqId)) {
            pendingBrowserEvals.delete(reqId);
            resolve("timeout");
          }
        }, 5000);
      });
    },
  };
}
