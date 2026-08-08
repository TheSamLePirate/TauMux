/**
 * Webview integration control — the single writer for
 * `claudeAutoApprove`, shared by the sidebar pill, the command palette
 * and Settings.
 *
 * The reason it is one module: three call sites that each did their own
 * `mergeSettings` + `rpc.send` is three chances to drift, and the state
 * they disagree about is "may an agent approve its own commands".
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AppSettings } from "../src/shared/settings";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function harness(initial: Partial<AppSettings> = {}) {
  const { DEFAULT_SETTINGS } = await import("../src/shared/settings");
  const mod = await import("../src/views/terminal/integrations-control");
  const sent: { message: string; payload: unknown }[] = [];
  const applied: AppSettings[] = [];
  let settings: AppSettings = { ...DEFAULT_SETTINGS, ...initial };
  const ctx = {
    send: (message: string, payload?: unknown) =>
      sent.push({ message, payload }),
    getSettings: () => settings,
    apply: (s: AppSettings) => {
      settings = s;
      applied.push(s);
    },
  };
  return { ...mod, ctx, sent, applied, current: () => settings };
}

describe("setAutoApprove", () => {
  test("applies locally and persists through updateSettings", async () => {
    const h = await harness({ claudeAutoApprove: false });
    h.setAutoApprove(h.ctx, true);

    expect(h.current().claudeAutoApprove).toBe(true);
    expect(h.sent).toEqual([
      {
        message: "updateSettings",
        payload: { settings: { claudeAutoApprove: true } },
      },
    ]);
  });

  test("is a no-op when the state already matches", async () => {
    // Matters because the pill, the palette and Settings can all fire
    // for the same user intent; a redundant write would echo back and
    // repaint the panel mid-interaction.
    const h = await harness({ claudeAutoApprove: true });
    h.setAutoApprove(h.ctx, true);
    expect(h.sent).toHaveLength(0);
    expect(h.applied).toHaveLength(0);
  });
});

describe("autoApproveCommand", () => {
  test("labels itself by the live state and flips it", async () => {
    const h = await harness({ claudeAutoApprove: false });
    const off = h.autoApproveCommand(h.ctx);
    expect(off.label).toContain("Enable");
    off.action();
    expect(h.current().claudeAutoApprove).toBe(true);

    const on = h.autoApproveCommand(h.ctx);
    expect(on.label).toContain("Disable");
    on.action();
    expect(h.current().claudeAutoApprove).toBe(false);
  });
});

describe("createIntegrationsControl", () => {
  test("the sidebar pill event reaches the settings write", async () => {
    const h = await harness({ claudeAutoApprove: false });
    h.createIntegrationsControl(h.ctx);
    const { htEvents } = await import("../src/shared/event-bus");

    htEvents.emit("ht-set-auto-approve", { enabled: true });

    expect(h.current().claudeAutoApprove).toBe(true);
    expect(h.sent.at(-1)).toEqual({
      message: "updateSettings",
      payload: { settings: { claudeAutoApprove: true } },
    });
  });

  test("each action maps to the matching bun message", async () => {
    const h = await harness();
    const { actions } = h.createIntegrationsControl(h.ctx);
    actions.refresh();
    actions.installClaude(["tasks", "statusline"]);
    actions.uninstallClaude();
    actions.setShellIntegration(true);
    actions.setExtensionEnabled("nebula", false);

    expect(h.sent).toEqual([
      { message: "requestIntegrationsStatus", payload: {} },
      {
        message: "claudeIntegrationInstall",
        payload: { features: ["tasks", "statusline"] },
      },
      { message: "claudeIntegrationUninstall", payload: {} },
      { message: "shellIntegrationSet", payload: { install: true } },
      {
        message: "extensionSetEnabled",
        payload: { id: "nebula", enabled: false },
      },
    ]);
  });
});
