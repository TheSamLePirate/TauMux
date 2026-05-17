// P7 S8 / H.9 — Settings → Network: auth-token ergonomics.
//
// The token was a hidden setting until now. This file pins the new
// UI surface: row rendered, peek toggle flips type, copy hits the
// clipboard, regenerate dispatches a fresh token via updateSettings,
// mirror-URL hint appears only when a token is set.

import {
  afterAll,
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

async function loadSettingsPanel() {
  const mod = await import("../src/views/terminal/settings-panel");
  const { DEFAULT_SETTINGS } = await import("../src/shared/settings");
  return { ...mod, DEFAULT_SETTINGS };
}

async function openNetworkPanel(initialToken: string): Promise<{
  partials: Record<string, unknown>[];
  authRow: HTMLElement;
  input: HTMLInputElement;
  container: HTMLElement;
}> {
  document.body.innerHTML = "";
  const { SettingsPanel, DEFAULT_SETTINGS } = await loadSettingsPanel();
  const partials: Record<string, unknown>[] = [];
  const panel = new SettingsPanel((p) =>
    partials.push(p as Record<string, unknown>),
  );
  panel.show({
    ...DEFAULT_SETTINGS,
    webMirrorAuthToken: initialToken,
  });

  const networkBtn = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".settings-nav-item"),
  ).find((b) => b.textContent?.includes("Network"));
  if (!networkBtn) throw new Error("Network nav button missing");
  networkBtn.click();

  // Auth Token row is the only row that carries an aria-label on its
  // input — find via that.
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Web mirror auth token"]',
  );
  if (!input) throw new Error("Auth Token row did not render");
  // Walk up to the `.settings-field` row container.
  let cursor: HTMLElement | null = input;
  while (cursor && !cursor.classList.contains("settings-field"))
    cursor = cursor.parentElement;
  if (!cursor) throw new Error("Auth row container missing");
  return { partials, authRow: cursor, input, container: document.body };
}

describe("Settings → Network — auth-token row (P7 S8 / H.9)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("input starts masked as password type with the current token", async () => {
    const { input } = await openNetworkPanel("seed-token-abcdef");
    expect(input.type).toBe("password");
    expect(input.value).toBe("seed-token-abcdef");
  });

  test("Show button reveals the token (type=text) and flips aria-pressed", async () => {
    const { input, authRow } = await openNetworkPanel("seed");
    const peek = Array.from(
      authRow.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent === "Show");
    expect(peek).toBeDefined();
    peek!.click();
    expect(input.type).toBe("text");
    expect(peek!.getAttribute("aria-pressed")).toBe("true");
    expect(peek!.textContent).toBe("Hide");
    peek!.click();
    expect(input.type).toBe("password");
    expect(peek!.getAttribute("aria-pressed")).toBe("false");
  });

  test("Copy writes the current token to the clipboard and pulses the button label", async () => {
    const { authRow } = await openNetworkPanel("super-secret");
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (t: string) => {
          writes.push(t);
          return Promise.resolve();
        },
      },
    });
    const copy = Array.from(
      authRow.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent === "Copy");
    expect(copy).toBeDefined();
    copy!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toEqual(["super-secret"]);
    expect(copy!.textContent).toBe("Copied");
  });

  test("Regenerate dispatches a fresh 64-char hex token via updateSettings", async () => {
    const { partials, authRow } = await openNetworkPanel("");
    const regen = Array.from(
      authRow.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent === "Regenerate");
    expect(regen).toBeDefined();
    regen!.click();
    expect(partials.length).toBe(1);
    const token = (partials[0] as { webMirrorAuthToken: string })
      .webMirrorAuthToken;
    expect(token.length).toBe(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  test("Mirror URL hint appears only when a token is set", async () => {
    const empty = await openNetworkPanel("");
    expect(empty.container.textContent?.includes("Mirror URL:")).toBeFalsy();
    document.body.innerHTML = "";
    const seeded = await openNetworkPanel("abcdef123456");
    expect(seeded.container.textContent).toContain("Mirror URL:");
    // Token is truncated to 6 chars + ellipsis in the visible hint.
    expect(seeded.container.textContent).toContain("abcdef");
    expect(seeded.container.textContent).not.toContain("abcdef123456");
  });
});

describe("generateAuthToken (P7 S8 / H.9)", () => {
  test("emits 64 hex chars", async () => {
    const { generateAuthToken } = await loadSettingsPanel();
    const t = generateAuthToken();
    expect(t.length).toBe(64);
    expect(t).toMatch(/^[0-9a-f]+$/);
  });

  test("two consecutive calls produce different tokens", async () => {
    const { generateAuthToken } = await loadSettingsPanel();
    const a = generateAuthToken();
    const b = generateAuthToken();
    expect(a).not.toBe(b);
  });
});
