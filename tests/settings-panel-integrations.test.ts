/**
 * Settings → Integrations, webview side.
 *
 * The section's job is to state the truth about files it does not own
 * and to route each action to the same operation the `ht` verb performs.
 * These tests pin: the placeholder before the first status push (never
 * claim "not installed" when we simply haven't looked), per-feature
 * state text, the selection → install payload, the shell install/remove
 * flip, and the extension enable toggle.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { IntegrationsStatus } from "../src/shared/integrations";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

interface Recorded {
  installClaude: string[][];
  uninstallClaude: number;
  shell: boolean[];
  extensions: { id: string; enabled: boolean }[];
  refresh: number;
}

async function openIntegrations(
  opts: {
    status?: IntegrationsStatus | null;
    extensions?: {
      id: string;
      name: string;
      path: string;
      enabled?: boolean;
    }[];
  } = {},
): Promise<{ rec: Recorded; content: HTMLElement }> {
  document.body.innerHTML = "";
  const { SettingsPanel } =
    await import("../src/views/terminal/settings-panel");
  const { DEFAULT_SETTINGS } = await import("../src/shared/settings");

  const rec: Recorded = {
    installClaude: [],
    uninstallClaude: 0,
    shell: [],
    extensions: [],
    refresh: 0,
  };
  const panel = new SettingsPanel(() => {}, {
    integrations: {
      refresh: () => {
        rec.refresh++;
      },
      installClaude: (features) => rec.installClaude.push([...features]),
      uninstallClaude: () => {
        rec.uninstallClaude++;
      },
      setShellIntegration: (install) => rec.shell.push(install),
      setExtensionEnabled: (id, enabled) =>
        rec.extensions.push({ id, enabled }),
    },
  });
  panel.show({ ...DEFAULT_SETTINGS });
  if (opts.status) panel.setIntegrations(opts.status);
  if (opts.extensions) panel.setExtensions(opts.extensions);

  const navBtn = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".settings-nav-item"),
  ).find((b) => b.textContent?.includes("Integrations"));
  if (!navBtn) throw new Error("Integrations nav button missing");
  navBtn.click();

  const content = document.querySelector<HTMLElement>(".settings-content");
  if (!content) throw new Error("settings content missing");
  return { rec, content };
}

function status(
  overrides: Partial<IntegrationsStatus> = {},
): IntegrationsStatus {
  return {
    claude: {
      settingsPath: "/home/u/.claude/settings.json",
      settingsError: null,
      bridgeDir: "/home/u/.claude/scripts/ht-bridge",
      bridgePresent: true,
      features: [
        { feature: "lifecycle", state: "installed", wired: 14, total: 14 },
        { feature: "tasks", state: "partial", wired: 1, total: 2 },
        { feature: "approvals", state: "missing", wired: 0, total: 1 },
        { feature: "statusline", state: "installed", wired: 1, total: 1 },
      ],
      wiredEvents: ["prompt", "stop"],
      missingEvents: ["permission-request"],
      statusline: "ours",
    },
    shell: { shell: "zsh", rcPath: "/home/u/.zshrc", installed: false },
    ...overrides,
  };
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(
    root.querySelectorAll<HTMLButtonElement>("button"),
  ).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`button not found: ${text}`);
  return btn;
}

describe("Settings → Integrations", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("says it is still reading before the first status push", async () => {
    const { content } = await openIntegrations({ status: null });
    expect(content.textContent).toContain("Reading ~/.claude/settings.json");
    // Crucially it does NOT assert an install state it hasn't checked.
    expect(content.textContent).not.toContain("not installed");
  });

  test("opening the panel asks bun for a fresh status", async () => {
    const { rec } = await openIntegrations({ status: status() });
    expect(rec.refresh).toBeGreaterThan(0);
  });

  test("renders per-feature state, distinguishing partial from installed", async () => {
    const { content } = await openIntegrations({ status: status() });
    const states = Array.from(
      content.querySelectorAll<HTMLElement>(".integration-state"),
    ).map((el) => el.textContent);
    expect(states).toContain("installed (14)");
    expect(states).toContain("partial (1/2)");
    expect(states).toContain("not installed");
  });

  test("seeds the tick boxes from what is already wired", async () => {
    const { content } = await openIntegrations({ status: status() });
    const checked = Array.from(
      content.querySelectorAll<HTMLInputElement>(
        '.settings-toggle input[type="checkbox"]',
      ),
    )
      .filter((i) => i.checked)
      .map((i) => i.getAttribute("aria-label"));
    // lifecycle + statusline are installed, tasks is partial (also
    // pre-ticked so "Install selected" repairs it); approvals is not.
    expect(checked).toContain("Install Lifecycle hooks");
    expect(checked).toContain("Install Status line");
    expect(checked).not.toContain("Install Permission approvals");
  });

  test("Install selected submits exactly the ticked features", async () => {
    const { content, rec } = await openIntegrations({ status: status() });
    const approvals = content.querySelector<HTMLInputElement>(
      'input[aria-label="Install Permission approvals"]',
    )!;
    approvals.checked = true;
    approvals.dispatchEvent(new Event("change"));

    buttonByText(content, "Install selected").click();
    expect(rec.installClaude).toHaveLength(1);
    expect(rec.installClaude[0]!.sort()).toEqual([
      "approvals",
      "lifecycle",
      "statusline",
      "tasks",
    ]);
  });

  test("a settings file that will not parse blocks Install and says why", async () => {
    const broken = status();
    broken.claude.settingsError = "cannot parse /home/u/.claude/settings.json";
    const { content, rec } = await openIntegrations({ status: broken });

    const install = buttonByText(content, "Install selected");
    expect(install.disabled).toBe(true);
    install.click();
    expect(rec.installClaude).toHaveLength(0);
    expect(content.textContent).toContain("cannot parse");
  });

  test("a missing bridge checkout blocks Install with a repair hint", async () => {
    const noBridge = status();
    noBridge.claude.bridgePresent = false;
    const { content } = await openIntegrations({ status: noBridge });
    expect(buttonByText(content, "Install selected").disabled).toBe(true);
    expect(content.textContent).toContain("install.sh");
  });

  test("Remove all routes to the uninstall action", async () => {
    const { content, rec } = await openIntegrations({ status: status() });
    buttonByText(content, "Remove all").click();
    expect(rec.uninstallClaude).toBe(1);
  });

  test("the last action's message is reported back to the user", async () => {
    const withAction = status();
    withAction.lastAction = {
      kind: "claude-install",
      ok: true,
      message: "Wired 3 entries.",
    };
    const { content } = await openIntegrations({ status: withAction });
    expect(content.textContent).toContain("Wired 3 entries.");
  });

  test("shell integration offers Install when absent, Remove when present", async () => {
    const { content, rec } = await openIntegrations({ status: status() });
    expect(content.textContent).toContain("/home/u/.zshrc");
    buttonByText(content, "Install").click();
    expect(rec.shell).toEqual([true]);

    const installed = status({
      shell: { shell: "zsh", rcPath: "/home/u/.zshrc", installed: true },
    });
    const second = await openIntegrations({ status: installed });
    buttonByText(second.content, "Remove").click();
    expect(second.rec.shell).toEqual([false]);
  });

  test("extension toggle reports the new state for that id", async () => {
    const { content, rec } = await openIntegrations({
      status: status(),
      extensions: [
        { id: "nebula", name: "Nebula", path: "/x/nebula", enabled: true },
        { id: "http", name: "HTTP Client", path: "/x/http", enabled: false },
      ],
    });
    const toggle = content.querySelector<HTMLInputElement>(
      'input[aria-label="Enable extension Nebula"]',
    )!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(rec.extensions).toEqual([{ id: "nebula", enabled: false }]);

    const disabled = Array.from(
      content.querySelectorAll<HTMLElement>(".integration-state"),
    ).map((el) => el.textContent);
    expect(disabled).toContain("disabled");
  });

  test("no extensions installed renders guidance, not an empty block", async () => {
    const { content } = await openIntegrations({
      status: status(),
      extensions: [],
    });
    expect(content.textContent).toContain("No extensions installed");
  });
});
