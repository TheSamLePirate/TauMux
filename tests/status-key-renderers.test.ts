// DOM behaviour tests for the smart status-key renderers. Confirms
// that each renderer produces the right shape AND that the dispatcher
// routes parsed keys correctly. Uses happy-dom for cheap DOM assertions
// so we don't need to spin up the full webview.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function loadDeps() {
  const [{ parseStatusKey }, { renderStatusEntry }] = await Promise.all([
    import("../src/shared/status-key"),
    import("../src/views/terminal/status-renderers"),
  ]);
  return { parseStatusKey, renderStatusEntry };
}

describe("renderStatusEntry — bar (inline) context", () => {
  test("bare key renders a label/value pill", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("status"),
      value: "building",
      context: "bar",
    });
    expect(el.classList.contains("tau-status-kv")).toBe(true);
    const label = el.querySelector(".tau-status-label");
    const value = el.querySelector(".tau-status-value");
    expect(label?.textContent).toBe("status");
    expect(value?.textContent).toBe("building");
  });

  test("longtext truncates in bar context", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const long = "a very long body that exceeds the inline truncation limit";
    const el = renderStatusEntry({
      parsed: parseStatusKey("note_longtext"),
      value: long,
      context: "bar",
    });
    const value = el.querySelector(".tau-status-value");
    expect(value?.textContent).toBeDefined();
    expect((value!.textContent ?? "").length).toBeLessThanOrEqual(40);
    expect((value!.textContent ?? "").endsWith("…")).toBe(true);
  });

  test("pct uses the Meter primitive", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("cpu_pct"),
      value: "73",
      context: "bar",
    });
    expect(el.classList.contains("tau-meter-wrap")).toBe(true);
    const fill = el.querySelector<HTMLElement>(".tau-meter-fill");
    expect(fill).not.toBeNull();
    // 73% should map to 73.0% width.
    expect(fill!.style.width).toBe("73.0%");
    // Meter inherits semantic from value-driven thresholds when no
    // explicit semantic suffix is present (50–80 → warn).
    expect(el.querySelector(".tau-meter-warn")).not.toBeNull();
  });

  test("explicit semantic overrides the value threshold", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("cpu_pct_ok"),
      value: "95",
      context: "bar",
    });
    // Even at 95% the explicit `_ok` keeps the meter green.
    expect(el.querySelector(".tau-meter-ok")).not.toBeNull();
  });

  test("link renders an anchor with safe target/rel", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("dash_link"),
      value: "Dashboard|https://example.com/dash",
      context: "bar",
    });
    const a = el.querySelector("a.tau-status-link") as HTMLAnchorElement | null;
    expect(a).not.toBeNull();
    expect(a!.textContent).toBe("Dashboard");
    expect(a!.target).toBe("_blank");
    expect(a!.rel).toContain("noopener");
    expect(a!.getAttribute("href")).toBe("https://example.com/dash");
  });

  test("link rejects non-http schemes (renders as plain text)", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("evil_link"),
      value: "javascript:alert(1)",
      context: "bar",
    });
    expect(el.querySelector("a")).toBeNull();
    const value = el.querySelector(".tau-status-value");
    expect(value?.textContent).toBe("javascript:alert(1)");
  });

  test("lineGraph (bar) renders an inline sparkline svg", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("cpu_hist_lineGraph"),
      value: "1,2,3,4,5,4,3,2",
      context: "bar",
    });
    // Block layout is suppressed in bar context — we expect inline kv +
    // a small sparkline.
    expect(el.classList.contains("tau-status-kv")).toBe(true);
    const svg = el.querySelector("svg.tau-sparkline");
    expect(svg).not.toBeNull();
    expect(svg!.querySelector("polyline")).not.toBeNull();
  });

  test("malformed body falls back to text without throwing", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("ratio_pct"),
      value: "not-a-number",
      context: "bar",
    });
    const value = el.querySelector(".tau-status-value");
    expect(value?.textContent).toBe("not-a-number");
  });

  test("explicit color resolves keyword tokens to CSS vars", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("status"),
      value: "building",
      color: "agent",
      context: "bar",
    });
    const value = el.querySelector<HTMLElement>(".tau-status-value");
    expect(value?.style.color).toBe("var(--tau-agent)");
  });
});

describe("renderStatusEntry — card (block) context", () => {
  test("array renders as a list of rows with state classes", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const body = JSON.stringify([
      ["P1: explore", "done"],
      ["P2: edit", "active"],
      ["P3: commit", "waiting"],
    ]);
    const el = renderStatusEntry({
      parsed: parseStatusKey("plan_array"),
      value: body,
      context: "card",
    });
    expect(el.classList.contains("tau-ht-array")).toBe(true);
    const rows = el.querySelectorAll(".tau-ht-array-row");
    expect(rows.length).toBe(3);
    const states = el.querySelectorAll(".tau-ht-array-state");
    expect(states[0].classList.contains("tau-ht-state-done")).toBe(true);
    expect(states[1].classList.contains("tau-ht-state-active")).toBe(true);
    expect(states[2].classList.contains("tau-ht-state-waiting")).toBe(true);
  });

  test("lineGraph (card) renders block layout with min/max meta", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("cpu_hist_lineGraph"),
      value: "1,5,3,9,2",
      context: "card",
    });
    expect(el.classList.contains("tau-ht-lineGraph")).toBe(true);
    expect(el.querySelector("svg.tau-sparkline")).not.toBeNull();
    const meta = el.querySelector(".tau-ht-block-meta");
    expect(meta?.textContent).toContain("min 1");
    expect(meta?.textContent).toContain("max 9");
    expect(meta?.textContent).toContain("last 2");
  });

  test("longtext (card) wraps in a block container", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("summary_longtext"),
      value: "build failed in src/foo.ts: TS2304: Cannot find name 'foo'.",
      context: "card",
    });
    expect(el.classList.contains("tau-ht-longtext")).toBe(true);
    const body = el.querySelector(".tau-ht-block-body");
    expect(body?.textContent).toContain("TS2304");
  });

  test("inline-only renderer falls through to inline in card context", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("cpu_pct"),
      value: "42",
      context: "card",
    });
    // pct is inline-layout — should still render as a Meter, not a block.
    expect(el.classList.contains("tau-meter-wrap")).toBe(true);
  });
});

describe("renderStatusEntry — semantic propagation", () => {
  test("non-meter renderers stamp data-semantic", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("build_text_warn"),
      value: "compiling",
      context: "bar",
    });
    expect(el.dataset["semantic"]).toBe("warn");
  });
});
