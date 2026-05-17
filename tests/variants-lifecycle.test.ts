// P7 S10 — variant mount/unmount lifecycle tests.
//
// The last named gap for `app-variants`: the Cockpit + Atlas variant
// handles claim "Both restore sidebar on exit" / "cleanly removed on
// exit" but had no behavioural regression test. A future refactor
// that forgets a listener teardown would leak silently.
//
// These tests exercise the enter/exit contract directly against the
// real handle objects, using a happy-dom seeded with the minimal
// chrome each variant expects (a body, a #sidebar, a #tau-status-bar
// mount point). The body's `dataset.tauVariant` is the clearest
// invariant — set on enter, removed on exit, no straggler classes.

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

async function loadVariants() {
  const cockpit = await import("../src/views/terminal/variants/cockpit");
  const atlas = await import("../src/views/terminal/variants/atlas");
  const ctxMod = await import("../src/views/terminal/variants/variant-context");
  const { DEFAULT_SETTINGS } = await import("../src/shared/settings");
  return {
    CockpitVariant: cockpit.CockpitVariant,
    AtlasVariant: atlas.AtlasVariant,
    variantContext: ctxMod.variantContext,
    DEFAULT_SETTINGS,
  };
}

function makeContext(): {
  body: HTMLBodyElement;
  statusBar: HTMLDivElement;
  settings: import("../src/shared/settings").AppSettings;
} {
  document.body.innerHTML = `
    <div id="sidebar"></div>
    <div id="tau-status-bar"></div>
    <div id="tau-workspaces"></div>
    <div id="terminal-container"></div>
  `;
  const statusBar = document.getElementById("tau-status-bar") as HTMLDivElement;
  return {
    body: document.body as HTMLBodyElement,
    statusBar,
    // settings is unused in cockpit/atlas enter — a placeholder is fine.
    settings: {} as unknown as import("../src/shared/settings").AppSettings,
  };
}

describe("Variant lifecycle — Cockpit (P7 S10)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(async () => {
    const { variantContext } = await loadVariants();
    variantContext.reset();
  });

  test("enter sets data-tau-variant and mounts the rail", async () => {
    const { CockpitVariant } = await loadVariants();
    const ctx = makeContext();
    CockpitVariant.enter(ctx);
    expect(ctx.body.dataset["tauVariant"]).toBe("cockpit");
    // Rail mounts under #sidebar with the documented class.
    const rail = document.querySelector(".tau-cockpit-rail");
    expect(rail).not.toBeNull();
  });

  test("exit removes data-tau-variant and the rail", async () => {
    const { CockpitVariant } = await loadVariants();
    const ctx = makeContext();
    CockpitVariant.enter(ctx);
    CockpitVariant.exit(ctx);
    expect(ctx.body.dataset["tauVariant"]).toBeUndefined();
    expect(document.querySelector(".tau-cockpit-rail")).toBeNull();
  });

  test("enter is idempotent — calling twice leaves exactly one rail", async () => {
    const { CockpitVariant } = await loadVariants();
    const ctx = makeContext();
    CockpitVariant.enter(ctx);
    CockpitVariant.enter(ctx);
    expect(document.querySelectorAll(".tau-cockpit-rail").length).toBe(1);
  });

  test("enter / exit round-trip leaves the body chrome clean", async () => {
    const { CockpitVariant } = await loadVariants();
    const ctx = makeContext();
    const sidebarBefore = document.getElementById("sidebar")!.innerHTML;
    CockpitVariant.enter(ctx);
    CockpitVariant.exit(ctx);
    // No tauVariant attribute residue.
    expect(ctx.body.dataset["tauVariant"]).toBeUndefined();
    // Sidebar's pre-existing children are intact (cockpit prepends; it
    // mustn't trample what was there).
    expect(document.getElementById("sidebar")!.innerHTML).toBe(sidebarBefore);
  });
});

describe("Variant lifecycle — Atlas (P7 S10)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(async () => {
    const { variantContext } = await loadVariants();
    variantContext.reset();
  });

  test("enter sets data-tau-variant", async () => {
    const { AtlasVariant } = await loadVariants();
    const ctx = makeContext();
    AtlasVariant.enter(ctx);
    expect(ctx.body.dataset["tauVariant"]).toBe("atlas");
  });

  test("enter mounts the workspace graph + tab rail under the sidebar", async () => {
    const { AtlasVariant } = await loadVariants();
    const ctx = makeContext();
    AtlasVariant.enter(ctx);
    // Graph + tab rail use stable ids documented in the module.
    expect(document.getElementById("tau-atlas-graph")).not.toBeNull();
    expect(document.getElementById("tau-atlas-tab-rail")).not.toBeNull();
  });

  test("exit removes data-tau-variant and the mounted chrome", async () => {
    const { AtlasVariant } = await loadVariants();
    const ctx = makeContext();
    AtlasVariant.enter(ctx);
    AtlasVariant.exit(ctx);
    expect(ctx.body.dataset["tauVariant"]).toBeUndefined();
    expect(document.getElementById("tau-atlas-graph")).toBeNull();
    expect(document.getElementById("tau-atlas-tab-rail")).toBeNull();
  });

  test("enter is idempotent — exactly one graph after two calls", async () => {
    const { AtlasVariant } = await loadVariants();
    const ctx = makeContext();
    AtlasVariant.enter(ctx);
    AtlasVariant.enter(ctx);
    expect(document.querySelectorAll("#tau-atlas-graph").length).toBe(1);
    expect(document.querySelectorAll("#tau-atlas-tab-rail").length).toBe(1);
  });

  test("Cockpit → Atlas switch (enter/exit handoff) ends with only Atlas chrome", async () => {
    const { CockpitVariant, AtlasVariant } = await loadVariants();
    const ctx = makeContext();
    CockpitVariant.enter(ctx);
    CockpitVariant.exit(ctx);
    AtlasVariant.enter(ctx);
    expect(ctx.body.dataset["tauVariant"]).toBe("atlas");
    expect(document.querySelector(".tau-cockpit-rail")).toBeNull();
    expect(document.getElementById("tau-atlas-graph")).not.toBeNull();
  });
});
