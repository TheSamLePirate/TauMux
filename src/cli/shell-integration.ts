/**
 * `ht shell-integration` — install / remove the optional OSC 133 hooks.
 *
 * A local file operation on the user's rc file, so it lives in the CLI
 * rather than behind an RPC: it must work whether or not τ-mux is
 * running, and it edits a file the app has no business touching on its
 * own.
 *
 * The line we add sources `$HT_SHELL_INTEGRATION_PATH`, which τ-mux
 * exports into every PTY. Two consequences worth stating:
 *
 *   - Outside τ-mux the variable is unset, the guard fails, and the rc
 *     file behaves exactly as before. Installing this cannot break the
 *     user's shell in iTerm2, over SSH, or in a CI container.
 *   - The path is resolved at spawn time, so moving or updating the .app
 *     does not leave a stale absolute path behind.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Marker comment bracketing our block, so uninstall is exact rather
 *  than a fuzzy line match. */
export const BEGIN_MARK = "# >>> tau-mux shell integration >>>";
export const END_MARK = "# <<< tau-mux shell integration <<<";

export const SNIPPET = [
  BEGIN_MARK,
  "# Optional OSC 133 marks so `ht blocks` knows where commands start,",
  "# end, and what they returned. No-op outside tau-mux.",
  '[ -n "${HT_SHELL_INTEGRATION_PATH:-}" ] && [ -r "$HT_SHELL_INTEGRATION_PATH" ] && . "$HT_SHELL_INTEGRATION_PATH"',
  END_MARK,
].join("\n");

export type ShellKind = "zsh" | "bash";

/** rc file for a shell, in the user's home. */
export function rcPathFor(shell: ShellKind, home = homedir()): string {
  return join(home, shell === "zsh" ? ".zshrc" : ".bashrc");
}

/** Which shell the user actually runs, from $SHELL. Defaults to zsh —
 *  the macOS default, and this app is macOS-only today. */
export function detectShell(shellPath = process.env["SHELL"] ?? ""): ShellKind {
  return /bash$/.test(shellPath) ? "bash" : "zsh";
}

export function isInstalledIn(contents: string): boolean {
  return contents.includes(BEGIN_MARK);
}

/**
 * Add the block if absent. Returns what happened so the caller can print
 * an honest message rather than always claiming success.
 *
 * Backs the rc file up first — we are editing a file whose corruption
 * would leave the user without a working shell.
 */
export function installInto(rcPath: string): "installed" | "already" {
  const existing = existsSync(rcPath) ? readFileSync(rcPath, "utf-8") : "";
  if (isInstalledIn(existing)) return "already";
  if (existsSync(rcPath)) copyFileSync(rcPath, `${rcPath}.tau-mux.bak`);
  const separator = existing.length && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(rcPath, `${existing}${separator}\n${SNIPPET}\n`, "utf-8");
  return "installed";
}

/** Remove the block, marker to marker. Leaves everything else alone. */
export function uninstallFrom(rcPath: string): "removed" | "absent" {
  if (!existsSync(rcPath)) return "absent";
  const existing = readFileSync(rcPath, "utf-8");
  if (!isInstalledIn(existing)) return "absent";
  copyFileSync(rcPath, `${rcPath}.tau-mux.bak`);
  writeFileSync(rcPath, stripSnippet(existing), "utf-8");
  return "removed";
}

/**
 * Drop every begin→end region. Pure, so the edit is testable without
 * touching a real rc file — which matters for a function whose bug
 * would eat someone's shell config.
 *
 * An unterminated begin marker (hand-edited file) removes to end of
 * file: leaving a dangling `. "$HT_SHELL_INTEGRATION_PATH"` behind would
 * be worse than removing a comment the user may have added below it.
 */
export function stripSnippet(contents: string): string {
  const lines = contents.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (!skipping && line.trim() === BEGIN_MARK) {
      skipping = true;
      // Drop a single blank line immediately before the block, which is
      // the one `installInto` added.
      if (out.length && out.at(-1)!.trim() === "") out.pop();
      continue;
    }
    if (skipping) {
      if (line.trim() === END_MARK) skipping = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}
