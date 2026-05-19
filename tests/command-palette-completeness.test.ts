// CP9 — palette completeness guard. The command palette is the single
// place users discover and execute everything τ-mux can do. When a new
// surface kind, browser action, or workspace verb lands, it MUST also
// land in buildPaletteCommands() — otherwise the feature is invisible
// to keyboard-only users and to anyone who hasn't memorised the chord.
//
// This test parses src/views/terminal/index.ts and asserts the set of
// command ids covers every category the UI exposes. It's a source-level
// scrape, not a runtime exercise, because buildPaletteCommands closes
// over a fully-wired SurfaceManager / RPC pair that can't be cheaply
// stood up in a unit test.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexSrc = readFileSync(
  join(import.meta.dir, "..", "src", "views", "terminal", "index.ts"),
  "utf8",
);

function collectStaticIds(src: string): Set<string> {
  const ids = new Set<string>();
  const re = /id:\s*"([a-z0-9-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

const ids = collectStaticIds(indexSrc);

describe("[CP9] command palette completeness", () => {
  test.each([
    "new-workspace",
    "workspace-rename",
    "workspace-close",
    "workspace-color",
    "workspace-cwd",
  ])("workspace op '%s' is registered", (id) => {
    expect(ids.has(id)).toBe(true);
  });

  test.each(["pane-rename", "pane-copy-cwd", "pane-open-cwd-editor"])(
    "pane op '%s' is registered",
    (id) => {
      expect(ids.has(id)).toBe(true);
    },
  );

  test.each([
    "browser-back",
    "browser-forward",
    "browser-reload",
    "browser-devtools",
    "browser-find",
    "browser-address-bar",
    "browser-zoom-in",
    "browser-zoom-out",
    "browser-zoom-reset",
  ])("browser op '%s' is registered", (id) => {
    expect(ids.has(id)).toBe(true);
  });

  test.each(["editor-open-path", "editor-split", "editor-new", "editor-save"])(
    "editor op '%s' is registered",
    (id) => {
      expect(ids.has(id)).toBe(true);
    },
  );

  test.each(["sidebar-clear-logs", "reveal-log-file", "open-settings"])(
    "view utility '%s' is registered",
    (id) => {
      expect(ids.has(id)).toBe(true);
    },
  );

  // Dynamic command groups use template-literal ids, not literal "id:"
  // strings — assert the *generator* lives in the file instead.
  test("theme preset commands are generated from THEME_PRESETS", () => {
    expect(indexSrc).toContain("THEME_PRESETS.map");
    expect(indexSrc).toContain("theme-${preset.id}");
  });

  test("workspace jump commands are generated from wsState.workspaces", () => {
    expect(indexSrc).toContain("wsState.workspaces.map");
    expect(indexSrc).toContain("workspace-jump-${ws.id}");
  });
});
