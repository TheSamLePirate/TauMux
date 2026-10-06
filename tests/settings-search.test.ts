import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  createSettingsSearchInput,
  filterSettingsContent,
} from "../src/views/terminal/settings-search";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

/** Build a fake rendered-settings DOM: two sections with chrome and
 *  fields, matching the class contract of settings-panel.ts. */
function makeContent(): HTMLElement {
  const root = document.createElement("div");
  const section = (title: string, fields: string[]) => {
    const h = document.createElement("h3");
    h.className = "settings-section-title";
    h.textContent = title;
    root.appendChild(h);
    const d = document.createElement("p");
    d.className = "settings-section-desc";
    d.textContent = `${title} description`;
    root.appendChild(d);
    for (const f of fields) {
      const row = document.createElement("div");
      row.className = "settings-field";
      const label = document.createElement("label");
      label.className = "settings-field-label";
      label.textContent = f;
      row.appendChild(label);
      root.appendChild(row);
    }
  };
  section("General", ["Shell", "Scrollback Lines"]);
  section("Network", ["Mirror Port", "Auth Token"]);
  return root;
}

const isHidden = (el: Element) => (el as HTMLElement).style.display === "none";

describe("filterSettingsContent", () => {
  test("hides non-matching fields, keeps matching ones", () => {
    const root = makeContent();
    filterSettingsContent(root, "shell", "shell");
    const fields = root.querySelectorAll(".settings-field");
    const visible = [...fields].filter((f) => !isHidden(f));
    expect(visible).toHaveLength(1);
    expect(visible[0]!.textContent).toContain("Shell");
  });

  test("a section with zero matching fields loses its title AND desc", () => {
    const root = makeContent();
    filterSettingsContent(root, "shell", "shell");
    const titles = root.querySelectorAll(".settings-section-title");
    expect(isHidden(titles[0]!)).toBe(false); // General has a match
    expect(isHidden(titles[1]!)).toBe(true); // Network doesn't
    const descs = root.querySelectorAll(".settings-section-desc");
    expect(isHidden(descs[1]!)).toBe(true);
  });

  test("matching is case-insensitive and covers note text", () => {
    const root = makeContent();
    filterSettingsContent(root, "AUTH", "AUTH");
    const visible = [...root.querySelectorAll(".settings-field")].filter(
      (f) => !isHidden(f),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]!.textContent).toContain("Auth Token");
  });

  test("no matches → explicit empty state, everything chrome-hidden", () => {
    const root = makeContent();
    filterSettingsContent(root, "zzzzz", "zzzzz");
    expect(root.querySelector(".settings-search-empty")).not.toBeNull();
    expect(root.querySelector(".settings-search-empty")!.textContent).toContain(
      "zzzzz",
    );
  });

  test("empty query is a no-op", () => {
    const root = makeContent();
    filterSettingsContent(root, "", "");
    const hidden = [...root.querySelectorAll(".settings-field")].filter((f) =>
      isHidden(f),
    );
    expect(hidden).toHaveLength(0);
    expect(root.querySelector(".settings-search-empty")).toBeNull();
  });
});

describe("createSettingsSearchInput", () => {
  test("query() tracks input, trimmed + lowercased; onChange fires", () => {
    let calls = 0;
    const s = createSettingsSearchInput(() => calls++);
    s.el.value = "  Mirror ";
    s.el.dispatchEvent(new Event("input"));
    expect(s.query()).toBe("mirror");
    expect(calls).toBe(1);
  });

  test("clear() resets both the element and the tracked query", () => {
    const s = createSettingsSearchInput(() => {});
    s.el.value = "x";
    s.el.dispatchEvent(new Event("input"));
    expect(s.query()).toBe("x");
    s.clear();
    expect(s.query()).toBe("");
    expect(s.el.value).toBe("");
  });

  test("Escape clears an active query; Escape on empty query does nothing", () => {
    let calls = 0;
    const s = createSettingsSearchInput(() => calls++);
    const esc = () =>
      s.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    esc(); // no query — no change event
    expect(calls).toBe(0);
    s.el.value = "abc";
    s.el.dispatchEvent(new Event("input"));
    expect(calls).toBe(1);
    esc();
    expect(s.query()).toBe("");
    expect(calls).toBe(2);
  });
});
