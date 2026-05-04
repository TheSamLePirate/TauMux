// Regression — the manifests section's cache signature used to omit
// per-card expansion state and per-script run/error state. Result: a
// click on the package.json or Cargo.toml header didn't deploy the
// card body until the user *also* clicked the outer "Manifests" panel
// header (which flipped `manifestsOpen` and forced a rebuild). Same
// staleness blocked running-script dot colours from updating live.
//
// This test pins the click-to-expand path: a single click on the
// package header must immediately render the body, with no second
// click required.

import {
  afterAll,
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

async function loadSidebar() {
  return await import("../src/views/terminal/sidebar");
}

interface WsSeed {
  id: string;
  scripts?: Record<string, string>;
  runningScripts?: string[];
  erroredScripts?: string[];
}

function ws(
  seed: WsSeed,
): import("../src/views/terminal/sidebar").WorkspaceInfo {
  return {
    id: seed.id,
    name: seed.id,
    color: "#89b4fa",
    active: true,
    surfaceTitles: ["zsh"],
    focusedSurfaceTitle: "zsh",
    focusedSurfaceCommand: null,
    statusPills: [],
    progress: null,
    listeningPorts: [],
    packageJson: {
      path: `/tmp/${seed.id}/package.json`,
      directory: `/tmp/${seed.id}`,
      name: `${seed.id}-pkg`,
      version: "1.0.0",
      scripts: seed.scripts ?? { build: "echo building", test: "echo testing" },
    },
    runningScripts: seed.runningScripts ?? [],
    erroredScripts: seed.erroredScripts ?? [],
    cargoToml: null,
    runningCargoActions: [],
    erroredCargoActions: [],
    cwds: [],
    selectedCwd: null,
    cpuPercent: 0,
    memRssKb: 0,
    processCount: 0,
    cpuHistory: [],
  };
}

async function makeSidebar() {
  document.body.innerHTML = `<div id="sidebar"></div>`;
  const container = document.getElementById("sidebar") as HTMLElement;
  const { Sidebar } = await loadSidebar();
  const sidebar = new Sidebar(container, {
    onSelectWorkspace: () => {},
    onNewWorkspace: () => {},
    onCloseWorkspace: () => {},
  });
  return { sidebar, container };
}

function cardForId(c: HTMLElement, id: string): HTMLElement | null {
  return c.querySelector(`[data-workspace-id="${id}"]`);
}

function packageHeader(card: HTMLElement): HTMLButtonElement | null {
  return card.querySelector(
    ".workspace-manifest-npm .workspace-package-header",
  );
}

function packageRoot(card: HTMLElement): HTMLElement | null {
  return card.querySelector(".workspace-manifest-npm");
}

describe("Sidebar — manifest card click-to-expand (regression)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("clicking the package.json header immediately deploys the body", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([ws({ id: "ws:1" })]);

    const card = cardForId(container, "ws:1")!;
    const header = packageHeader(card)!;
    const pkg = packageRoot(card)!;

    // Starts collapsed — no scripts list rendered.
    expect(pkg.classList.contains("expanded")).toBe(false);
    expect(pkg.querySelector(".workspace-package-scripts")).toBeNull();

    // ONE click should be enough.
    header.click();

    const pkgAfter = packageRoot(cardForId(container, "ws:1")!)!;
    expect(pkgAfter.classList.contains("expanded")).toBe(true);
    expect(pkgAfter.querySelector(".workspace-package-scripts")).not.toBeNull();
    expect(pkgAfter.getAttribute("aria-expanded") ?? "").toBe("");
    expect(
      pkgAfter
        .querySelector(".workspace-package-header")!
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  test("collapsing again on a second click also takes effect immediately", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([ws({ id: "ws:1" })]);

    const header1 = packageHeader(cardForId(container, "ws:1")!)!;
    header1.click(); // expand

    const header2 = packageHeader(cardForId(container, "ws:1")!)!;
    header2.click(); // collapse

    const pkgFinal = packageRoot(cardForId(container, "ws:1")!)!;
    expect(pkgFinal.classList.contains("expanded")).toBe(false);
    expect(pkgFinal.querySelector(".workspace-package-scripts")).toBeNull();
  });

  test("running-script state updates the dot without needing to reopen the panel", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([ws({ id: "ws:1" })]);

    // Expand once so the script rows are rendered.
    packageHeader(cardForId(container, "ws:1")!)!.click();

    const buildBefore = packageRoot(
      cardForId(container, "ws:1")!,
    )!.querySelector('[data-state="idle"]') as HTMLElement | null;
    expect(buildBefore).not.toBeNull();

    // Mark the `build` script as running. Same workspace identity, just
    // updated runtime state — pre-fix the cached manifests slot would
    // be reused and the orange dot would never appear.
    sidebar.setWorkspaces([ws({ id: "ws:1", runningScripts: ["build"] })]);

    const runningRow = packageRoot(
      cardForId(container, "ws:1")!,
    )!.querySelector('[data-state="running"]') as HTMLElement | null;
    expect(runningRow).not.toBeNull();
    expect(runningRow!.textContent).toContain("build");
  });
});
