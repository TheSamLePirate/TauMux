import { describe, test, expect } from "bun:test";
import {
  applyThemeFromSettings,
  buildTermOptionsFromSettings,
  buildTermTheme,
} from "../src/web-client/theme-bridge";
import {
  pickWebSettings,
  THEME_PRESETS,
  DEFAULT_SETTINGS,
  presetToPartial,
  mergeSettings,
} from "../src/shared/settings";

function settingsForPreset(presetId: string) {
  const preset = THEME_PRESETS.find((p) => p.id === presetId)!;
  const merged = mergeSettings(DEFAULT_SETTINGS, presetToPartial(preset));
  return pickWebSettings(merged);
}

/** Stand-in for `document.documentElement` in the bun:test runtime —
 *  records every CSS custom property write so assertions can read
 *  back the values the bridge wrote. */
function makeRoot(): { el: HTMLElement; written: Map<string, string> } {
  const written = new Map<string, string>();
  const style = {
    setProperty(name: string, value: string) {
      written.set(name, value);
    },
  };
  const el = { style } as unknown as HTMLElement;
  return { el, written };
}

describe("web-client theme bridge", () => {
  test("null settings is a no-op (preserves built-in Graphite tokens)", () => {
    const { el, written } = makeRoot();
    applyThemeFromSettings(null, el);
    expect(written.size).toBe(0);
  });

  test("Graphite preset writes a yellow accent and the matching focus ring", () => {
    const { el, written } = makeRoot();
    applyThemeFromSettings(settingsForPreset("graphite"), el);
    expect(written.get("--ht-accent")).toBe("#eab308");
    // hexToRgb("#eab308") = "234, 179, 8". Soft = .14, strong = .52.
    expect(written.get("--ht-accent-soft")).toBe("rgba(234, 179, 8, 0.14)");
    expect(written.get("--ht-accent-strong")).toBe("rgba(234, 179, 8, 0.52)");
    expect(written.get("--ht-border-focus")).toBe("rgba(234, 179, 8, 0.52)");
    expect(written.get("--ht-secondary")).toBe("#71717a");
  });

  test("Tokyo Night preset writes a blue accent", () => {
    const { el, written } = makeRoot();
    applyThemeFromSettings(settingsForPreset("tokyo-night"), el);
    expect(written.get("--ht-accent")).toBe("#7aa2f7");
    expect(written.get("--ht-secondary")).toBe("#bb9af7");
    // bgBase "26, 27, 38" with terminalBgOpacity 0.8.
    expect(written.get("--ht-bg-window")).toBe("rgba(26, 27, 38, 0.8)");
  });

  test("buildTermTheme spreads the ANSI palette into xterm-shaped keys", () => {
    const settings = settingsForPreset("graphite");
    const theme = buildTermTheme(settings);
    // Foreground/background/cursor come from the explicit preset
    // fields; the 16 ANSI keys come straight off `ansiColors`.
    expect(theme["foreground"]).toBe("#f5f7fb");
    expect(theme["cursor"]).toBe("#eab308");
    expect(theme["background"]).toBe("rgba(10, 10, 10, 0)");
    expect(theme["red"]).toBe(settings.ansiColors.red);
    expect(theme["brightYellow"]).toBe(settings.ansiColors.brightYellow);
    // Selection background uses the accent at 22% opacity.
    expect(theme["selectionBackground"]).toBe("rgba(234, 179, 8, 0.22)");
  });

  test("buildTermTheme falls back to a Graphite-shaped default when settings are null", () => {
    const theme = buildTermTheme(null);
    expect(theme["foreground"]).toBe("#f5f7fb");
    expect(theme["cursor"]).toBe("#eab308");
    expect(theme["red"]).toBe("#f87171");
    // 16 ANSI slots (normal + bright) all populated.
    for (const k of [
      "black",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "brightBlack",
      "brightRed",
      "brightGreen",
      "brightYellow",
      "brightBlue",
      "brightMagenta",
      "brightCyan",
      "brightWhite",
    ]) {
      expect(typeof theme[k]).toBe("string");
      expect(theme[k]!.length).toBeGreaterThan(0);
    }
  });

  test("buildTermOptionsFromSettings hands xterm a complete options object", () => {
    const settings = settingsForPreset("dracula");
    const opts = buildTermOptionsFromSettings(settings);
    expect(opts.fontSize).toBe(settings.fontSize);
    expect(opts.lineHeight).toBe(settings.lineHeight);
    expect(opts.cursorStyle).toBe(settings.cursorStyle);
    expect(opts.cursorBlink).toBe(settings.cursorBlink);
    expect(opts.scrollback).toBe(settings.scrollbackLines);
    // Theme is a fresh object — caller can mutate options later
    // without affecting future calls.
    const opts2 = buildTermOptionsFromSettings(settings);
    expect(opts2.theme).not.toBe(opts.theme);
  });
});
