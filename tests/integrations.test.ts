/**
 * Settings → Integrations, bun side.
 *
 * The panel can now do what `ht claude install` and `ht shell-integration
 * install` do. These tests pin the two properties that make that safe:
 * the app and the CLI agree on what "installed" means (both run the same
 * planner), and every refusal path returns a message instead of throwing
 * — a settings.json we cannot parse must not take the main process down.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveFeatureStatuses,
  featureEvents,
  installClaudeBridge,
  readIntegrationsStatus,
  readShellIntegrationStatus,
  setShellIntegration,
  uninstallClaudeBridge,
} from "../src/bun/integrations";
import { sanitizeFeatures } from "../src/bun/webview-handlers/integrations";
import { HOOK_SPECS } from "../src/cli/claude-settings-edit";
import { BEGIN_MARK } from "../src/cli/shell-integration";

function fixture(): { dir: string; settingsPath: string; bridgeDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "tau-integrations-"));
  const bridgeDir = join(dir, "ht-bridge");
  mkdirSync(join(bridgeDir, "src"), { recursive: true });
  writeFileSync(join(bridgeDir, "src", "index.ts"), "// bridge\n");
  return { dir, settingsPath: join(dir, "settings.json"), bridgeDir };
}

describe("deriveFeatureStatuses", () => {
  test("nothing wired reports every feature missing", () => {
    const out = deriveFeatureStatuses([], "none");
    expect(out.map((f) => f.state)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
    ]);
  });

  test("all events of a feature wired reports installed", () => {
    const out = deriveFeatureStatuses(featureEvents("tasks"), "none");
    const tasks = out.find((f) => f.feature === "tasks")!;
    expect(tasks.state).toBe("installed");
    expect(tasks.wired).toBe(tasks.total);
  });

  test("some events of a feature wired reports partial", () => {
    // The case that matters: an upgrade adds a hook event to a feature
    // the user installed months ago. "installed" would be a lie, and
    // "missing" would hide that most of it works.
    const events = featureEvents("lifecycle");
    expect(events.length).toBeGreaterThan(1);
    const out = deriveFeatureStatuses([events[0]!], "none");
    const lifecycle = out.find((f) => f.feature === "lifecycle")!;
    expect(lifecycle.state).toBe("partial");
    expect(lifecycle.wired).toBe(1);
  });

  test("a user-defined statusline is not counted as ours", () => {
    const other = deriveFeatureStatuses([], "other");
    expect(other.find((f) => f.feature === "statusline")!.state).toBe(
      "missing",
    );
    const ours = deriveFeatureStatuses([], "ours");
    expect(ours.find((f) => f.feature === "statusline")!.state).toBe(
      "installed",
    );
  });

  test("featureEvents partitions HOOK_SPECS with no overlap", () => {
    const all = [
      ...featureEvents("lifecycle"),
      ...featureEvents("tasks"),
      ...featureEvents("approvals"),
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(HOOK_SPECS.length);
    expect(featureEvents("statusline")).toEqual([]);
  });
});

describe("installClaudeBridge", () => {
  test("writes the requested features and reports what changed", () => {
    const { settingsPath, bridgeDir } = fixture();
    const r = installClaudeBridge(["tasks"], { settingsPath, bridgeDir });
    expect(r.ok).toBe(true);

    const status = readIntegrationsStatus({ settingsPath, bridgeDir });
    const byFeature = new Map(
      status.claude.features.map((f) => [f.feature, f.state]),
    );
    expect(byFeature.get("tasks")).toBe("installed");
    expect(byFeature.get("lifecycle")).toBe("missing");
  });

  test("is idempotent — a second install changes nothing", () => {
    const { settingsPath, bridgeDir } = fixture();
    installClaudeBridge(["tasks"], { settingsPath, bridgeDir });
    const first = readFileSync(settingsPath, "utf-8");
    const again = installClaudeBridge(["tasks"], { settingsPath, bridgeDir });
    expect(again.ok).toBe(true);
    expect(again.message).toContain("Already installed");
    expect(readFileSync(settingsPath, "utf-8")).toBe(first);
  });

  test("an empty selection is refused, not read as 'install everything'", () => {
    const { settingsPath, bridgeDir } = fixture();
    const r = installClaudeBridge([], { settingsPath, bridgeDir });
    expect(r.ok).toBe(false);
    expect(
      readIntegrationsStatus({ settingsPath, bridgeDir }).claude.wiredEvents,
    ).toEqual([]);
  });

  test("refuses when the bridge checkout is missing", () => {
    const { settingsPath, dir } = fixture();
    const r = installClaudeBridge(["tasks"], {
      settingsPath,
      bridgeDir: join(dir, "nope"),
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Bridge not found");
  });

  test("refuses to rewrite a settings file it cannot parse", () => {
    const { settingsPath, bridgeDir } = fixture();
    writeFileSync(settingsPath, "{ not json");
    const r = installClaudeBridge(["tasks"], { settingsPath, bridgeDir });
    expect(r.ok).toBe(false);
    // The file is left exactly as the user left it.
    expect(readFileSync(settingsPath, "utf-8")).toBe("{ not json");

    const status = readIntegrationsStatus({ settingsPath, bridgeDir });
    expect(status.claude.settingsError).toBeTruthy();
  });

  test("leaves unmanaged hooks alone on uninstall", () => {
    const { settingsPath, bridgeDir } = fixture();
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "my-own-script" }] }],
        },
      }),
    );
    installClaudeBridge(["lifecycle"], { settingsPath, bridgeDir });
    const removed = uninstallClaudeBridge({ settingsPath, bridgeDir });
    expect(removed.ok).toBe(true);

    const after = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
      hooks?: Record<string, { hooks?: { command: string }[] }[]>;
    };
    const stop = after.hooks?.["Stop"] ?? [];
    const commands = stop.flatMap((g) => (g.hooks ?? []).map((h) => h.command));
    expect(commands).toEqual(["my-own-script"]);
  });

  test("uninstall on a clean file is a no-op that still succeeds", () => {
    const { settingsPath, bridgeDir } = fixture();
    const r = uninstallClaudeBridge({ settingsPath, bridgeDir });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Nothing managed");
  });
});

describe("shell integration", () => {
  test("install then uninstall round-trips the rc file", () => {
    const home = mkdtempSync(join(tmpdir(), "tau-rc-"));
    writeFileSync(join(home, ".zshrc"), "export FOO=1\n");

    expect(readShellIntegrationStatus({ shell: "zsh", home }).installed).toBe(
      false,
    );

    const added = setShellIntegration(true, { shell: "zsh", home });
    expect(added.ok).toBe(true);
    const status = readShellIntegrationStatus({ shell: "zsh", home });
    expect(status.installed).toBe(true);
    expect(status.rcPath).toBe(join(home, ".zshrc"));
    expect(readFileSync(status.rcPath, "utf-8")).toContain(BEGIN_MARK);

    const removed = setShellIntegration(false, { shell: "zsh", home });
    expect(removed.ok).toBe(true);
    expect(readShellIntegrationStatus({ shell: "zsh", home }).installed).toBe(
      false,
    );
    // The user's own line survives both edits.
    expect(readFileSync(join(home, ".zshrc"), "utf-8")).toContain(
      "export FOO=1",
    );
  });

  test("a missing rc file reports not-installed rather than throwing", () => {
    const home = mkdtempSync(join(tmpdir(), "tau-rc-empty-"));
    expect(readShellIntegrationStatus({ shell: "bash", home })).toMatchObject({
      shell: "bash",
      installed: false,
    });
  });
});

describe("sanitizeFeatures", () => {
  test("drops values that are not known features", () => {
    expect(sanitizeFeatures(["tasks", "nonsense", "statusline"])).toEqual([
      "tasks",
      "statusline",
    ]);
  });
});
