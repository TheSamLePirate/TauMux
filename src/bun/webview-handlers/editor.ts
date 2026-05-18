import { readEditorFile, saveEditorFile } from "../editor-files";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "createEditorSurface"
  | "splitEditorSurface"
  | "editorReadFile"
  | "editorSaveFile"
  | "editorReloadFile";

/** CodeMirror editor pane lifecycle plus file IO. All disk access goes
 *  through `editor-files.ts` which enforces the read / write
 *  boundary (size limits, refusal on binary content, etc). */
export function registerEditorWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    createEditorSurface: (payload) => {
      ctx.createEditorWorkspaceSurface(
        payload.path,
        payload.cwd,
        payload.create,
      );
    },
    splitEditorSurface: (payload) => {
      ctx.splitEditorSurface(
        payload.direction,
        payload.path,
        payload.cwd,
        payload.create,
      );
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
  };
}
