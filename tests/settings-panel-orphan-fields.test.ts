/**
 * Settings fields that existed in `AppSettings` but had no renderer —
 * hand-editing settings.json was the only way to reach them. Two of
 * them decide security posture (`webMirrorBind`, `browserPartitionMode`),
 * one silences a false-alarming startup audit
 * (`auditsGitUserNameExpected`), and one is the terminal background
 * (`bgBase`, previously changeable only by picking a whole preset).
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AppSettings } from "../src/shared/settings";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function openSection(
  section: string,
  overrides: Partial<AppSettings> = {},
): Promise<{ partials: Partial<AppSettings>[]; content: HTMLElement }> {
  document.body.innerHTML = "";
  const { SettingsPanel } =
    await import("../src/views/terminal/settings-panel");
  const { DEFAULT_SETTINGS } = await import("../src/shared/settings");
  const partials: Partial<AppSettings>[] = [];
  const panel = new SettingsPanel((p) => partials.push(p));
  panel.show({ ...DEFAULT_SETTINGS, ...overrides });

  const btn = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".settings-nav-item"),
  ).find((b) => b.textContent?.includes(section));
  if (!btn) throw new Error(`nav button missing: ${section}`);
  btn.click();

  const content = document.querySelector<HTMLElement>(".settings-content");
  if (!content) throw new Error("settings content missing");
  return { partials, content };
}

function segment(content: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(
    content.querySelectorAll<HTMLButtonElement>(".settings-segment"),
  ).find((b) => b.textContent?.trim() === label);
  if (!btn) throw new Error(`segment not found: ${label}`);
  return btn;
}

describe("previously unreachable settings", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("Network exposes the web-mirror bind address", async () => {
    const { content, partials } = await openSection("Network");
    segment(content, "This Mac only").click();
    expect(partials).toContainEqual({ webMirrorBind: "127.0.0.1" });
    segment(content, "LAN").click();
    expect(partials).toContainEqual({ webMirrorBind: "0.0.0.0" });
  });

  test("Browser exposes the cookie partition mode", async () => {
    const { content, partials } = await openSection("Browser");
    segment(content, "Shared").click();
    expect(partials).toContainEqual({ browserPartitionMode: "shared" });
  });

  test("Advanced exposes the expected git user.name, empty meaning off", async () => {
    const { content, partials } = await openSection("Advanced", {
      auditsGitUserNameExpected: "olivierveinand",
    });
    const input = content.querySelector<HTMLInputElement>(
      'input[aria-label="Expected git user.name"]',
    )!;
    expect(input.value).toBe("olivierveinand");

    input.value = "  ";
    input.dispatchEvent(new Event("change"));
    expect(partials).toContainEqual({ auditsGitUserNameExpected: null });

    input.value = "someone-else";
    input.dispatchEvent(new Event("change"));
    expect(partials).toContainEqual({
      auditsGitUserNameExpected: "someone-else",
    });
  });

  test("Theme exposes the background tint as a swatch over the r,g,b value", async () => {
    const { content, partials } = await openSection("Theme", {
      bgBase: "7, 7, 10",
    });
    const raw = content.querySelector<HTMLInputElement>(
      'input[aria-label="Terminal background r, g, b"]',
    )!;
    const swatch = content.querySelector<HTMLInputElement>(
      'input[aria-label="Terminal background colour"]',
    )!;
    expect(raw.value).toBe("7, 7, 10");
    expect(swatch.value).toBe("#07070a");

    // Typing a hex is accepted and normalised back to the stored form.
    raw.value = "#102030";
    raw.dispatchEvent(new Event("change"));
    expect(partials.at(-1)).toEqual({
      themePreset: "custom",
      bgBase: "16, 32, 48",
    });
    expect(raw.value).toBe("16, 32, 48");
  });

  test("an unparseable background value is rejected, not persisted", async () => {
    const { content, partials } = await openSection("Theme", {
      bgBase: "7, 7, 10",
    });
    const raw = content.querySelector<HTMLInputElement>(
      'input[aria-label="Terminal background r, g, b"]',
    )!;
    raw.value = "not a colour";
    raw.dispatchEvent(new Event("change"));
    expect(partials).toHaveLength(0);
    expect(raw.value).toBe("7, 7, 10");
  });
});

describe("rgb triplet helpers", () => {
  test("round-trip hex ↔ triplet", async () => {
    const { hexToRgbTriplet, rgbTripletToHex, normalizeRgbTriplet } =
      await import("../src/views/terminal/settings-panel");
    expect(rgbTripletToHex("7, 7, 10")).toBe("#07070a");
    expect(hexToRgbTriplet("#07070a")).toBe("7, 7, 10");
    expect(normalizeRgbTriplet("16,32,48")).toBe("16, 32, 48");
    expect(normalizeRgbTriplet("#102030")).toBe("16, 32, 48");
  });

  test("out-of-range and malformed input is rejected", async () => {
    const { normalizeRgbTriplet, rgbTripletToHex } =
      await import("../src/views/terminal/settings-panel");
    expect(normalizeRgbTriplet("300, 0, 0")).toBeNull();
    expect(normalizeRgbTriplet("1, 2")).toBeNull();
    expect(normalizeRgbTriplet("red")).toBeNull();
    // A stored value we cannot parse still yields a legal swatch colour.
    expect(rgbTripletToHex("garbage")).toBe("#000000");
  });
});
