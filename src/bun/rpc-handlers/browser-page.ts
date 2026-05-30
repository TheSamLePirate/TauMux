import type { Handler, HandlerDeps } from "./types";

/** P7 S4 — navigation-rule validation. The browser-page handlers used to
 *  silently swallow missing / mis-shaped params (no `surface_id`,
 *  unknown `direction`, malformed `url`) and either return `"OK"` or
 *  coerce the input — that means a typo in a script silently does the
 *  wrong thing. These helpers surface the typo as an error so the CLI /
 *  agent caller knows the call didn't land. */

/** Valid open-split directions. Anything else is a typo, not "default
 *  to horizontal". Mirrors the plan-panel `isPlanState` pattern from
 *  P7 session 1. */
const SPLIT_DIRECTION_VALUES = ["horizontal", "vertical", "down"] as const;
type SplitDirection = (typeof SPLIT_DIRECTION_VALUES)[number];

export function isSplitDirection(v: unknown): v is SplitDirection {
  return (
    typeof v === "string" &&
    (SPLIT_DIRECTION_VALUES as readonly string[]).includes(v)
  );
}

/** Validate `url` looks like a navigable URL — `http(s)://…` or an
 *  `about:…` / `data:…` / `chrome-extension://…` scheme. We don't try to
 *  be a full URL parser; the goal is to reject obvious typos (`"htps://"`,
 *  `""`, an integer that fell through the param schema) without rejecting
 *  otherwise-fine inputs the webview will happily render.
 *
 *  W1-4 (full_app_review_2026-05.md §13.4): `file://` is deliberately NOT
 *  allowed over the RPC navigate path. A same-user socket client could
 *  otherwise point a pane at `file:///etc/passwd` (or any path) and read
 *  it back via `browser.get html` / eval — local file disclosure. (http to
 *  localhost / internal hosts stays allowed: browsing a local dev server
 *  is the browser pane's primary purpose.) If a local-HTML workflow is
 *  ever needed, add an explicit opt-in setting scoped to a directory. */
const ALLOWED_URL_PREFIXES = [
  "http://",
  "https://",
  "about:",
  "data:",
  "chrome-extension://",
];

export function isNavigableUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0) return false;
  for (const p of ALLOWED_URL_PREFIXES) {
    if (v.startsWith(p)) return true;
  }
  return false;
}

/** Extract + validate a non-empty surface_id from a params bag. Throws
 *  on missing / blank input so a typo in a script surfaces instead of
 *  silently dispatching to nothing. */
function requireSurfaceId(params: Record<string, unknown>): string {
  const id =
    (params["surface_id"] as string | undefined) ??
    (params["surface"] as string | undefined);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("surface_id required");
  }
  return id;
}

/** browser.* handlers that touch the page / surface lifecycle:
 *  open, navigate, reload, eval, find, history, devtools, snapshot,
 *  scripts/styles, console & errors, identify, close. */
export function registerBrowserPage(
  deps: HandlerDeps,
): Record<string, Handler> {
  const { getState, dispatch, browserSurfaces, browserHistory } = deps;

  return {
    "browser.list": () => {
      return (browserSurfaces?.getAllSurfaces() ?? []).map((s) => ({
        id: s.id,
        url: s.url,
        title: s.title,
        zoom: s.zoom,
      }));
    },

    "browser.open": (params) => {
      dispatch("createBrowserSurface", { url: params["url"] ?? undefined });
      return "OK";
    },

    "browser.open_split": (params) => {
      // P7 S4 — reject unknown directions instead of silently
      // defaulting to horizontal. `down` is preserved as an alias for
      // `vertical` so existing scripts keep working.
      const rawDir = params["direction"];
      if (rawDir !== undefined && !isSplitDirection(rawDir)) {
        throw new Error(
          `browser.open_split: direction must be one of ${SPLIT_DIRECTION_VALUES.join(
            " | ",
          )} (got "${String(rawDir)}")`,
        );
      }
      const direction =
        rawDir === "down" || rawDir === "vertical" ? "vertical" : "horizontal";
      dispatch("splitBrowserSurface", {
        direction,
        url: params["url"] ?? undefined,
      });
      return "OK";
    },

    "browser.navigate": (params) => {
      // P7 S4 — both inputs are required. Previously a missing url
      // returned "OK" with no navigation; that swallowed the bug.
      const id = requireSurfaceId(params);
      const url = params["url"];
      if (!isNavigableUrl(url)) {
        throw new Error(
          `browser.navigate: url must start with one of ${ALLOWED_URL_PREFIXES.join(
            " | ",
          )} (got "${String(url)}")`,
        );
      }
      dispatch("browser.navigateTo", { surfaceId: id, url });
      return "OK";
    },

    "browser.back": (params) => {
      const id = requireSurfaceId(params);
      dispatch("browser.goBack", { surfaceId: id });
      return "OK";
    },

    "browser.forward": (params) => {
      const id = requireSurfaceId(params);
      dispatch("browser.goForward", { surfaceId: id });
      return "OK";
    },

    "browser.reload": (params) => {
      const id = requireSurfaceId(params);
      dispatch("browser.reload", { surfaceId: id });
      return "OK";
    },

    "browser.url": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) return null;
      return browserSurfaces?.getSurface(id)?.url ?? null;
    },

    "browser.eval": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const script = params["script"] as string;
      if (id && script) {
        dispatch("browser.evalJs", { surfaceId: id, script });
      }
      return "OK";
    },

    "browser.find": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const query = params["query"] as string;
      if (id && query) {
        dispatch("browser.findInPage", { surfaceId: id, query });
      }
      return "OK";
    },

    "browser.stop_find": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.stopFind", { surfaceId: id });
      return "OK";
    },

    "browser.devtools": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.toggleDevTools", { surfaceId: id });
      return "OK";
    },

    "browser.history": () => {
      return browserHistory?.getAll(100) ?? [];
    },

    "browser.clear_history": () => {
      browserHistory?.clear();
      return "OK";
    },

    "browser.snapshot": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      // Inject a DOM snapshot script that sends results via host-message → evalResult
      const snapshotScript = `
        (function() {
          var counter = 0;
          function snap(node, depth, max) {
            if (depth > max || !node) return null;
            var tag = node.tagName ? node.tagName.toLowerCase() : null;
            var role = (node.getAttribute && node.getAttribute("role")) || tag;
            var name = (node.getAttribute && (
              node.getAttribute("aria-label") ||
              node.getAttribute("alt") ||
              node.getAttribute("title") ||
              node.getAttribute("placeholder")
            )) || "";
            var text = node.nodeType === 3 ? (node.textContent || "").trim() : "";
            var interactive = ["a","button","input","select","textarea"].indexOf(tag) >= 0;
            var children = [];
            var cn = node.childNodes || [];
            for (var i = 0; i < cn.length; i++) {
              var c = snap(cn[i], depth + 1, max);
              if (c) children.push(c);
            }
            if (!role && !text && children.length === 0) return null;
            var entry = { role: role };
            if (name) entry.name = name;
            if (text) entry.text = text;
            if (interactive) entry.ref = "e" + (++counter);
            if (children.length) entry.children = children;
            return entry;
          }
          return JSON.stringify(snap(document.body, 0, 8));
        })()
      `;
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: snapshotScript,
        reqId: `snapshot:${Date.now()}`,
      });
      return "OK (snapshot dispatched — result returns asynchronously)";
    },

    "browser.close": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) browserSurfaces?.closeSurface(id);
      return "OK";
    },

    "browser.addscript": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const script = params["script"] as string;
      if (!id || !script) throw new Error("surface_id and script required");
      dispatch("browser.evalJs", { surfaceId: id, script });
      return "OK";
    },

    "browser.addstyle": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const css = params["css"] as string;
      if (!id || !css) throw new Error("surface_id and css required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`,
      });
      return "OK";
    },

    "browser.console_list": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      return browserSurfaces?.getConsoleLogs(id) ?? [];
    },

    "browser.console_clear": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      browserSurfaces?.clearConsoleLogs(id);
      return "OK";
    },

    "browser.errors_list": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      return browserSurfaces?.getErrors(id) ?? [];
    },

    "browser.errors_clear": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      browserSurfaces?.clearErrors(id);
      return "OK";
    },

    "browser.identify": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) {
        const s = browserSurfaces?.getSurface(id);
        if (!s) throw new Error(`Unknown browser surface: ${id}`);
        return {
          id: s.id,
          url: s.url,
          title: s.title,
          zoom: s.zoom,
          partition: s.partition,
        };
      }
      // Return focused if it's a browser
      const state = getState();
      const fid = state.focusedSurfaceId;
      if (fid && browserSurfaces?.isBrowserSurface(fid)) {
        const s = browserSurfaces.getSurface(fid)!;
        return {
          id: s.id,
          url: s.url,
          title: s.title,
          zoom: s.zoom,
          partition: s.partition,
        };
      }
      return null;
    },
  };
}
