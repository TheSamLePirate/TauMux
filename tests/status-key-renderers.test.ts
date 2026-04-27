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

describe("renderStatusEntry — v2 numeric renderers", () => {
  test("bytes formats with KB/MB suffix", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("rss_bytes"),
      value: "1572864",
      context: "bar",
    });
    expect(el.querySelector(".tau-status-value")?.textContent).toBe("1.5 MB");
  });

  test("ms picks the right unit", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("latency_ms"),
      value: "4321",
      context: "bar",
    });
    expect(el.querySelector(".tau-status-value")?.textContent).toBe("4.32 s");
  });

  test("duration formats > 60s as min/sec", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("uptime_duration"),
      value: "125",
      context: "bar",
    });
    expect(el.querySelector(".tau-status-value")?.textContent).toBe("2m 5s");
  });

  test("currency uses unit-specific symbol", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("spend_currency"),
      value: "12.34|EUR",
      context: "bar",
    });
    expect(el.querySelector(".tau-status-value")?.textContent).toBe("€12.34");
  });

  test("rating renders filled and empty stars", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("nps_rating"),
      value: "3|5",
      context: "bar",
    });
    const filled = el.querySelectorAll(".tau-ht-rating-star.is-filled");
    const all = el.querySelectorAll(".tau-ht-rating-star");
    expect(all.length).toBe(5);
    expect(filled.length).toBe(3);
  });

  test("count formats with k/M suffix", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("downloads_count"),
      value: "12500",
      context: "bar",
    });
    expect(el.querySelector(".tau-status-value")?.textContent).toBe("12.5k");
  });

  test("code renders <code> element", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("err_code"),
      value: "TS2304",
      context: "bar",
    });
    expect(el.querySelector("code.tau-ht-code")?.textContent).toBe("TS2304");
  });
});

describe("renderStatusEntry — v2 state renderers", () => {
  test("bool toggles is-true / is-false classes", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const tEl = renderStatusEntry({
      parsed: parseStatusKey("dirty_bool"),
      value: "true",
      context: "bar",
    });
    expect(tEl.classList.contains("is-true")).toBe(true);
    const fEl = renderStatusEntry({
      parsed: parseStatusKey("dirty_bool"),
      value: "no",
      context: "bar",
    });
    expect(fEl.classList.contains("is-false")).toBe(true);
  });

  test("status renders state dot + state class", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("ci_status"),
      value: "ok:All passed",
      context: "bar",
    });
    expect(el.classList.contains("tau-ht-state-done")).toBe(true);
    expect(el.querySelector(".tau-ht-status-dot")).not.toBeNull();
    expect(el.querySelector(".tau-status-value")?.textContent).toBe(
      "ok: All passed",
    );
  });

  test("dot renders state-class styled bullet", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("agent_dot"),
      value: "running",
      context: "bar",
    });
    expect(el.classList.contains("tau-ht-state-active")).toBe(true);
    expect(el.querySelector(".tau-ht-dot")).not.toBeNull();
  });

  test("badge renders chip with optional icon", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("ver_badge"),
      value: "v0.2.4",
      icon: "⚙",
      context: "bar",
    });
    expect(el.querySelector(".tau-ht-badge-text")?.textContent).toBe("v0.2.4");
    expect(el.querySelector(".tau-ht-badge-icon")?.textContent).toBe("⚙");
  });
});

describe("renderStatusEntry — v2 chart renderers", () => {
  test("bar uses Meter primitive with custom max", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("disk_bar"),
      value: "30|60|GB",
      context: "bar",
    });
    expect(el.classList.contains("tau-meter-wrap")).toBe(true);
    const fill = el.querySelector<HTMLElement>(".tau-meter-fill");
    expect(fill!.style.width).toBe("50.0%");
  });

  test("vbar emits one rect per sample", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("hits_vbar"),
      value: "1,3,2,5,8,3",
      context: "bar",
    });
    const rects = el.querySelectorAll("svg.tau-vbar rect");
    expect(rects.length).toBe(6);
  });

  test("gauge emits two paths (track + value)", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("battery_gauge"),
      value: "73",
      context: "card",
    });
    expect(el.classList.contains("tau-ht-gauge")).toBe(true);
    const paths = el.querySelectorAll("svg.tau-gauge path");
    expect(paths.length).toBe(2);
  });

  test("heatmap emits one rect per cell with rgb fill", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("activity_heatmap"),
      value: "0.1,0.5,0.9,0.2",
      context: "bar",
    });
    const rects = el.querySelectorAll("svg.tau-heatmap rect");
    expect(rects.length).toBe(4);
    expect(rects[0].getAttribute("fill")).toMatch(/^rgb\(/);
  });

  test("dotGraph buckets dots into on/mid/low/off", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("commits_dotGraph"),
      value: "0,0.2,0.5,0.9",
      context: "bar",
    });
    const dots = el.querySelectorAll(".tau-ht-dotgraph-dot");
    expect(dots.length).toBe(4);
    expect(dots[0].classList.contains("is-off")).toBe(true);
    expect(dots[3].classList.contains("is-on")).toBe(true);
  });

  test("pie renders one path per slice + legend in card", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("traffic_pie"),
      value: "search:60,direct:25,referral:15",
      context: "card",
    });
    expect(el.classList.contains("tau-ht-pie")).toBe(true);
    const paths = el.querySelectorAll("svg.tau-pie path");
    expect(paths.length).toBe(3);
    const legend = el.querySelectorAll(".tau-ht-pie-legend-item");
    expect(legend.length).toBe(3);
  });

  test("donut svg gets is-donut modifier class", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("share_donut"),
      value: "a:1,b:2",
      context: "card",
    });
    const svg = el.querySelector("svg.tau-pie");
    expect(svg?.classList.contains("is-donut")).toBe(true);
  });

  test("area sparkline renders polygon + polyline", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("traffic_area"),
      value: "1,5,3,9,2",
      context: "card",
    });
    const svg = el.querySelector("svg.tau-sparkline")!;
    expect(svg.querySelector("polygon")).not.toBeNull();
    expect(svg.querySelector("polyline")).not.toBeNull();
  });
});

describe("renderStatusEntry — v2 data renderers", () => {
  test("kv block renders one key/value row per pair", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("git_kv"),
      value: JSON.stringify({ branch: "main", ahead: 3 }),
      context: "card",
    });
    expect(el.classList.contains("tau-ht-kv")).toBe(true);
    const dts = el.querySelectorAll(".tau-ht-kv-key");
    const dds = el.querySelectorAll(".tau-ht-kv-value");
    expect(dts.length).toBe(2);
    expect(dds.length).toBe(2);
    expect(dts[0].textContent).toBe("branch");
    expect(dds[1].textContent).toBe("3");
  });

  test("json block pretty-prints with 2-space indent", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("payload_json"),
      value: '{"a":1}',
      context: "card",
    });
    const pre = el.querySelector(".tau-ht-json-body");
    expect(pre?.textContent).toContain('  "a": 1');
  });

  test("list block renders bullet items", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("todo_list"),
      value: "alpha, beta, gamma",
      context: "card",
    });
    const items = el.querySelectorAll(".tau-ht-list-item");
    expect(items.length).toBe(3);
    expect(items[2].textContent).toBe("gamma");
  });

  test("tags inline renders chips with overflow indicator", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const long = Array.from({ length: 15 }, (_, i) => `t${i}`).join(",");
    const el = renderStatusEntry({
      parsed: parseStatusKey("topics_tags"),
      value: long,
      context: "bar",
    });
    const tags = el.querySelectorAll(".tau-ht-tag");
    expect(tags.length).toBe(13);
    expect(el.querySelector(".tau-ht-tag-more")?.textContent).toBe("+3");
  });
});

describe("renderStatusEntry — v2 rich renderers", () => {
  test("image renders <img> with safe attrs", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("avatar_image"),
      value: "alt|https://example.com/x.png",
      context: "bar",
    });
    const img = el.querySelector<HTMLImageElement>("img.tau-ht-image-inline");
    expect(img).not.toBeNull();
    expect(img!.alt).toBe("alt");
    expect(img!.referrerPolicy).toBe("no-referrer");
  });

  test("color renders swatch + hex code", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("brand_color"),
      value: "#6fe9ff",
      context: "bar",
    });
    const sw = el.querySelector<HTMLElement>(".tau-ht-color-swatch");
    expect(sw).not.toBeNull();
    // happy-dom keeps the literal value; jsdom would normalise to rgb().
    expect(sw!.style.background.toLowerCase()).toContain("6fe9ff");
    expect(el.querySelector(".tau-ht-color-hex")?.textContent).toBe("#6fe9ff");
  });

  test("kbd renders one <kbd> per key with separators", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("save_kbd"),
      value: "Cmd+Shift+S",
      context: "bar",
    });
    const kbds = el.querySelectorAll("kbd.tau-ht-kbd");
    expect(kbds.length).toBe(3);
    expect(el.querySelectorAll(".tau-ht-kbd-sep").length).toBe(2);
  });

  test("file shows basename, full path on title", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("focus_file"),
      value: "/Users/o/repo/src/main.ts",
      context: "bar",
    });
    expect(el.title).toBe("/Users/o/repo/src/main.ts");
    expect(el.querySelector(".tau-ht-file-name")?.textContent).toBe("main.ts");
  });

  test("md block renders bold/italic/code/link", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("note_md"),
      value: "**bold** *em* `code` [link](https://x.com/y)",
      context: "card",
    });
    expect(el.querySelector("strong.tau-ht-md-bold")?.textContent).toBe("bold");
    expect(el.querySelector("em.tau-ht-md-italic")?.textContent).toBe("em");
    expect(el.querySelector("code.tau-ht-md-code")?.textContent).toBe("code");
    const a = el.querySelector<HTMLAnchorElement>("a.tau-status-link");
    expect(a).not.toBeNull();
    expect(a!.getAttribute("href")).toBe("https://x.com/y");
  });
});

describe("renderStatusEntry — chain composability", () => {
  test("ms_pct chain picks ms as primary (leftmost in chain)", async () => {
    const { parseStatusKey, renderStatusEntry } = await loadDeps();
    const el = renderStatusEntry({
      parsed: parseStatusKey("latency_ms_pct"),
      value: "4321",
      context: "bar",
    });
    // ms wins → text formatter
    expect(el.querySelector(".tau-status-value")?.textContent).toBe("4.32 s");
  });

  test("hidden _key marks data-hidden through parser", async () => {
    const { parseStatusKey } = await loadDeps();
    const parsed = parseStatusKey("_internal_pct");
    expect(parsed.hidden).toBe(true);
    expect(parsed.displayName).toBe("internal");
  });
});
