import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { maybeShowOnboarding } from "../src/views/terminal/onboarding";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function cleanup(): void {
  document.getElementById("onboarding-overlay")?.remove();
}

describe("maybeShowOnboarding", () => {
  test("mounts the overlay on first run (completed=false)", () => {
    cleanup();
    const shown = maybeShowOnboarding({ completed: false, onDismiss: () => {} });
    expect(shown).toBe(true);
    const overlay = document.getElementById("onboarding-overlay");
    expect(overlay).not.toBeNull();
    // The four discoverability anchors are all there.
    const text = overlay!.textContent ?? "";
    expect(text).toContain("⌘⇧P");
    expect(text).toContain("⌘⌥P");
    expect(text).toContain("⌘⇧?");
    expect(text).toContain("ht --help");
    cleanup();
  });

  test("never mounts when onboarding already completed", () => {
    cleanup();
    const shown = maybeShowOnboarding({ completed: true, onDismiss: () => {} });
    expect(shown).toBe(false);
    expect(document.getElementById("onboarding-overlay")).toBeNull();
  });

  test("dismiss button persists the flag exactly once", () => {
    cleanup();
    let dismissed = 0;
    maybeShowOnboarding({ completed: false, onDismiss: () => dismissed++ });
    const btn = document.querySelector<HTMLButtonElement>(
      ".onboarding-dismiss",
    )!;
    btn.click();
    btn.click(); // double-click must not double-persist
    expect(dismissed).toBe(1);
    cleanup();
  });

  test("Escape closes and persists", () => {
    cleanup();
    let dismissed = 0;
    maybeShowOnboarding({ completed: false, onDismiss: () => dismissed++ });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(dismissed).toBe(1);
    cleanup();
  });

  test("backdrop click closes; card click does not", () => {
    cleanup();
    let dismissed = 0;
    maybeShowOnboarding({ completed: false, onDismiss: () => dismissed++ });
    const overlay = document.getElementById("onboarding-overlay")!;
    const card = overlay.querySelector(".onboarding-card")!;
    // Click on the card itself: stays open.
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(dismissed).toBe(0);
    expect(document.getElementById("onboarding-overlay")).not.toBeNull();
    // Click on the backdrop (target === overlay): closes.
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(dismissed).toBe(1);
    cleanup();
  });

  test("double-invocation never double-mounts", () => {
    cleanup();
    maybeShowOnboarding({ completed: false, onDismiss: () => {} });
    const second = maybeShowOnboarding({
      completed: false,
      onDismiss: () => {},
    });
    expect(second).toBe(false);
    expect(document.querySelectorAll("#onboarding-overlay")).toHaveLength(1);
    cleanup();
  });
});
