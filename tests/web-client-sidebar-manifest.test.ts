import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import type { WorkspaceInfo } from "../src/shared/sidebar-state";
import { buildManifestsSection } from "../src/web-client/sidebar/card-manifests";
import {
  __resetForTests,
  setWorkspaceManifestExpanded,
} from "../src/web-client/sidebar/local-ui-state";

function makeWorkspaceInfo(
  overrides: Partial<WorkspaceInfo> = {},
): WorkspaceInfo {
  return {
    id: "ws1",
    name: "ws1",
    color: "#89b4fa",
    active: true,
    surfaceTitles: [],
    focusedSurfaceTitle: null,
    focusedSurfaceCommand: null,
    statusPills: [],
    progress: null,
    listeningPorts: [],
    packageJson: null,
    runningScripts: [],
    erroredScripts: [],
    cargoToml: null,
    runningCargoActions: [],
    erroredCargoActions: [],
    cwds: [],
    selectedCwd: null,
    cpuPercent: 0,
    memRssKb: 0,
    processCount: 0,
    cpuHistory: [],
    ...overrides,
  };
}

describe("web-client sidebar manifest cards", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  afterEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  test("absent manifest renders an empty marker (no package card)", () => {
    const ws = makeWorkspaceInfo();
    const el = buildManifestsSection(ws, { requestRerender: () => {} });
    expect(el.classList.contains("empty")).toBe(true);
    expect(el.querySelector(".workspace-package")).toBeNull();
  });

  test("npm package.json renders with header + name + version chip", () => {
    const ws = makeWorkspaceInfo({
      packageJson: {
        path: "/proj/package.json",
        directory: "/proj",
        name: "demo-app",
        version: "1.2.3",
        type: "module",
        scripts: { build: "tsc", test: "bun test" },
      },
    });
    const el = buildManifestsSection(ws, { requestRerender: () => {} });
    const card = el.querySelector(".workspace-package");
    expect(card).not.toBeNull();
    expect(card?.classList.contains("workspace-manifest-npm")).toBe(true);
    expect(card?.querySelector(".workspace-package-name")?.textContent).toBe(
      "demo-app",
    );
    expect(card?.querySelector(".workspace-package-version")?.textContent).toBe(
      "v1.2.3",
    );
    expect(card?.querySelector(".workspace-package-type")?.textContent).toBe(
      "module",
    );
  });

  test("expanded npm card lists every script as a button, dot reflects state", () => {
    const ws = makeWorkspaceInfo({
      packageJson: {
        path: "/proj/package.json",
        directory: "/proj",
        name: "demo",
        scripts: { build: "tsc", test: "bun test" },
      },
      runningScripts: ["build"],
      erroredScripts: ["test"],
    });
    setWorkspaceManifestExpanded("ws1:npm", true);
    const el = buildManifestsSection(ws, { requestRerender: () => {} });
    const buttons = el.querySelectorAll(".workspace-script-btn");
    expect(buttons.length).toBe(2);
    const buildBtn = el.querySelector(
      '.workspace-script-btn[data-state="running"]',
    );
    expect(buildBtn?.querySelector(".workspace-script-name")?.textContent).toBe(
      "build",
    );
    expect(
      buildBtn?.querySelector(".workspace-script-dot.running"),
    ).not.toBeNull();
    const testBtn = el.querySelector(
      '.workspace-script-btn[data-state="error"]',
    );
    expect(
      testBtn?.querySelector(".workspace-script-dot.error"),
    ).not.toBeNull();
  });

  test("npm bin field renders as bin chips when expanded", () => {
    const ws = makeWorkspaceInfo({
      packageJson: {
        path: "/proj/package.json",
        directory: "/proj",
        name: "demo",
        bin: { "demo-cli": "./dist/cli.js", "demo-server": "./dist/srv.js" },
      },
    });
    setWorkspaceManifestExpanded("ws1:npm", true);
    const el = buildManifestsSection(ws, { requestRerender: () => {} });
    const chips = el.querySelectorAll(".workspace-package-bin-chip");
    expect(chips.length).toBe(2);
    expect(chips[0]?.textContent).toBe("demo-cli");
    expect(chips[1]?.textContent).toBe("demo-server");
  });

  test("toggle persists to localStorage and triggers requestRerender", () => {
    const ws = makeWorkspaceInfo({
      packageJson: {
        path: "/proj/package.json",
        directory: "/proj",
        name: "demo",
      },
    });
    let rerenders = 0;
    const el = buildManifestsSection(ws, {
      requestRerender: () => {
        rerenders++;
      },
    });
    const header = el.querySelector(
      ".workspace-package-header",
    ) as HTMLButtonElement;
    expect(header).not.toBeNull();
    header.dispatchEvent(new Event("click", { bubbles: true }));
    expect(rerenders).toBe(1);
    // Manifest now persists as expanded under the canonical key.
    const stored = JSON.parse(
      localStorage.getItem("tau-mux.sidebar.ui-state") ?? "{}",
    );
    expect(stored.manifestsExpanded?.["ws1:npm"]).toBe(true);
  });

  test("script-row click dispatches ht-run-script with command + scriptKey", () => {
    const ws = makeWorkspaceInfo({
      packageJson: {
        path: "/proj/package.json",
        directory: "/proj",
        name: "demo",
        scripts: { build: "tsc -p ." },
      },
    });
    setWorkspaceManifestExpanded("ws1:npm", true);
    const el = buildManifestsSection(ws, { requestRerender: () => {} });
    document.body.appendChild(el);
    const seen: Array<Record<string, unknown>> = [];
    const listener = (e: Event) => {
      seen.push((e as CustomEvent).detail as Record<string, unknown>);
    };
    window.addEventListener("ht-run-script", listener);
    try {
      const btn = el.querySelector(".workspace-script-btn") as HTMLElement;
      btn.dispatchEvent(new Event("click", { bubbles: true }));
      expect(seen.length).toBe(1);
      expect(seen[0]).toMatchObject({
        workspaceId: "ws1",
        cwd: "/proj",
        scriptKey: "ws1:build",
        command: "tsc -p .",
      });
    } finally {
      window.removeEventListener("ht-run-script", listener);
      el.remove();
    }
  });

  test("cargo manifest renders with default subcommands when collapsed", () => {
    const ws = makeWorkspaceInfo({
      cargoToml: {
        path: "/proj/Cargo.toml",
        directory: "/proj",
        name: "demo-rs",
        version: "0.1.0",
        edition: "2021",
        binaries: ["demo"],
        features: [],
        isWorkspace: false,
      },
    });
    const el = buildManifestsSection(ws, { requestRerender: () => {} });
    const card = el.querySelector(".workspace-manifest-cargo");
    expect(card).not.toBeNull();
    // Collapsed by default — no script buttons rendered.
    expect(card?.querySelectorAll(".workspace-script-btn").length).toBe(0);
    expect(card?.querySelector(".workspace-package-type")?.textContent).toBe(
      "edition 2021",
    );
  });
});
