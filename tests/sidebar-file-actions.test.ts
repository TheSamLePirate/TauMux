/**
 * The file explorer's "+" (new file) button, and the prompt-sheet
 * validation it relies on.
 *
 * The button shipped calling the DOM `prompt()` and `alert()`. Inside
 * the Electrobun webview `prompt()` returns null and `alert()` draws
 * nothing, so the handler bailed on its first line: clicking "+" did
 * nothing at all, with no signal of any kind.
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
  return await import("../src/views/terminal/sidebar-file-actions");
}

const sheetInput = () =>
  document.querySelector<HTMLInputElement>(".prompt-input");
const sheetButton = (label: string) =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(".prompt-overlay button"),
  ).find((b) => b.textContent === label);
const errorText = () =>
  document.querySelector(".prompt-error")?.textContent ?? null;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("validateNewFileName", () => {
  test("accepts an ordinary name", async () => {
    const { validateNewFileName } = await load();
    expect(validateNewFileName("notes.md")).toBeNull();
    expect(validateNewFileName(".gitignore")).toBeNull();
  });

  test("rejects a name with a slash — this row creates in one directory", async () => {
    const { validateNewFileName } = await load();
    expect(validateNewFileName("a/b.ts")).toBe("Use a name without slashes.");
  });

  test("rejects the directory shorthands", async () => {
    const { validateNewFileName } = await load();
    expect(validateNewFileName(".")).not.toBeNull();
    expect(validateNewFileName("..")).not.toBeNull();
  });

  test("rejects a leading dash — it reads as a flag to anything shelling out", async () => {
    const { validateNewFileName } = await load();
    expect(validateNewFileName("-rf")).toBe("A name cannot start with a dash.");
  });
});

describe("buildNewFileButton", () => {
  async function clickNew() {
    const { buildNewFileButton } = await load();
    const btn = buildNewFileButton("/repo/src", "ws:1");
    document.body.appendChild(btn);
    const seen: unknown[] = [];
    const onEvent = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("ht-open-file-in-editor", onEvent);
    btn.click();
    return {
      seen,
      done: () => window.removeEventListener("ht-open-file-in-editor", onEvent),
    };
  }

  test("opens the app's own sheet, not a native prompt", async () => {
    const { done } = await clickNew();
    expect(document.querySelector(".prompt-overlay")).not.toBeNull();
    expect(document.querySelector(".prompt-title")!.textContent).toBe(
      "New file",
    );
    done();
  });

  test("names the directory the file lands in", async () => {
    const { done } = await clickNew();
    expect(document.querySelector(".prompt-message")!.textContent).toContain(
      "/repo/src",
    );
    done();
  });

  test("creating emits an open-with-create for the joined path", async () => {
    const { seen, done } = await clickNew();
    sheetInput()!.value = "notes.md";
    sheetButton("Create")!.click();
    await settle();
    done();
    expect(seen).toEqual([
      { path: "/repo/src/notes.md", workspaceId: "ws:1", create: true },
    ]);
  });

  test("cancelling creates nothing", async () => {
    const { seen, done } = await clickNew();
    sheetButton("Cancel")!.click();
    await settle();
    done();
    expect(seen).toEqual([]);
  });

  test("an invalid name explains itself in place and keeps the sheet open", async () => {
    // The old path showed an alert() that never rendered, so a slash
    // just made the button look broken a second time.
    const { seen, done } = await clickNew();
    sheetInput()!.value = "sub/dir.ts";
    sheetButton("Create")!.click();
    await settle();
    expect(errorText()).toBe("Use a name without slashes.");
    expect(document.querySelector(".prompt-overlay")).not.toBeNull();
    expect(seen).toEqual([]);
    done();
  });

  test("fixing the name after a refusal goes through", async () => {
    const { seen, done } = await clickNew();
    sheetInput()!.value = "sub/dir.ts";
    sheetButton("Create")!.click();
    await settle();
    sheetInput()!.value = "dir.ts";
    sheetButton("Create")!.click();
    await settle();
    done();
    expect(seen).toEqual([
      { path: "/repo/src/dir.ts", workspaceId: "ws:1", create: true },
    ]);
  });

  test("a trailing slash on the directory is not doubled", async () => {
    const { buildNewFileButton } = await load();
    const btn = buildNewFileButton("/repo/src/", "ws:1");
    document.body.appendChild(btn);
    const seen: unknown[] = [];
    const onEvent = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("ht-open-file-in-editor", onEvent);
    btn.click();
    sheetInput()!.value = "a.ts";
    sheetButton("Create")!.click();
    await settle();
    window.removeEventListener("ht-open-file-in-editor", onEvent);
    expect((seen[0] as { path: string }).path).toBe("/repo/src/a.ts");
  });
});
