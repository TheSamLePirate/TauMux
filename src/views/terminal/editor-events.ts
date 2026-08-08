/**
 * Editor / file-pane DOM events → bun RPC.
 *
 * Same shape as `registerBrowserEvents` / `registerAgentEvents`: the
 * pane emits a typed `htEvents` channel, this module is the one place
 * that turns it into an RPC call. Split out of `index.ts`, which is a
 * baselined god module (scripts/audit-module-size.ts).
 *
 * The `cwd` / `line` / `column` fields threaded through here are what
 * make a clicked `path:line` reference in terminal output land on the
 * right file at the right line — see terminal-links.ts.
 */

import { fileUrlForPath } from "../../shared/file-kind";

// Same loose shape browser-events.ts / agent-events.ts use: the fully
// generic rpc-anywhere type buys nothing here and costs a lot of noise.

interface Rpc {
  send: (name: any, payload: any) => void;
}

function detailOf<T>(e: Event): T | undefined {
  return (e as CustomEvent).detail as T | undefined;
}

export function registerEditorEvents(rpc: Rpc): void {
  window.addEventListener("ht-editor-read-file", (e) => {
    const d = detailOf<{
      surfaceId?: string;
      path?: string;
      create?: boolean;
      cwd?: string;
      line?: number | null;
      column?: number | null;
    }>(e);
    if (!d?.surfaceId || !d.path) return;
    rpc.send("editorReadFile", {
      surfaceId: d.surfaceId,
      path: d.path,
      create: d.create,
      cwd: d.cwd,
      line: d.line,
      column: d.column,
    });
  });

  window.addEventListener("ht-editor-save-file", (e) => {
    const d = detailOf<{
      surfaceId?: string;
      path?: string;
      content?: string;
      expectedMtimeMs?: number | null;
    }>(e);
    if (!d?.surfaceId || !d.path || typeof d.content !== "string") return;
    rpc.send("editorSaveFile", {
      surfaceId: d.surfaceId,
      path: d.path,
      content: d.content,
      expectedMtimeMs: d.expectedMtimeMs ?? null,
    });
  });

  window.addEventListener("ht-editor-reload-file", (e) => {
    const d = detailOf<{ surfaceId?: string; path?: string }>(e);
    if (!d?.surfaceId || !d.path) return;
    rpc.send("editorReloadFile", { surfaceId: d.surfaceId, path: d.path });
  });

  window.addEventListener("ht-split-editor", (e) => {
    const d = detailOf<{
      path?: string;
      direction?: "horizontal" | "vertical";
    }>(e);
    rpc.send("splitEditorSurface", {
      direction: d?.direction ?? "horizontal",
      path: d?.path,
    });
  });

  window.addEventListener("ht-open-file-in-browser", (e) => {
    const d = detailOf<{ path?: string }>(e);
    if (!d?.path) return;
    // Local HTML runs in the browser pane's own BrowserView, not in the
    // webview that holds the Electrobun RPC bridge. That is the point:
    // an untrusted document belongs in the isolated surface, which is
    // why this routes to a pane rather than rendering inline.
    rpc.send("splitBrowserSurface", {
      direction: "horizontal",
      url: fileUrlForPath(d.path),
    });
  });

  window.addEventListener("ht-open-file-in-editor", (e) => {
    const d = detailOf<{
      path?: string;
      cwd?: string;
      create?: boolean;
      line?: number | null;
      column?: number | null;
    }>(e);
    if (!d?.path) return;
    // `cwd` is load-bearing: without it a relative `src/index.ts`
    // resolves against the app's own launch directory instead of the
    // shell that printed it — which silently opens the wrong file.
    rpc.send("splitEditorSurface", {
      direction: "horizontal",
      path: d.path,
      cwd: d.cwd,
      create: d.create,
      line: d.line,
      column: d.column,
    });
  });
}
