// §6.5 — `bin/ht` split. The former ~980-line `mapCommand` switch is now a
// pure function in src/cli/map-command.ts. These pin a representative slice
// of the command → JSON-RPC mapping so the extraction stays faithful.

import { describe, test, expect } from "bun:test";
import {
  mapCommand,
  mapBrowserSubcommand,
  BROWSER_HELP,
} from "../src/cli/map-command";
import type { CliContext } from "../src/cli/types";

function ctx(
  command: string,
  positional: string[] = [],
  flags: Record<string, string> = {},
  args: string[] = [command, ...positional],
): CliContext {
  return { args, command, positional, flags };
}

describe("mapCommand — system verbs", () => {
  test("ping → system.ping", () => {
    expect(mapCommand(ctx("ping"))).toEqual({
      method: "system.ping",
      params: {},
    });
  });

  test("version → system.version", () => {
    expect(mapCommand(ctx("version")).method).toBe("system.version");
  });

  test("identify → system.identify", () => {
    expect(mapCommand(ctx("identify")).method).toBe("system.identify");
  });
});

describe("mapCommand — send (keystrokes)", () => {
  test("maps to surface.send_text with the targeted surface + unescaped text", () => {
    const call = mapCommand(
      ctx("send", ["hello\\n"], { surface: "surface:2" }),
    );
    expect(call.method).toBe("surface.send_text");
    expect(call.params["surface_id"]).toBe("surface:2");
    // \n is unescaped to a carriage return (terminal submit).
    expect(call.params["text"]).toBe("hello\r");
  });
});

describe("mapBrowserSubcommand", () => {
  test("positional surface ref targets browser.navigate", () => {
    const call = mapBrowserSubcommand(
      ctx("browser", ["browser:2", "navigate", "http://x"]),
    );
    expect(call).toEqual({
      method: "browser.navigate",
      params: { surface_id: "browser:2", url: "http://x" },
    });
  });

  test("--surface flag is honored for click", () => {
    const call = mapBrowserSubcommand(
      ctx("browser", ["click", "#btn"], { surface: "browser:3" }),
    );
    expect(call.method).toBe("browser.click");
    expect(call.params["surface_id"]).toBe("browser:3");
    expect(call.params["selector"]).toBe("#btn");
  });

  test("no subcommand falls back to identify", () => {
    expect(mapBrowserSubcommand(ctx("browser", [])).method).toBe(
      "browser.identify",
    );
  });

  test("open with a surface navigates; without one opens", () => {
    expect(
      mapBrowserSubcommand(ctx("browser", ["open", "http://x"])).method,
    ).toBe("browser.open");
    expect(
      mapBrowserSubcommand(
        ctx("browser", ["open", "http://x"], { surface: "browser:1" }),
      ).method,
    ).toBe("browser.navigate");
  });
});

describe("mapCommand — screenshot targets", () => {
  test("default (no target) crops to the focused/--surface pane", () => {
    const call = mapCommand(ctx("screenshot", [], { surface: "surface:2" }));
    expect(call.method).toBe("surface.screenshot");
    expect(call.params).toMatchObject({
      surface_id: "surface:2",
      full_window: false,
      workspace: false,
    });
  });

  test("`window` / --full-window captures the whole app (no crop target)", () => {
    expect(mapCommand(ctx("screenshot", ["window"])).params).toMatchObject({
      full_window: true,
      workspace: false,
      surface_id: undefined,
    });
    expect(
      mapCommand(ctx("screenshot", [], { "full-window": "true" })).params,
    ).toMatchObject({ full_window: true });
  });

  test("`workspace` positional → workspace mode, active workspace", () => {
    const call = mapCommand(ctx("screenshot", ["workspace"]));
    expect(call.params).toMatchObject({
      workspace: true,
      full_window: false,
      surface_id: undefined,
      workspace_id: undefined,
    });
  });

  test("`workspace <id>` and `--workspace <id>` target a specific workspace", () => {
    expect(
      mapCommand(ctx("screenshot", ["workspace", "ws:3"])).params[
        "workspace_id"
      ],
    ).toBe("ws:3");
    expect(
      mapCommand(ctx("screenshot", [], { workspace: "ws:4" })).params,
    ).toMatchObject({ workspace: true, workspace_id: "ws:4" });
  });

  test("bare --workspace (no id) is workspace mode with no id", () => {
    // parseFlags turns a trailing `--workspace` into "true".
    const call = mapCommand(ctx("screenshot", [], { workspace: "true" }));
    expect(call.params).toMatchObject({
      workspace: true,
      workspace_id: undefined,
    });
  });
});

describe("mapCommand — browser dispatch + help block", () => {
  test("`browser` routes through the browser submapper", () => {
    expect(
      mapCommand(ctx("browser", ["back"], { surface: "browser:1" })).method,
    ).toBe("browser.back");
  });

  test("BROWSER_HELP is shared, non-empty text", () => {
    expect(BROWSER_HELP).toContain("ht browser");
  });
});
