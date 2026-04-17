import type { Handler, HandlerDeps } from "./types";

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
      const dir = params["direction"] as string;
      const direction =
        dir === "down" || dir === "vertical" ? "vertical" : "horizontal";
      dispatch("splitBrowserSurface", {
        direction,
        url: params["url"] ?? undefined,
      });
      return "OK";
    },

    "browser.navigate": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const url = params["url"] as string;
      if (id && url) {
        dispatch("browser.navigateTo", { surfaceId: id, url });
      }
      return "OK";
    },

    "browser.back": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.goBack", { surfaceId: id });
      return "OK";
    },

    "browser.forward": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.goForward", { surfaceId: id });
      return "OK";
    },

    "browser.reload": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("browser.reload", { surfaceId: id });
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
