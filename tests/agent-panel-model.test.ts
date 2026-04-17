import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Scoped DOM — see tests/agent-panel-messages.test.ts for rationale.
beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import {
  type AgentModelSummary,
  applyModelLabel,
  applyThinkingLevel,
  buildModelBadges,
  scopedModelKey,
  THINKING_COLORS,
  THINKING_LEVELS,
  toModelSummary,
} from "../src/views/terminal/agent-panel-model";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("toModelSummary", () => {
  test("fills defaults for missing fields", () => {
    const m = toModelSummary({});
    expect(m.provider).toBe("");
    expect(m.id).toBe("");
    expect(m.name).toBe("");
    expect(m.reasoning).toBeUndefined();
    expect(m.input).toBeUndefined();
  });

  test("name falls back to id when omitted", () => {
    const m = toModelSummary({ provider: "anthropic", id: "opus-4" });
    expect(m.name).toBe("opus-4");
  });

  test("preserves explicit name over id", () => {
    const m = toModelSummary({
      provider: "anthropic",
      id: "opus-4",
      name: "Opus 4",
    });
    expect(m.name).toBe("Opus 4");
  });

  test("rejects non-array input field (leaves undefined)", () => {
    const m = toModelSummary({ input: "image" });
    expect(m.input).toBeUndefined();
  });

  test("passes array input through unchanged", () => {
    const m = toModelSummary({ input: ["text", "image"] });
    expect(m.input).toEqual(["text", "image"]);
  });
});

describe("scopedModelKey", () => {
  test("joins provider and id with a slash", () => {
    expect(scopedModelKey({ provider: "openai", id: "gpt-5" })).toBe(
      "openai/gpt-5",
    );
  });

  test("pair is stable across name changes — same provider/id yields same key", () => {
    const a = scopedModelKey({ provider: "p", id: "x" });
    const b = scopedModelKey({ provider: "p", id: "x" });
    expect(a).toBe(b);
  });
});

describe("buildModelBadges", () => {
  function mkModel(
    overrides: Partial<AgentModelSummary> = {},
  ): AgentModelSummary {
    return {
      provider: "anthropic",
      id: "opus-4",
      name: "Opus 4",
      ...overrides,
    };
  }

  test("always includes a provider badge", () => {
    const badges = buildModelBadges(mkModel());
    expect(badges[0].textContent).toBe("anthropic");
    expect(badges[0].classList.contains("agent-model-badge-provider")).toBe(
      true,
    );
  });

  test("emits reasoning + vision badges only when flags match", () => {
    const texts = buildModelBadges(
      mkModel({ reasoning: true, input: ["text", "image"] }),
    ).map((b) => b.textContent);
    expect(texts).toContain("reasoning");
    expect(texts).toContain("vision");
  });

  test("vision badge suppressed when input lacks image", () => {
    const texts = buildModelBadges(mkModel({ input: ["text"] })).map(
      (b) => b.textContent,
    );
    expect(texts).not.toContain("vision");
  });

  test("formats contextWindow and maxTokens through fmtK", () => {
    const texts = buildModelBadges(
      mkModel({ contextWindow: 200_000, maxTokens: 32_000 }),
    ).map((b) => b.textContent);
    expect(texts).toContain("200.0k ctx");
    expect(texts).toContain("32.0k out");
  });

  test("cost badge only appears when both input and output prices present", () => {
    const partial = buildModelBadges(mkModel({ cost: { input: 3 } })).map(
      (b) => b.textContent,
    );
    expect(partial.some((t) => t?.startsWith("$"))).toBe(false);

    const full = buildModelBadges(
      mkModel({ cost: { input: 3, output: 15 } }),
    ).map((b) => b.textContent);
    expect(full).toContain("$3/$15");
  });
});

describe("applyThinkingLevel", () => {
  function mkEls() {
    const toolbarEl = document.createElement("div");
    // Structure the helper's querySelector expects.
    toolbarEl.innerHTML = `<div class="agent-tb-thinking"><span class="agent-tb-dot"></span></div>`;
    const thinkingBtnLabel = document.createElement("span");
    return { toolbarEl, thinkingBtnLabel };
  }

  test("writes level to button label and matching dot color", () => {
    const els = mkEls();
    applyThinkingLevel(els, "high");
    expect(els.thinkingBtnLabel.textContent).toBe("high");
    const dot = els.toolbarEl.querySelector(".agent-tb-dot") as HTMLElement;
    expect(dot.style.background).toBe(THINKING_COLORS["high"]);
  });

  test("unknown level falls back to var(--text-dim)", () => {
    const els = mkEls();
    applyThinkingLevel(els, "nonsense");
    const dot = els.toolbarEl.querySelector(".agent-tb-dot") as HTMLElement;
    expect(dot.style.background).toBe("var(--text-dim)");
  });

  test("all THINKING_LEVELS have a registered color", () => {
    for (const lvl of THINKING_LEVELS) {
      expect(THINKING_COLORS[lvl]).toBeDefined();
    }
  });

  test("tolerates missing dot element (does not throw)", () => {
    const toolbarEl = document.createElement("div");
    const thinkingBtnLabel = document.createElement("span");
    expect(() =>
      applyThinkingLevel({ toolbarEl, thinkingBtnLabel }, "medium"),
    ).not.toThrow();
    expect(thinkingBtnLabel.textContent).toBe("medium");
  });
});

describe("applyModelLabel", () => {
  test("uses name when present", () => {
    const modelBtnLabel = document.createElement("span");
    applyModelLabel(
      { modelBtnLabel },
      { provider: "p", id: "x", name: "Pretty" },
    );
    expect(modelBtnLabel.textContent).toBe("Pretty");
  });

  test("falls back to id when name is empty", () => {
    const modelBtnLabel = document.createElement("span");
    applyModelLabel({ modelBtnLabel }, { provider: "p", id: "x", name: "" });
    expect(modelBtnLabel.textContent).toBe("x");
  });

  test("falls back to 'No model' when both blank", () => {
    const modelBtnLabel = document.createElement("span");
    applyModelLabel({ modelBtnLabel }, { provider: "", id: "", name: "" });
    expect(modelBtnLabel.textContent).toBe("No model");
  });
});
