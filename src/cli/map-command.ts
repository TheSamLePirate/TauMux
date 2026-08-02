/**
 * `ht` CLI command → JSON-RPC mapping — the former ~980-line switch split
 * out of `bin/ht` (§6.5). Pure mapping: takes the parsed argv context and
 * returns the RPC call (help / unknown-command paths still print + exit, as
 * before).
 */

import { readFileSync } from "node:fs";
import { unescapeText } from "./flags";
import type { CliContext, RpcCall } from "./types";

export const BROWSER_HELP = `Browser (use: ht browser [surface] <subcommand> [args...]):
  ht browser open [url]                     Open browser split (or navigate if surface given)
  ht browser open-split [url]               Split browser alongside current pane
  ht browser [S] navigate <url>             Navigate to URL
  ht browser [S] back|forward|reload        Navigation
  ht browser [S] url                        Print current URL
  ht browser [S] identify                   Show browser surface metadata

  ht browser [S] wait --selector|--text|--url-contains|--load-state|--function [--timeout-ms N]

  ht browser [S] click <sel>                Click element
  ht browser [S] dblclick|hover|focus <sel> Mouse actions
  ht browser [S] check|uncheck <sel>        Checkbox toggle
  ht browser [S] scroll-into-view <sel>     Scroll element into view
  ht browser [S] type <sel> <text>          Type text into element
  ht browser [S] fill <sel> [text]          Fill input (empty = clear)
  ht browser [S] press|keydown|keyup <key>  Keyboard events
  ht browser [S] select <sel> <value>       Select dropdown option
  ht browser [S] scroll [--dx N] [--dy N]   Scroll page or element
  ht browser [S] highlight <sel>            Highlight element (3s)

  ht browser [S] snapshot [--selector sel] [--max-depth N]
  ht browser [S] get <title|url|text|html|value|attr|count|box|styles> [sel]
  ht browser [S] is <visible|enabled|checked> <sel>

  ht browser [S] eval <script>              Execute JavaScript
  ht browser [S] addscript <script>         Inject JavaScript
  ht browser [S] addstyle <css>             Inject CSS

  ht browser [S] console [list|clear]       Page console messages
  ht browser [S] errors [list|clear]        Page errors

  ht browser [S] devtools                   Toggle developer tools
  ht browser [S] find-in-page <query>       Find text in page
  ht browser history [clear]                Browser history
  ht browser list                           List all browser surfaces
  ht browser [S] close                      Close browser surface

  Cookie Management (use: ht browser-cookie-<cmd>):
  browser-cookie-list [domain]              List stored cookies
  browser-cookie-get <url>                  Get cookies matching a URL
  browser-cookie-set <name> <value> --domain <d> [--path /] [--secure true]
  browser-cookie-delete <domain> <name>     Delete a specific cookie
  browser-cookie-clear [domain]             Clear cookies (all or per-domain)
  browser-cookie-import <file> [--format json|netscape]  Import cookie file
  browser-cookie-export [--format json|netscape]         Export all cookies
  browser-cookie-capture [--surface S]      Capture cookies from current page

  [S] = optional --surface browser:N or positional browser:N

  Legacy aliases: browser-open, browser-split, browser-navigate, etc.`;

export function mapBrowserSubcommand(ctx: CliContext): RpcCall {
  const { positional, flags } = ctx;
  // `--help` / `-h` get consumed by parseFlags as flags, so they never
  // appear as a positional subcommand. Catch them up-front before the
  // identify-fallback branch turns "no subcommand" into an RPC call.
  if (flags["help"] === "true" || flags["h"] === "true") {
    console.log(BROWSER_HELP);
    process.exit(0);
  }

  // Parse: positional[0] might be a surface ref or a subcommand
  let surfaceId: string | undefined = flags["surface"];
  let sub: string;
  let subArgs: string[];

  if (
    positional[0]?.startsWith("browser:") ||
    positional[0]?.startsWith("surface:")
  ) {
    surfaceId = positional[0];
    sub = positional[1] || "identify";
    subArgs = positional.slice(2);
  } else {
    sub = positional[0] || "identify";
    subArgs = positional.slice(1);
  }

  const sid = surfaceId;
  const snapshotAfter =
    flags["snapshot-after"] === "true" || flags["snapshot_after"] === "true";

  switch (sub) {
    // Navigation
    case "open":
      return {
        method: sid ? "browser.navigate" : "browser.open",
        params: { surface_id: sid, url: subArgs[0] },
      };
    case "open-split":
      return {
        method: "browser.open_split",
        params: { url: subArgs[0], direction: flags["direction"] || "right" },
      };
    case "goto":
    case "navigate":
      return {
        method: "browser.navigate",
        params: { surface_id: sid, url: subArgs[0] },
      };
    case "back":
      return { method: "browser.back", params: { surface_id: sid } };
    case "forward":
      return { method: "browser.forward", params: { surface_id: sid } };
    case "reload":
      return { method: "browser.reload", params: { surface_id: sid } };
    case "url":
    case "get-url":
      return { method: "browser.url", params: { surface_id: sid } };
    case "identify":
      return { method: "browser.identify", params: { surface_id: sid } };

    // Wait
    case "wait":
      return {
        method: "browser.wait",
        params: {
          surface_id: sid,
          selector: flags["selector"],
          text: flags["text"],
          url_contains: flags["url-contains"] || flags["url_contains"],
          load_state: flags["load-state"] || flags["load_state"],
          function: flags["function"],
          timeout_ms: flags["timeout-ms"] || flags["timeout_ms"],
        },
      };

    // DOM Interaction
    case "click":
      return {
        method: "browser.click",
        params: {
          surface_id: sid,
          selector: subArgs[0],
          snapshot_after: snapshotAfter,
        },
      };
    case "dblclick":
      return {
        method: "browser.dblclick",
        params: { surface_id: sid, selector: subArgs[0] },
      };
    case "hover":
      return {
        method: "browser.hover",
        params: { surface_id: sid, selector: subArgs[0] },
      };
    case "focus":
      return {
        method: "browser.focus",
        params: { surface_id: sid, selector: subArgs[0] },
      };
    case "check":
      return {
        method: "browser.check",
        params: { surface_id: sid, selector: subArgs[0] },
      };
    case "uncheck":
      return {
        method: "browser.uncheck",
        params: { surface_id: sid, selector: subArgs[0] },
      };
    case "scroll-into-view":
      return {
        method: "browser.scroll_into_view",
        params: { surface_id: sid, selector: subArgs[0] },
      };
    case "type":
      return {
        method: "browser.type",
        params: {
          surface_id: sid,
          selector: subArgs[0],
          text: subArgs[1] || flags["text"],
        },
      };
    case "fill":
      return {
        method: "browser.fill",
        params: {
          surface_id: sid,
          selector: subArgs[0],
          text: subArgs[1] ?? flags["text"] ?? "",
        },
      };
    case "press":
      return {
        method: "browser.press",
        params: { surface_id: sid, key: subArgs[0] },
      };
    case "keydown":
      return {
        method: "browser.press",
        params: { surface_id: sid, key: subArgs[0] },
      };
    case "keyup":
      return {
        method: "browser.press",
        params: { surface_id: sid, key: subArgs[0] },
      };
    case "select":
      return {
        method: "browser.select",
        params: { surface_id: sid, selector: subArgs[0], value: subArgs[1] },
      };
    case "scroll":
      return {
        method: "browser.scroll",
        params: {
          surface_id: sid,
          selector: flags["selector"],
          dx: flags["dx"],
          dy: flags["dy"],
        },
      };
    case "highlight":
      return {
        method: "browser.highlight",
        params: { surface_id: sid, selector: subArgs[0] },
      };

    // Inspection
    case "snapshot":
      return {
        method: "browser.snapshot",
        params: {
          surface_id: sid,
          selector: flags["selector"],
          max_depth: flags["max-depth"] || flags["max_depth"],
          interactive: flags["interactive"] === "true" || flags["i"] === "true",
          compact: flags["compact"] === "true",
        },
      };
    case "get":
      return {
        method: "browser.get",
        params: {
          surface_id: sid,
          what: subArgs[0],
          selector: subArgs[1] || flags["selector"],
          attr: flags["attr"],
          property: flags["property"],
        },
      };
    case "is":
      return {
        method: "browser.is",
        params: {
          surface_id: sid,
          check: subArgs[0],
          selector: subArgs[1] || flags["selector"],
        },
      };

    // Eval / injection
    case "eval":
      return {
        method: "browser.eval",
        params: { surface_id: sid, script: subArgs[0] || flags["script"] },
      };
    case "addscript":
      return {
        method: "browser.addscript",
        params: { surface_id: sid, script: subArgs[0] },
      };
    case "addstyle":
      return {
        method: "browser.addstyle",
        params: { surface_id: sid, css: subArgs[0] },
      };

    // Console & errors
    case "console":
      if (subArgs[0] === "clear")
        return { method: "browser.console_clear", params: { surface_id: sid } };
      return { method: "browser.console_list", params: { surface_id: sid } };
    case "errors":
      if (subArgs[0] === "clear")
        return { method: "browser.errors_clear", params: { surface_id: sid } };
      return { method: "browser.errors_list", params: { surface_id: sid } };

    // Find in page
    case "find-in-page":
      return {
        method: "browser.find",
        params: { surface_id: sid, query: subArgs[0] },
      };

    // DevTools
    case "devtools":
      return { method: "browser.devtools", params: { surface_id: sid } };

    // History
    case "history":
      if (subArgs[0] === "clear")
        return { method: "browser.clear_history", params: {} };
      return { method: "browser.history", params: {} };

    // Close
    case "close":
      return { method: "browser.close", params: { surface_id: sid } };

    // List
    case "list":
      return { method: "browser.list", params: {} };

    case "help":
      // The `default` branch tells users to run `ht browser help`, so
      // that command must actually work. Print the same browser section
      // surfaced by `ht --help`, then exit cleanly without making an RPC.
      console.log(BROWSER_HELP);
      process.exit(0);

    default:
      console.error(`Unknown browser subcommand: ${sub}`);
      console.error('Run "ht browser help" for usage.');
      process.exit(1);
  }
}

export function mapCommand(ctx: CliContext): RpcCall {
  const { args, command, positional, flags } = ctx;
  switch (command) {
    case "ping":
      return { method: "system.ping", params: {} };
    case "version":
      return { method: "system.version", params: {} };
    case "identify":
      return { method: "system.identify", params: {} };
    case "capabilities":
      return { method: "system.capabilities", params: {} };
    case "tree":
      return { method: "system.tree", params: {} };

    case "edit":
      return {
        method: "editor.open",
        params: {
          path: positional[0],
          split: true,
          direction: flags["direction"] || "right",
          create: flags["create"] === "true",
          cwd: flags["cwd"],
        },
      };
    case "editor": {
      const sub = positional[0] || "open";
      const target = positional[1];
      if (sub === "open") {
        return {
          method: "editor.open",
          params: {
            path: target,
            split: flags["split"] === "true",
            direction: flags["direction"] || "right",
            create: flags["create"] === "true",
            cwd: flags["cwd"],
          },
        };
      }
      if (sub === "split") {
        return {
          method: "editor.split",
          params: {
            path: target,
            direction: flags["direction"] || "right",
            create: flags["create"] === "true",
            cwd: flags["cwd"],
          },
        };
      }
      if (sub === "list") return { method: "editor.list", params: {} };
      if (sub === "save")
        return {
          method: "editor.save",
          params: { surface_id: target || flags["surface"] },
        };
      if (sub === "reload")
        return {
          method: "editor.reload",
          params: { surface_id: target || flags["surface"] },
        };
      if (sub === "close")
        return {
          method: "editor.close",
          params: { surface_id: target || flags["surface"] },
        };
      throw new Error(`Unknown editor subcommand: ${sub}`);
    }

    case "extension":
    case "ext": {
      const sub = positional[0] || "list";
      const target = positional[1];
      if (sub === "list") return { method: "extension.list", params: {} };
      if (sub === "templates")
        return { method: "extension.templates", params: {} };
      if (sub === "open")
        return {
          method: "extension.open",
          params: {
            id: target,
            split: flags["split"] === "true",
            direction: flags["direction"] || "right",
          },
        };
      if (sub === "split")
        return {
          method: "extension.split",
          params: { id: target, direction: flags["direction"] || "right" },
        };
      if (sub === "new")
        return {
          method: "extension.new",
          params: {
            id: target,
            template: flags["template"],
            name: flags["name"],
          },
        };
      if (sub === "install")
        return { method: "extension.install", params: { path: target } };
      if (sub === "remove")
        return { method: "extension.remove", params: { id: target } };
      if (sub === "enable")
        return { method: "extension.enable", params: { id: target } };
      if (sub === "disable")
        return { method: "extension.disable", params: { id: target } };
      if (sub === "reload") return { method: "extension.reload", params: {} };
      if (sub === "stop")
        return {
          method: "extension.stop",
          params: { surface_id: target || flags["surface"] },
        };
      throw new Error(`Unknown extension subcommand: ${sub}`);
    }

    // august-plan M1 — Claude Code integration verbs. `ht claude
    // statusline` is intercepted in bin/ht main() (it reads stdin and
    // must print before the tee); everything else is a plain RPC map.
    case "claude": {
      const sub = positional[0];
      if (sub === "event") {
        const rawJson = flags["json"] ?? positional[1] ?? "";
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(rawJson) as Record<string, unknown>;
        } catch {
          throw new Error(
            "ht claude event: --json '<bridge-event JSON>' is required",
          );
        }
        // Pane attribution fallback: the ht-bridge hook process inherits
        // HT_SURFACE from the pane's shell, and so do we — belt and
        // braces for producers that forget to set it themselves.
        if (!event["surfaceId"] && process.env["HT_SURFACE"]) {
          event["surfaceId"] = process.env["HT_SURFACE"];
        }
        return { method: "claude.event", params: { event } };
      }
      if (sub === "pane") {
        return {
          method: "claude.pane",
          params: {
            cwd: flags["cwd"],
            resume: flags["resume"],
            split: flags["split"] === "true",
            direction: flags["direction"],
          },
        };
      }
      if (sub === "sessions") {
        return {
          method: "claude.sessions",
          params: { all: flags["all"] === "true" },
        };
      }
      if (sub === "statusline") {
        throw new Error(
          "ht claude statusline: handled by main() — should not reach mapCommand",
        );
      }
      throw new Error(
        `Unknown claude subcommand: ${sub ?? "(none)"} (expected pane|sessions|statusline|install|uninstall|doctor|event)`,
      );
    }

    case "list-workspaces":
      return { method: "workspace.list", params: {} };
    case "current-workspace":
      return { method: "workspace.current", params: {} };
    case "new-workspace":
      return {
        method: "workspace.create",
        params: { name: flags["name"], cwd: flags["cwd"] },
      };
    case "select-workspace":
      return {
        method: "workspace.select",
        params: { workspace_id: flags["workspace"] },
      };
    case "close-workspace":
      return {
        method: "workspace.close",
        params: { workspace_id: flags["workspace"] },
      };
    case "rename-workspace":
      // --workspace W is optional. When absent, the backend resolves the
      // workspace from `surface_id` (which we set from HT_SURFACE so
      // `ht rename-workspace "build"` works from inside a τ-mux pane).
      // If neither is set, the backend falls back to the active workspace.
      return {
        method: "workspace.rename",
        params: {
          workspace_id: flags["workspace"],
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
          name: positional[0],
        },
      };
    case "next-workspace":
      return { method: "workspace.next", params: {} };
    case "previous-workspace":
      return { method: "workspace.previous", params: {} };

    case "list-surfaces":
      return { method: "surface.list", params: {} };
    case "new-split":
      return {
        method: "surface.split",
        params: { direction: positional[0] || "right" },
      };
    case "close-surface":
      return {
        method: "surface.close",
        params: { surface_id: flags["surface"] },
      };
    case "focus-surface":
      return {
        method: "surface.focus",
        params: { surface_id: flags["surface"] },
      };
    case "rename-surface":
      // --surface S is optional. When absent, the backend resolves the
      // surface from HT_SURFACE (set in every τ-mux pane) and finally
      // from the focused surface.
      return {
        method: "surface.rename",
        params: {
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
          name: positional[0],
        },
      };

    case "send":
      return {
        method: "surface.send_text",
        params: {
          surface_id: flags["surface"],
          text: unescapeText(positional[0] || ""),
        },
      };
    case "send-key":
      return {
        method: "surface.send_key",
        params: {
          surface_id: flags["surface"],
          key: positional[0],
        },
      };
    case "read-screen":
      return {
        method: "surface.read_text",
        params: {
          surface_id: flags["surface"],
          lines: flags["lines"] ? parseInt(flags["lines"]) : undefined,
          scrollback: flags["scrollback"] === "true",
        },
      };

    case "screenshot": {
      // `ht screenshot` captures the app window via macOS
      // `screencapture -l <windowId>`, then crops:
      //   • (default) / `surface`  → the focused pane (or --surface / HT_SURFACE)
      //   • `workspace` / --workspace [id] → all panes of a workspace
      //                                      (default the active one)
      //   • `window` / --full-window → the whole app, no crop
      // Output path is optional — omitted ⇒ a timestamped PNG in tmpdir.
      const target = positional[0];
      const fullWindow = flags["full-window"] === "true" || target === "window";
      const workspaceMode =
        !fullWindow &&
        (target === "workspace" ||
          target === "ws" ||
          flags["workspace"] !== undefined);
      // `--workspace ws:2` carries an id; a bare `--workspace` parses to
      // "true" (no id ⇒ active). `ht screenshot workspace ws:2` puts the id
      // in positional[1].
      const workspaceId =
        flags["workspace"] && flags["workspace"] !== "true"
          ? flags["workspace"]
          : positional[1] || undefined;
      return {
        method: "surface.screenshot",
        params: {
          surface_id:
            fullWindow || workspaceMode
              ? undefined
              : flags["surface"] || process.env["HT_SURFACE"] || undefined,
          output: flags["output"] || flags["o"],
          full_window: fullWindow,
          workspace: workspaceMode,
          workspace_id: workspaceMode ? workspaceId : undefined,
        },
      };
    }

    case "list-panes":
      return { method: "pane.list", params: {} };

    case "metadata":
    case "cwd":
    case "ps":
    case "ports":
    case "git":
      return {
        method: "surface.metadata",
        params: {
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
        },
      };

    case "wait-ready":
    case "wait_ready":
      return {
        method: "surface.wait_ready",
        params: {
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
          timeout_ms:
            flags["timeout-ms"] || flags["timeout_ms"]
              ? Number(flags["timeout-ms"] || flags["timeout_ms"])
              : undefined,
        },
      };

    case "open":
      return {
        method: "surface.open_port",
        params: {
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
          port: positional[0] ? parseInt(positional[0], 10) : undefined,
        },
      };

    case "kill":
      return {
        method: "surface.kill_port",
        params: {
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
          port: positional[0] ? parseInt(positional[0], 10) : undefined,
          signal: flags["signal"],
        },
      };

    case "set-status":
      return {
        method: "sidebar.set_status",
        params: {
          workspace_id: flags["workspace"],
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
          key: positional[0],
          value: positional[1],
          icon: flags["icon"],
          color: flags["color"],
        },
      };
    case "clear-status":
      return {
        method: "sidebar.clear_status",
        params: {
          workspace_id: flags["workspace"],
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
          key: positional[0],
        },
      };
    case "set-progress":
      return {
        method: "sidebar.set_progress",
        params: {
          workspace_id: flags["workspace"],
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
          value: parseFloat(positional[0] || "0"),
          label: flags["label"],
        },
      };
    case "clear-progress":
      return {
        method: "sidebar.clear_progress",
        params: {
          workspace_id: flags["workspace"],
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
        },
      };
    case "log":
      return {
        method: "sidebar.log",
        params: {
          workspace_id: flags["workspace"],
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
          level: flags["level"] || "info",
          message: positional[0],
          source: flags["source"],
        },
      };

    case "notify":
      return {
        method: "notification.create",
        params: {
          title: flags["title"] || positional[0] || "",
          subtitle: flags["subtitle"],
          body: flags["body"] || positional[1] || "",
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
        },
      };
    case "list-notifications":
      return { method: "notification.list", params: {} };
    case "clear-notifications":
      return { method: "notification.clear", params: {} };

    // ── Browser (unified `ht browser <sub>` command, cmux-compatible) ──

    case "browser":
      return mapBrowserSubcommand(ctx);

    // Legacy hyphenated aliases
    case "browser-open":
      return {
        method: "browser.open",
        params: { url: positional[0] },
      };
    case "browser-split":
      return {
        method: "browser.open_split",
        params: {
          url: positional[0],
          direction: flags["direction"] || "right",
        },
      };
    case "browser-navigate":
      return {
        method: "browser.navigate",
        params: {
          surface_id: flags["surface"] || positional[0],
          url: positional[1] || flags["url"],
        },
      };
    case "browser-back":
      return {
        method: "browser.back",
        params: { surface_id: flags["surface"] },
      };
    case "browser-forward":
      return {
        method: "browser.forward",
        params: { surface_id: flags["surface"] },
      };
    case "browser-reload":
      return {
        method: "browser.reload",
        params: { surface_id: flags["surface"] },
      };
    case "browser-url":
      return {
        method: "browser.url",
        params: { surface_id: flags["surface"] },
      };
    case "browser-eval":
      return {
        method: "browser.eval",
        params: {
          surface_id: flags["surface"],
          script: positional[0],
        },
      };
    case "browser-find":
      return {
        method: "browser.find",
        params: {
          surface_id: flags["surface"],
          query: positional[0],
        },
      };
    case "browser-devtools":
      return {
        method: "browser.devtools",
        params: { surface_id: flags["surface"] },
      };
    case "browser-history":
      return { method: "browser.history", params: {} };
    case "browser-clear-history":
      return { method: "browser.clear_history", params: {} };
    case "browser-snapshot":
      return {
        method: "browser.snapshot",
        params: { surface_id: flags["surface"] },
      };
    case "browser-close":
      return {
        method: "browser.close",
        params: { surface_id: flags["surface"] },
      };
    case "list-browsers":
      return { method: "browser.list", params: {} };

    // Cookie commands
    case "browser-cookie-list":
      return {
        method: "browser.cookie_list",
        params: { domain: args[0] || flags["domain"] },
      };
    case "browser-cookie-get":
      return {
        method: "browser.cookie_get",
        params: { url: args[0] || flags["url"] },
      };
    case "browser-cookie-set":
      return {
        method: "browser.cookie_set",
        params: {
          name: args[0] || flags["name"],
          value: args[1] || flags["value"],
          domain: flags["domain"],
          path: flags["path"] || "/",
          expires: ((): number => {
            // parseInt("garbage") returns NaN, parseInt("123abc") silently
            // returns 123 — both are footguns for a security-relevant field.
            // Use Number()+isFinite so bad input becomes 0 (session cookie).
            const raw = flags["expires"];
            if (!raw) return 0;
            const n = Number(raw);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
          })(),
          secure: flags["secure"] === "true",
          sameSite: flags["samesite"] || "",
        },
      };
    case "browser-cookie-delete":
      return {
        method: "browser.cookie_delete",
        params: {
          domain: args[0] || flags["domain"],
          name: args[1] || flags["name"],
          path: flags["path"] || "/",
        },
      };
    case "browser-cookie-clear":
      return {
        method: "browser.cookie_clear",
        params: { domain: args[0] || flags["domain"] },
      };
    case "browser-cookie-import": {
      const filePath = args[0] || flags["file"];
      let fileData = "";
      if (filePath) {
        try {
          fileData = readFileSync(filePath, "utf-8");
        } catch {
          console.error(`Failed to read file: ${filePath}`);
          process.exit(1);
        }
      }
      return {
        method: "browser.cookie_import",
        params: {
          data: fileData,
          format: flags["format"] || "json",
        },
      };
    }
    case "browser-cookie-export":
      return {
        method: "browser.cookie_export",
        params: { format: flags["format"] || "json" },
      };
    case "browser-cookie-capture":
      return {
        method: "browser.cookie_capture",
        params: { surface_id: flags["surface"] },
      };

    // tmux compat alias
    case "capture-pane":
      return {
        method: "surface.read_text",
        params: {
          surface_id: flags["surface"],
          lines: flags["lines"] ? parseInt(flags["lines"]) : undefined,
          scrollback: flags["scrollback"] === "true",
        },
      };

    // ── System: graceful shutdown ──
    case "shutdown":
      return { method: "system.shutdown", params: {} };

    // ── Sideband panel introspection ──
    case "panels":
    case "list-panels":
      return {
        method: "panel.list",
        params: {
          surface_id:
            flags["surface"] || process.env["HT_SURFACE"] || undefined,
        },
      };

    // ── Script runner ──
    // Spawn a new surface running a command in a target cwd. The returned
    // surface is tagged with the optional scriptKey so the sidebar tracks
    // running/errored state just like a package.json script launch.
    case "run-script":
      return {
        method: "script.run",
        params: {
          cwd: flags["cwd"] || positional[0],
          command: flags["command"] || positional[1] || positional[0],
          workspace_id: flags["workspace"],
          script_key: flags["script-key"] || flags["script_key"],
        },
      };

    // ── Telegram bridge ──
    // Read-side: list chats, dump recent history, show service status.
    // Write-side: send a message to a chat. Default chat resolution:
    //   1. --chat <id>
    //   2. $HT_TELEGRAM_CHAT
    // No implicit "most recent" lookup — keeping the CLI deterministic.
    case "telegram": {
      const sub = positional[0] || "status";
      // NB: chat-id resolution for `send`/`read` lives in bin/ht's main()
      // (out-of-band, with stdin + default-chat prefetch); the status /
      // chats / restart verbs below take no chat id.
      switch (sub) {
        case "status":
          return { method: "telegram.status", params: {} };
        case "restart":
          return { method: "telegram.restart", params: {} };
        case "chats":
        case "list":
          return { method: "telegram.chats", params: {} };
        case "read":
        case "history": {
          // Read shares send's default-chat semantics — handled out-of-band
          // in main() so we can prefetch the chat list when --chat is
          // missing. Same throw pattern as `send` for consistency.
          throw new Error(
            "telegram read: handled by main() — should not reach mapCommand",
          );
        }
        case "send": {
          // Send is handled out-of-band in main() so we can prefetch
          // the default chat list and read piped stdin. mapCommand only
          // ever sees `send` here when something else routes through —
          // throw a helpful error so the failure is loud.
          throw new Error(
            "telegram send: handled by main() — should not reach mapCommand",
          );
        }
        default:
          console.error(`Unknown telegram subcommand: ${sub}`);
          console.error("Supported: status | chats | read | send");
          process.exit(1);
      }
      break;
    }

    // ── Subsystem health ──
    // Aggregated view of every wired subsystem (pty, socket, web
    // mirror, telegram, audits). `ok: true` iff nothing is degraded
    // or errored — disabled subsystems don't count.
    case "health":
      return { method: "system.health", params: {} };

    // ── Agent plan (Plan #09) ──
    // `ht plan set --workspace W [--agent A] --json '[…]'`
    //   — replace the plan with the supplied steps.
    // `ht plan update <stepId> --state done|active|waiting|err`
    //   — patch a single step's state and/or title.
    // `ht plan complete`           — mark every step as done.
    // `ht plan clear`              — drop the plan entirely.
    // `ht plan list`               — print every active plan.
    case "plan": {
      const sub = positional[0] || "list";
      // Workspace is resolved server-side: explicit `--workspace` /
      // `HT_WORKSPACE_ID` wins; otherwise the backend falls back to the
      // workspace that owns `surface_id`. Inside a τ-mux pane HT_SURFACE
      // is auto-set, so `ht plan …` Just Works without flags.
      const workspaceId =
        flags["workspace"] ||
        flags["workspace_id"] ||
        process.env["HT_WORKSPACE_ID"] ||
        undefined;
      const surfaceId =
        flags["surface"] || process.env["HT_SURFACE"] || undefined;
      const agentId = flags["agent"] || flags["agent_id"] || undefined;
      const requireScope = (cmd: string): void => {
        if (!workspaceId && !surfaceId) {
          console.error(
            `ht plan ${cmd}: --workspace W is required (or run inside a τ-mux pane so HT_SURFACE is set)`,
          );
          process.exit(1);
        }
      };
      switch (sub) {
        case "list":
          return { method: "plan.list", params: {} };
        case "set": {
          requireScope("set");
          const json = flags["json"];
          if (!json) {
            console.error(
              "ht plan set: --json '<steps>' is required (array of {id,title,state})",
            );
            process.exit(1);
          }
          let steps: unknown;
          try {
            steps = JSON.parse(json);
          } catch (err) {
            console.error(
              `ht plan set: invalid JSON — ${(err as Error).message}`,
            );
            process.exit(1);
          }
          return {
            method: "plan.set",
            params: {
              workspace_id: workspaceId,
              surface_id: surfaceId,
              agent_id: agentId,
              steps,
            },
          };
        }
        case "update": {
          requireScope("update");
          const stepId = positional[1];
          if (!stepId) {
            console.error("ht plan update: <stepId> positional is required");
            process.exit(1);
          }
          return {
            method: "plan.update",
            params: {
              workspace_id: workspaceId,
              surface_id: surfaceId,
              agent_id: agentId,
              step_id: stepId,
              state: flags["state"],
              title: flags["title"],
            },
          };
        }
        case "complete": {
          requireScope("complete");
          return {
            method: "plan.complete",
            params: {
              workspace_id: workspaceId,
              surface_id: surfaceId,
              agent_id: agentId,
            },
          };
        }
        case "clear": {
          requireScope("clear");
          return {
            method: "plan.clear",
            params: {
              workspace_id: workspaceId,
              surface_id: surfaceId,
              agent_id: agentId,
            },
          };
        }
        default:
          console.error(`Unknown plan subcommand: ${sub}`);
          console.error("Supported: list | set | update | complete | clear");
          process.exit(1);
      }
      break;
    }

    // ── Auto-continue engine (Plan #09 commit C) ──
    // `ht autocontinue status`            — print engine config + paused list.
    // `ht autocontinue audit [--limit N]` — print last N decisions.
    // `ht autocontinue set --engine X
    //   [--dry-run BOOL] [--cooldown MS] [--max N]
    //   [--model NAME] [--api-key-env VAR]` — write settings.
    // `ht autocontinue fire <surface>`    — manual dispatch.
    // `ht autocontinue pause <surface>`   — pause auto-continue for a surface.
    // `ht autocontinue resume <surface>`  — clear the pause.
    case "autocontinue": {
      const sub = positional[0] || "status";
      switch (sub) {
        case "status":
          return { method: "autocontinue.status", params: {} };
        case "audit": {
          const limitRaw = flags["limit"];
          const params: Record<string, unknown> = {};
          if (limitRaw !== undefined) {
            const limit = Number.parseInt(limitRaw, 10);
            if (Number.isFinite(limit)) params["limit"] = limit;
          }
          return { method: "autocontinue.audit", params };
        }
        case "set": {
          const params: Record<string, unknown> = {};
          if (flags["engine"]) params["engine"] = flags["engine"];
          if (flags["dry-run"]) {
            const v = flags["dry-run"].toLowerCase();
            params["dryRun"] = v === "true" || v === "1" || v === "yes";
          }
          if (flags["cooldown"]) {
            const n = Number.parseInt(flags["cooldown"], 10);
            if (Number.isFinite(n)) params["cooldownMs"] = n;
          }
          if (flags["max"]) {
            const n = Number.parseInt(flags["max"], 10);
            if (Number.isFinite(n)) params["maxConsecutive"] = n;
          }
          if (flags["model"]) params["modelName"] = flags["model"];
          if (flags["api-key-env"])
            params["modelApiKeyEnv"] = flags["api-key-env"];
          if (Object.keys(params).length === 0) {
            console.error(
              "ht autocontinue set: pass at least one of --engine, --dry-run, --cooldown, --max, --model, --api-key-env",
            );
            process.exit(1);
          }
          return { method: "autocontinue.set", params };
        }
        case "fire": {
          const surfaceId = positional[1];
          if (!surfaceId) {
            console.error(
              "ht autocontinue fire: <surface> positional is required",
            );
            process.exit(1);
          }
          return {
            method: "autocontinue.fire",
            params: { surface_id: surfaceId },
          };
        }
        case "pause": {
          const surfaceId = positional[1];
          if (!surfaceId) {
            console.error(
              "ht autocontinue pause: <surface> positional is required",
            );
            process.exit(1);
          }
          return {
            method: "autocontinue.pause",
            params: { surface_id: surfaceId },
          };
        }
        case "resume": {
          const surfaceId = positional[1];
          if (!surfaceId) {
            console.error(
              "ht autocontinue resume: <surface> positional is required",
            );
            process.exit(1);
          }
          return {
            method: "autocontinue.resume",
            params: { surface_id: surfaceId },
          };
        }
        default:
          console.error(`Unknown autocontinue subcommand: ${sub}`);
          console.error(
            "Supported: status | audit | set | fire | pause | resume",
          );
          process.exit(1);
      }
      break;
    }

    // ── Startup audits ──
    // `audit list`   — return cached results (the running app
    //                  populates this once at boot via runAudits).
    // `audit run`    — rerun every audit; refresh the cache.
    // `audit fix`    — apply the named audit's fix and rerun it.
    case "audit": {
      const sub = positional[0] || "list";
      switch (sub) {
        case "list":
          return { method: "audit.list", params: {} };
        case "run":
          return { method: "audit.run", params: {} };
        case "fix":
          return { method: "audit.fix", params: { id: positional[1] } };
        default:
          console.error(`Unknown audit subcommand: ${sub}`);
          console.error("Supported: list | run | fix <id>");
          process.exit(1);
      }
      break;
    }

    // ── Agent panes ──
    case "agent": {
      const sub = positional[0] || "identify";
      switch (sub) {
        case "new":
        case "create":
          return { method: "agent.create", params: {} };
        case "split":
        case "new-split":
          return {
            method: "agent.create_split",
            params: { direction: positional[1] || "horizontal" },
          };
        case "list":
          return { method: "agent.list", params: {} };
        case "count":
          return { method: "agent.count", params: {} };
        case "close":
          return {
            method: "agent.close",
            params: {
              agent_id: flags["agent"] || positional[1],
              surface_id: flags["surface"] || positional[1],
            },
          };
        default:
          console.error(`Unknown agent subcommand: ${sub}`);
          console.error("Supported: new | split | list | count | close");
          process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "ht --help" for usage.');
      process.exit(1);
  }
}
