/**
 * Actions on the sidebar file explorer's header.
 *
 * Currently one: create a file in the directory being listed. It used
 * to call the DOM `prompt()` and `alert()`, which is why the "+" button
 * did nothing at all — inside the Electrobun webview `prompt()` returns
 * null and `alert()` draws nothing, so the handler bailed on the first
 * line and the user got no signal whatsoever.
 *
 * Lives outside `sidebar.ts` because that module is baselined
 * (scripts/audit-module-size.ts) and the ratchet's advice when a change
 * needs room is to put the code in a new module.
 */

import { htEvents } from "../../shared/event-bus";
import { createIcon } from "./icons";
import { showPromptDialog } from "./prompt-dialog";

/** Names that cannot be created here. Returns the reason, or null when
 *  the name is fine — the shape `showPromptDialog`'s `validate` wants,
 *  and pure so the rules can be tested without a DOM. */
export function validateNewFileName(name: string): string | null {
  if (name.includes("/")) return "Use a name without slashes.";
  if (name === "." || name === "..") return "That is a directory, not a file.";
  // A leading dash makes the path look like a flag to anything that
  // later shells out with it.
  if (name.startsWith("-")) return "A name cannot start with a dash.";
  return null;
}

/** The "+" button for a file-explorer root. `dir` is the directory the
 *  new file is created in; `workspaceId` scopes the resulting editor. */
export function buildNewFileButton(
  dir: string,
  workspaceId: string,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "workspace-file-new";
  btn.title = "Create a new file in this directory";
  btn.setAttribute("aria-label", "Create a new file in this directory");
  btn.append(createIcon("plus", "", 10));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void showPromptDialog({
      title: "New file",
      message: `Created in ${dir}`,
      initialValue: "untitled.txt",
      confirmLabel: "Create",
      validate: validateNewFileName,
    }).then((name) => {
      if (!name) return;
      htEvents.emit("ht-open-file-in-editor", {
        path: `${dir.replace(/\/+$/, "")}/${name}`,
        workspaceId,
        create: true,
      });
    });
  });
  return btn;
}
