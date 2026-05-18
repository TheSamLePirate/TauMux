import { Utils } from "electrobun/bun";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys = "clipboardWrite" | "clipboardPaste" | "writeStdin";

/** Clipboard + stdin write — keystroke ingress + paste fallback. */
export function registerClipboardWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    clipboardWrite: (payload) => {
      try {
        Utils.clipboardWriteText(payload.text);
      } catch {
        // Fallback to pbcopy when the FFI path isn't available
        // (rare — but keep it for resilience). G.10 / L13: race against
        // a 2 s timeout so a hung pbcopy doesn't leak the subprocess.
        const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
        proc.stdin.write(payload.text);
        proc.stdin.end();
        const timer = setTimeout(() => {
          try {
            proc.kill();
          } catch {
            /* already done */
          }
        }, 2000);
        proc.exited
          .then(() => clearTimeout(timer))
          .catch(() => {
            clearTimeout(timer);
          });
      }
    },
    clipboardPaste: (payload) => {
      ctx.app.focusedSurfaceId = payload.surfaceId;
      void ctx.handlePaste();
    },
    writeStdin: (payload) => {
      ctx.autoContinue.notifyHumanInput(payload.surfaceId);
      ctx.sessions.writeStdin(payload.surfaceId, payload.data);
    },
  };
}
