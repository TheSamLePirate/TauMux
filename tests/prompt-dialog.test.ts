/**
 * The in-app modal sheets, and why they exist.
 *
 * Every native browser modal is a trap in this app: inside the
 * Electrobun webview `confirm()` returns false, `prompt()` returns null
 * and `alert()` draws nothing. Five shipped call sites relied on them,
 * and all five silently did nothing — a dirty editor pane could not be
 * closed, an extension could not be removed, the web-mirror token could
 * not be regenerated, the file explorer's "+" button was inert, and a
 * pi session could not be renamed.
 *
 * The failure mode is silent, so the properties pinned hardest here are
 * the ones a user notices: confirming runs the action, and a refused
 * value says why instead of vanishing.
 */
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

async function load() {
  return await import("../src/views/terminal/prompt-dialog");
}

function overlay() {
  return document.querySelector(".prompt-overlay");
}

function button(label: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(".prompt-overlay button"),
  ).find((b) => b.textContent === label);
}

/** Let the dialog's promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("confirmDestructive", () => {
  test("opens an in-app sheet rather than a native modal", async () => {
    const { confirmDestructive } = await load();
    confirmDestructive(
      "Remove extension",
      "Deletes its folder.",
      "Remove",
      () => {},
    );
    expect(overlay()).not.toBeNull();
    expect(document.querySelector(".prompt-title")!.textContent).toBe(
      "Remove extension",
    );
    expect(document.querySelector(".prompt-message")!.textContent).toBe(
      "Deletes its folder.",
    );
  });

  test("does not run the action before the user answers", async () => {
    const { confirmDestructive } = await load();
    let ran = false;
    confirmDestructive("t", "m", "Go", () => {
      ran = true;
    });
    await settle();
    expect(ran).toBe(false);
  });

  test("confirming runs the action", async () => {
    const { confirmDestructive } = await load();
    let ran = false;
    confirmDestructive("t", "m", "Go", () => {
      ran = true;
    });
    button("Go")!.click();
    await settle();
    expect(ran).toBe(true);
  });

  test("cancelling does not run the action", async () => {
    const { confirmDestructive } = await load();
    let ran = false;
    confirmDestructive("t", "m", "Go", () => {
      ran = true;
    });
    button("Cancel")!.click();
    await settle();
    expect(ran).toBe(false);
  });

  test("uses the danger styling — every caller is destructive", async () => {
    const { confirmDestructive } = await load();
    confirmDestructive("t", "m", "Go", () => {});
    expect(button("Go")!.className).toContain("prompt-btn-danger");
  });

  test("closes the sheet once answered", async () => {
    const { confirmDestructive } = await load();
    confirmDestructive("t", "m", "Go", () => {});
    button("Go")!.click();
    await settle();
    expect(overlay()).toBeNull();
  });

  test("being displaced by another dialog does NOT run the action", async () => {
    // Only one sheet may exist at a time; the displaced one resolves as
    // cancelled. A destructive action defaulting to "yes" on an
    // ambiguous dismissal would be a footgun.
    const { confirmDestructive } = await load();
    let ran = false;
    confirmDestructive("first", "m", "Go", () => {
      ran = true;
    });
    confirmDestructive("second", "m", "Go", () => {});
    await settle();
    expect(ran).toBe(false);
    expect(document.querySelector(".prompt-title")!.textContent).toBe("second");
  });
});

describe("showPromptDialog — validation", () => {
  const input = () => document.querySelector<HTMLInputElement>(".prompt-input")!;
  const btn = (label: string) =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(".prompt-overlay button"),
    ).find((b) => b.textContent === label)!;

  test("an accepted value resolves and closes the sheet", async () => {
    const { showPromptDialog } = await load();
    const p = showPromptDialog({ title: "t", confirmLabel: "Go" });
    input().value = "  spaced  ";
    btn("Go").click();
    expect(await p).toBe("spaced");
    expect(document.querySelector(".prompt-overlay")).toBeNull();
  });

  test("a rejected value keeps the sheet open and shows the reason", async () => {
    const { showPromptDialog } = await load();
    void showPromptDialog({
      title: "t",
      confirmLabel: "Go",
      validate: (v) => (v === "bad" ? "Not that one." : null),
    });
    input().value = "bad";
    btn("Go").click();
    await settle();
    expect(document.querySelector(".prompt-error")!.textContent).toBe(
      "Not that one.",
    );
    expect(document.querySelector(".prompt-overlay")).not.toBeNull();
  });

  test("the validation message is announced, not just drawn", async () => {
    const { showPromptDialog } = await load();
    void showPromptDialog({
      title: "t",
      confirmLabel: "Go",
      validate: () => "nope",
    });
    btn("Go").click();
    input().value = "x";
    btn("Go").click();
    await settle();
    expect(document.querySelector(".prompt-error")!.getAttribute("role")).toBe(
      "alert",
    );
  });

  test("an empty value is refused with the shake and no message", async () => {
    const { showPromptDialog } = await load();
    void showPromptDialog({ title: "t", confirmLabel: "Go" });
    btn("Go").click();
    await settle();
    expect(input().classList.contains("prompt-input-invalid")).toBe(true);
    expect(document.querySelector(".prompt-error")).toBeNull();
  });

  test("cancel resolves null even with a validator present", async () => {
    const { showPromptDialog } = await load();
    const p = showPromptDialog({
      title: "t",
      confirmLabel: "Go",
      validate: () => "always bad",
    });
    btn("Cancel").click();
    expect(await p).toBeNull();
  });
});
