import { readEditorFile, saveEditorFile } from "../editor-files";
import { probeFilePaths } from "../file-probe";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "createEditorSurface"
  | "splitEditorSurface"
  | "editorReadFile"
  | "editorSaveFile"
  | "editorReloadFile"
  | "probeFilePaths";

/** CodeMirror editor pane lifecycle plus file IO. All disk access goes
 *  through `editor-files.ts` which enforces the read / write
 *  boundary (size limits, refusal on binary content, etc). */
export function registerEditorWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    createEditorSurface: (payload) => {
      ctx.openEditorSurface(payload);
    },
    splitEditorSurface: (payload) => {
      ctx.openEditorSurface({ ...payload, split: payload.direction });
    },
    editorReadFile: (payload) => {
      ctx.rpc.send("editorFileSnapshot", readEditorFile(payload));
    },
    editorSaveFile: (payload) => {
      ctx.rpc.send("editorSaveResult", saveEditorFile(payload));
    },
    editorReloadFile: (payload) => {
      ctx.rpc.send("editorFileSnapshot", readEditorFile(payload));
    },
    probeFilePaths: (payload) => {
      // Never throws — a probe failure must degrade to "no link", not
      // to an unhandled rejection in the RPC bridge.
      let entries: ReturnType<typeof probeFilePaths> = [];
      try {
        entries = probeFilePaths({
          paths: payload.paths,
          cwd: payload.cwd,
          thumbnails: payload.thumbnails,
        });
      } catch (err) {
        console.error("[file-probe] failed:", err);
      }
      ctx.rpc.send("filePathsProbed", {
        requestId: payload.requestId,
        entries,
      });
    },
  };
}
