// τ-mux web-mirror theme bridge.
//
// Translates a `SettingsSnapshotPayload` from the host into:
//   1. A set of CSS custom properties on the host element (shared
//      `--ht-*` tokens defined in `src/shared/web-theme-tokens.css`),
//      which drive every chrome surface (toolbar, sidebar, panes,
//      chips, status bar).
//   2. An xterm theme object suitable for `term.options.theme`. The
//      xterm renderer keys are not the same names the rest of the UI
//      uses, so the mapping is explicit.
//
// `null` settings means the host hasn't yet broadcast a settings
// payload (very early in the page lifecycle, or pre-M11 server). The
// caller falls back to the built-in Graphite tokens shipped in
// `web-theme-tokens.css`; this module is a no-op in that case.

import { hexToRgb } from "../shared/settings";
import type { SettingsSnapshotPayload } from "../shared/web-protocol";

/** Apply the wire-safe settings payload onto the document's CSS custom
 *  properties. Idempotent and safe to call on every dispatch. Pass
 *  `document.documentElement` as `root` in the browser; tests can
 *  inject a stub element. */
export function applyThemeFromSettings(
  settings: SettingsSnapshotPayload | null,
  root: HTMLElement,
): void {
  if (!settings) return;
  // Phase 5 / U2 — apply the chrome theme via `data-theme` so the
  // `[data-theme="…"]` token blocks in `web-theme-tokens.css`
  // activate. Older payloads (no `chromeTheme` field) default to
  // "system" so the OS preference still wires through.
  root.dataset["theme"] = settings.chromeTheme ?? "system";
  const accRgb = hexToRgb(settings.accentColor);
  const secRgb = hexToRgb(settings.secondaryColor);
  const bg = settings.bgBase;

  // Accent + secondary tokens. Mirror the shared `--ht-accent*` naming
  // from `src/shared/web-theme-tokens.css` so existing rules pick the
  // values up automatically.
  root.style.setProperty("--ht-accent", settings.accentColor);
  root.style.setProperty("--ht-accent-soft", `rgba(${accRgb}, 0.14)`);
  root.style.setProperty("--ht-accent-strong", `rgba(${accRgb}, 0.52)`);
  root.style.setProperty("--ht-secondary", settings.secondaryColor);
  root.style.setProperty("--ht-secondary-soft", `rgba(${secRgb}, 0.18)`);

  // Text + chrome surfaces. `bgBase` is "r, g, b" (matches the native
  // surface-manager applySettings() shape). All four chrome layers
  // derive from the same triple so a theme switch feels coherent.
  root.style.setProperty("--ht-text-strong", settings.foregroundColor);
  root.style.setProperty(
    "--ht-bg-window",
    `rgba(${bg}, ${settings.terminalBgOpacity})`,
  );
  root.style.setProperty("--ht-bg-shell", `rgba(${bg}, 0.96)`);
  root.style.setProperty("--ht-bg-titlebar", `rgba(${bg}, 0.92)`);
  root.style.setProperty("--ht-bg-sidebar", `rgba(${bg}, 0.96)`);
  root.style.setProperty("--ht-bg-pane", `rgba(${bg}, 1)`);

  // Focus ring derives from the active accent so it stays consistent
  // with whatever palette the user picked.
  root.style.setProperty("--ht-border-focus", `rgba(${accRgb}, 0.52)`);

  // Sidebar width comes through settings so a slider in the host's
  // settings panel resizes the mirror's sidebar in lockstep.
  root.style.setProperty("--ht-sidebar-width", `${settings.sidebarWidth}px`);

  // Typography — DM Sans is hard-coded for chrome via the shared
  // tokens; only the mono family follows the user's terminal-font
  // choice, since that's what the chips + telemetry zones use too.
  root.style.setProperty("--ht-font-mono", settings.fontFamily);
}

/** Build the xterm theme object the `Terminal({ theme })` constructor
 *  expects. Falls back to a Graphite-tinted default when settings are
 *  null — the same defaults the previous hard-coded `TERM_THEME`
 *  carried, just expressed against the Graphite preset. */
export function buildTermTheme(
  settings: SettingsSnapshotPayload | null,
): Record<string, string> {
  if (!settings) return DEFAULT_TERM_THEME;
  const bg = settings.bgBase;
  const accRgb = hexToRgb(settings.accentColor);
  return {
    // Transparent background lets `--ht-bg-pane` show through. Matches
    // the native surface-manager applySettings() approach.
    background: `rgba(${bg}, 0)`,
    foreground: settings.foregroundColor,
    cursor: settings.accentColor,
    cursorAccent: `rgb(${bg})`,
    selectionBackground: `rgba(${accRgb}, 0.22)`,
    selectionForeground: settings.foregroundColor,
    ...settings.ansiColors,
  };
}

/** Build the xterm option subset that depends on settings. The shape
 *  matches what xterm's `Terminal({})` constructor accepts; callers
 *  spread it into their own option set. */
export function buildTermOptionsFromSettings(
  settings: SettingsSnapshotPayload | null,
): {
  theme: Record<string, string>;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorBlink: boolean;
  cursorStyle: "block" | "bar" | "underline";
  scrollback: number;
} {
  return {
    theme: buildTermTheme(settings),
    fontFamily: settings?.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontSize: settings?.fontSize ?? 13,
    lineHeight: settings?.lineHeight ?? 1.0,
    cursorBlink: settings?.cursorBlink ?? true,
    cursorStyle: settings?.cursorStyle ?? "bar",
    scrollback: settings?.scrollbackLines ?? 10000,
  };
}

const DEFAULT_FONT_FAMILY =
  "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Fira Code', monospace";

/** Graphite-flavoured fallback for the brief window before the first
 *  `settingsSnapshot` envelope arrives. These values match the
 *  `graphite` preset in `src/shared/settings.ts`. */
const DEFAULT_TERM_THEME: Record<string, string> = {
  background: "rgba(10, 10, 10, 0)",
  foreground: "#f5f7fb",
  cursor: "#eab308",
  cursorAccent: "rgb(10, 10, 10)",
  selectionBackground: "rgba(234, 179, 8, 0.22)",
  selectionForeground: "#f5f7fb",
  black: "#181a21",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#f59e0b",
  blue: "#a1a1aa",
  magenta: "#c4c4cf",
  cyan: "#d7dae1",
  white: "#d7dce7",
  brightBlack: "#5c6270",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fbbf24",
  brightBlue: "#c7cad2",
  brightMagenta: "#d7dae1",
  brightCyan: "#e5e7eb",
  brightWhite: "#f5f7fb",
};
