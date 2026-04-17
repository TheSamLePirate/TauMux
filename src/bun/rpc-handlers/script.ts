import type { Handler, HandlerDeps } from "./types";

/** script.* handlers: launch arbitrary commands inside a workspace.
 *  Socket-facing peer of the webview-side `runScript` message — both
 *  converge on the `runScript` dispatch action in `src/bun/index.ts`. */
export function registerScript(deps: HandlerDeps): Record<string, Handler> {
  const { dispatch, getState } = deps;

  return {
    /** Spawn a new surface running `command` in `cwd`, tagged for
     *  sidebar script-status tracking. Parameters:
     *    - workspace_id: which workspace to attach the surface to
     *      (defaults to the active workspace).
     *    - cwd: absolute path. Required.
     *    - command: shell command line to feed into the surface's stdin
     *      after the login shell settles. Required.
     *    - script_key: a caller-supplied id the sidebar uses to track
     *      running/errored state (e.g. "package.json:scripts:test").
     *      Defaults to a timestamp if omitted. */
    "script.run": (params) => {
      const cwd = params["cwd"] as string | undefined;
      const command = params["command"] as string | undefined;
      if (!cwd || !command) throw new Error("cwd and command required");
      const workspaceId =
        (params["workspace_id"] as string | undefined) ??
        (params["workspace"] as string | undefined) ??
        getState().activeWorkspaceId ??
        undefined;
      if (!workspaceId) throw new Error("no active workspace");
      const scriptKey =
        (params["script_key"] as string | undefined) ??
        `script.run:${Date.now()}`;
      dispatch("runScript", {
        workspaceId,
        cwd,
        command,
        scriptKey,
      });
      return { ok: true, scriptKey };
    },
  };
}
