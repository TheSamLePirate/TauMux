// Triple-A I.11 / U11 — verify the keyboard cheat-sheet renders its
// bindings with the correct a11y attributes. Backfill from Phase 0
// audit (PR 20).
//
// Tests the actual DOM construction via happy-dom — the previous
// suite only covered keyMatch display formatting, not the rendered
// dialog.

import {
  afterAll,
  afterEach,
  beforeAll,
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
afterEach(() => {
  document.body.innerHTML = "";
});

async function loadCheatsheet() {
  return await import("../src/views/terminal/keyboard-cheatsheet");
}

const sampleBindings = [
  {
    id: "palette.toggle",
    description: "Toggle command palette",
    category: "App",
    match: { display: "⌘⇧P" },
  },
  {
    id: "workspace.switch-1",
    description: "Switch to workspace 1",
    category: "Workspace",
    match: { display: "⌘1" },
  },
  {
    id: "app.keyboard-help",
    description: "Show keyboard shortcuts",
    category: "App",
    match: { display: "⌘?" },
  },
] as const;

describe("[U11] KeyboardCheatsheet — dialog a11y attributes", () => {
  test("the overlay carries role=dialog + aria-modal + aria-labelledby", async () => {
    const { KeyboardCheatsheet } = await loadCheatsheet();
    const cs = new KeyboardCheatsheet();
    const overlay = document.body.querySelector(".kbd-cheatsheet");
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("role")).toBe("dialog");
    expect(overlay!.getAttribute("aria-modal")).toBe("true");
    expect(overlay!.getAttribute("aria-labelledby")).toBe(
      "kbd-cheatsheet-title",
    );
    cs.hide(); // tidy
  });

  test("starts hidden", async () => {
    const { KeyboardCheatsheet } = await loadCheatsheet();
    const cs = new KeyboardCheatsheet();
    const overlay = document.body.querySelector(".kbd-cheatsheet")!;
    expect(overlay.classList.contains("hidden")).toBe(true);
    expect(cs.isVisible()).toBe(false);
  });
});

describe("[U11] KeyboardCheatsheet — render", () => {
  test("renders every binding's description after show()", async () => {
    const { KeyboardCheatsheet } = await loadCheatsheet();
    const cs = new KeyboardCheatsheet();
    cs.setBindings(sampleBindings);
    cs.show();

    const overlay = document.body.querySelector(".kbd-cheatsheet")!;
    expect(overlay.classList.contains("hidden")).toBe(false);
    const text = overlay.textContent ?? "";
    for (const b of sampleBindings) {
      expect(text).toContain(b.description);
    }
  });

  test("includes the keyMatch display string for each binding", async () => {
    const { KeyboardCheatsheet } = await loadCheatsheet();
    const cs = new KeyboardCheatsheet();
    cs.setBindings(sampleBindings);
    cs.show();
    const text =
      document.body.querySelector(".kbd-cheatsheet")!.textContent ?? "";
    expect(text).toContain("⌘⇧P");
    expect(text).toContain("⌘1");
    expect(text).toContain("⌘?");
  });

  test("groups bindings by category", async () => {
    const { KeyboardCheatsheet } = await loadCheatsheet();
    const cs = new KeyboardCheatsheet();
    cs.setBindings(sampleBindings);
    cs.show();
    const overlay = document.body.querySelector(".kbd-cheatsheet")!;
    const text = overlay.textContent ?? "";
    // Both categories from sampleBindings should appear in the
    // rendered output so a future regression that drops grouping is
    // caught.
    expect(text).toContain("App");
    expect(text).toContain("Workspace");
  });

  test("toggle() flips visibility", async () => {
    const { KeyboardCheatsheet } = await loadCheatsheet();
    const cs = new KeyboardCheatsheet();
    cs.setBindings(sampleBindings);
    expect(cs.isVisible()).toBe(false);
    cs.toggle();
    expect(cs.isVisible()).toBe(true);
    cs.toggle();
    expect(cs.isVisible()).toBe(false);
  });
});
