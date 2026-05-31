// Flicker fix — the workspace-card status grid reconciles entry values in
// place instead of rebuilding the whole section on every `ht set-status`
// tick. These tests pin the DOM-identity contract that prevents the chart
// teardown that used to flicker (Plan: "less flickering on update").

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => await GlobalRegistrator.unregister());
afterEach(() => {
  document.body.innerHTML = "";
});

async function load() {
  return await import("../src/web-client/sidebar/workspace-card");
}

type Pill = { key: string; value: string; color?: string; icon?: string };

function ws(
  pills: Pill[],
): import("../src/shared/sidebar-state").WorkspaceInfo {
  return {
    id: "ws1",
    name: "Alpha",
    active: true,
    surfaceTitles: ["s1"],
    statusPills: pills,
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
    processCount: 1,
    cpuHistory: [],
  };
}

function grid(host: HTMLElement): HTMLElement {
  return host.querySelector(".workspace-status") as HTMLElement;
}
function entry(host: HTMLElement, key: string): HTMLElement {
  return grid(host).querySelector(`[data-key="${key}"]`) as HTMLElement;
}

describe("workspace-card status reconciliation", () => {
  test("a value change keeps unchanged sibling nodes (no teardown)", async () => {
    const { WorkspaceCardBuilder } = await load();
    const b = new WorkspaceCardBuilder({} as never);
    const host = document.createElement("div");

    b.render(
      [
        ws([
          { key: "lat_lineGraph", value: "1,2,3,4" },
          { key: "cpu_pct", value: "50" },
        ]),
      ],
      host,
    );
    const chart1 = entry(host, "lat_lineGraph");
    const pct1 = entry(host, "cpu_pct");
    expect(chart1).not.toBeNull();
    expect(pct1).not.toBeNull();

    // Only the chart's value changes.
    b.render(
      [
        ws([
          { key: "lat_lineGraph", value: "1,2,3,9" },
          { key: "cpu_pct", value: "50" },
        ]),
      ],
      host,
    );
    const chart2 = entry(host, "lat_lineGraph");
    const pct2 = entry(host, "cpu_pct");

    // Unchanged sibling: SAME node identity (never re-created).
    expect(pct2).toBe(pct1);
    // Changed entry: re-rendered with the new signature.
    expect(chart2).not.toBe(chart1);
    expect(chart2.dataset["sig"]).toContain("1,2,3,9");
  });

  test("identical re-render touches nothing", async () => {
    const { WorkspaceCardBuilder } = await load();
    const b = new WorkspaceCardBuilder({} as never);
    const host = document.createElement("div");
    const pills: Pill[] = [
      { key: "a_vbar", value: "1,2,3" },
      { key: "b_pct", value: "20" },
    ];
    b.render([ws(pills)], host);
    const a1 = entry(host, "a_vbar");
    const b1 = entry(host, "b_pct");
    b.render([ws(pills.map((p) => ({ ...p })))], host);
    expect(entry(host, "a_vbar")).toBe(a1);
    expect(entry(host, "b_pct")).toBe(b1);
  });

  test("adding / removing a key updates the set without rebuilding survivors", async () => {
    const { WorkspaceCardBuilder } = await load();
    const b = new WorkspaceCardBuilder({} as never);
    const host = document.createElement("div");
    b.render([ws([{ key: "keep_pct", value: "10" }])], host);
    const keep1 = entry(host, "keep_pct");

    b.render(
      [
        ws([
          { key: "keep_pct", value: "10" },
          { key: "new_gauge", value: "5|10|x" },
        ]),
      ],
      host,
    );
    expect(entry(host, "keep_pct")).toBe(keep1); // survivor identity
    expect(entry(host, "new_gauge")).not.toBeNull();

    b.render([ws([{ key: "keep_pct", value: "10" }])], host);
    expect(entry(host, "keep_pct")).toBe(keep1);
    expect(entry(host, "new_gauge")).toBeNull();
  });
});
