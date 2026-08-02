/**
 * WS7 — settings.json surgery. The rules under test (plan §4.6):
 * additive merge, byte-stability of user content, idempotence,
 * refuse-on-parse-failure, clean uninstall, backups.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ClaudeSettings,
  DEFAULT_FEATURES,
  ALL_FEATURES,
  HOOK_SPECS,
  computeStatus,
  isManagedHookCommand,
  planInstall,
  planUninstall,
  readSettingsFile,
  writeSettingsFile,
} from "../src/cli/claude-settings-edit";

const BRIDGE = "/Users/x/.claude/scripts/ht-bridge";

/** A realistic user settings.json with pre-existing, unrelated config. */
const USER_SETTINGS: ClaudeSettings = {
  model: "opus",
  permissions: { allow: ["Bash(bun test:*)"] },
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [
          { type: "command", command: "bun /Users/x/superset-notify.ts" },
        ],
      },
    ],
    Stop: [
      {
        matcher: "",
        hooks: [{ type: "command", command: "afplay /System/finish.mp3" }],
      },
    ],
  },
  statusLine: undefined,
};

describe("planInstall", () => {
  test("adds all default-feature hooks + statusline, touching nothing else", () => {
    const r = planInstall(USER_SETTINGS, DEFAULT_FEATURES, BRIDGE);
    // approvals NOT in defaults
    expect(r.added.some((a) => a.includes("permission-request"))).toBe(false);
    expect(r.added).toContain("statusLine");
    // 14 hooks in lifecycle+tasks
    const expectedHookCount = HOOK_SPECS.filter(
      (h) => h.feature !== "approvals",
    ).length;
    expect(r.added.length).toBe(expectedHookCount + 1);
    // user content untouched
    expect(r.next["model"]).toBe("opus");
    expect(r.next["permissions"]).toEqual(USER_SETTINGS["permissions"]);
    const upsGroups = r.next.hooks!["UserPromptSubmit"]!;
    expect(upsGroups[0]!.hooks![0]!.command).toContain("superset-notify");
    // ours appended as a NEW group, not merged into the user's
    expect(upsGroups.length).toBe(2);
    // input not mutated
    expect(USER_SETTINGS.hooks!["UserPromptSubmit"]!.length).toBe(1);
  });

  test("is idempotent — second install adds nothing", () => {
    const once = planInstall(USER_SETTINGS, [...ALL_FEATURES], BRIDGE);
    const twice = planInstall(once.next, [...ALL_FEATURES], BRIDGE);
    expect(twice.added).toEqual([]);
    expect(JSON.stringify(twice.next)).toBe(JSON.stringify(once.next));
  });

  test("approvals feature wires PermissionRequest with the 600s timeout", () => {
    const r = planInstall({}, ["approvals"], BRIDGE);
    const g = r.next.hooks!["PermissionRequest"]![0]!;
    expect(g.hooks![0]!.command).toContain("permission-request");
    expect(g.hooks![0]!.timeout).toBe(600);
  });

  test("notification matchers are set on the group", () => {
    const r = planInstall({}, ["lifecycle"], BRIDGE);
    const groups = r.next.hooks!["Notification"]!;
    expect(groups.map((g) => g.matcher).sort()).toEqual([
      "idle_prompt",
      "permission_prompt",
    ]);
  });

  test("keeps a user-defined statusline instead of clobbering it", () => {
    const withUserLine: ClaudeSettings = {
      statusLine: { type: "command", command: "~/my-statusline.sh" },
    };
    const r = planInstall(withUserLine, ["statusline"], BRIDGE);
    expect(r.added).toEqual([]);
    expect(r.next.statusLine!.command).toBe("~/my-statusline.sh");
    expect(r.unchanged.some((u) => u.includes("kept yours"))).toBe(true);
  });
});

describe("planUninstall", () => {
  test("round-trip: install then uninstall restores the original", () => {
    const installed = planInstall(USER_SETTINGS, [...ALL_FEATURES], BRIDGE);
    const removed = planUninstall(installed.next);
    // Same JSON as the original (modulo key order kept by structuredClone)
    expect(JSON.parse(JSON.stringify(removed.next))).toEqual(
      JSON.parse(JSON.stringify(USER_SETTINGS)),
    );
    expect(removed.removed.length).toBeGreaterThan(0);
  });

  test("mixed group: removes only our entry, keeps the user's", () => {
    const mixed: ClaudeSettings = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "afplay x.mp3" },
              {
                type: "command",
                command: `bun ${BRIDGE}/src/index.ts stop`,
              },
            ],
          },
        ],
      },
    };
    const r = planUninstall(mixed);
    const stop = r.next.hooks!["Stop"]!;
    expect(stop).toHaveLength(1);
    expect(stop[0]!.hooks).toHaveLength(1);
    expect(stop[0]!.hooks![0]!.command).toBe("afplay x.mp3");
  });

  test("uninstall on a clean file is a no-op", () => {
    const r = planUninstall(USER_SETTINGS);
    expect(r.removed).toEqual([]);
  });
});

describe("computeStatus", () => {
  test("reports wired/missing/approvals/statusline", () => {
    const installed = planInstall({}, ["lifecycle", "statusline"], BRIDGE);
    const st = computeStatus(installed.next, "/s.json", "/nonexistent");
    expect(st.wiredEvents).toContain("prompt");
    expect(st.missingEvents).toContain("task-created");
    expect(st.missingEvents).toContain("permission-request");
    expect(st.approvalsWired).toBe(false);
    expect(st.statusline).toBe("ours");
    expect(st.bridgePresent).toBe(false);
  });
});

describe("fs shell", () => {
  test("read: missing file → {}, corrupt file → refuse with error", () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-install-"));
    expect(readSettingsFile(join(dir, "nope.json")).settings).toEqual({});
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json ");
    const r = readSettingsFile(bad);
    expect(r.settings).toBeNull();
    expect(r.error).toContain("cannot parse");
  });

  test("write: creates a timestamped backup and pretty JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-install-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ model: "opus" }));
    const backup = writeSettingsFile(p, { model: "opus", hooks: {} });
    expect(backup).toContain("settings.json.bak-");
    expect(readFileSync(backup!, "utf-8")).toBe(
      JSON.stringify({ model: "opus" }),
    );
    expect(readFileSync(p, "utf-8")).toBe(
      JSON.stringify({ model: "opus", hooks: {} }, null, 2) + "\n",
    );
    expect(readdirSync(dir).length).toBe(2);
  });

  test("first write (no existing file) has no backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-install-"));
    const p = join(dir, "settings.json");
    expect(writeSettingsFile(p, {})).toBeNull();
  });
});

describe("isManagedHookCommand", () => {
  test("matches bridge paths, not user commands", () => {
    expect(
      isManagedHookCommand(
        "bun /Users/x/.claude/scripts/ht-bridge/src/index.ts stop",
      ),
    ).toBe(true);
    expect(isManagedHookCommand("afplay finish.mp3")).toBe(false);
    expect(isManagedHookCommand("bun /Users/x/superset-notify.ts")).toBe(false);
  });
});
