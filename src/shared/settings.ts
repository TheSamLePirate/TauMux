export interface AnsiColors {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface AppSettings {
  // General
  shellPath: string;
  scrollbackLines: number;

  // Appearance
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;

  // Theme
  themePreset: string;
  accentColor: string;
  secondaryColor: string;
  terminalBgOpacity: number;
  foregroundColor: string;
  bgBase: string; // base background tint, e.g. "7, 7, 10"
  ansiColors: AnsiColors;

  // Effects
  terminalBloom: boolean;
  bloomIntensity: number;

  // Network
  webMirrorPort: number;
  autoStartWebMirror: boolean;
  /** Bind address for the web mirror. Defaults to 0.0.0.0 (LAN-visible).
   *  Set to "127.0.0.1" to restrict to the local machine. */
  webMirrorBind: "127.0.0.1" | "0.0.0.0";
  /** Optional auth token. When set, GET / and WS upgrade require
   *  `?t=<token>`. Empty string disables auth (back-compat default). */
  webMirrorAuthToken: string;

  // Scripts
  /** Command used to run `package.json` scripts from the sidebar. */
  packageRunner: "bun" | "npm" | "pnpm" | "yarn";

  // Advanced
  paneGap: number;
  sidebarWidth: number;

  // Browser
  /** Search engine for browser address bar non-URL queries. */
  browserSearchEngine: "google" | "duckduckgo" | "bing" | "kagi";
  /** Default URL when opening a new browser pane (empty = about:blank). */
  browserHomePage: string;
  /** Force dark mode on web pages via CSS injection. */
  browserForceDarkMode: boolean;
  /** Open terminal URL clicks in the built-in browser instead of externally. */
  browserInterceptTerminalLinks: boolean;
}

export interface ThemePreset {
  id: string;
  name: string;
  accentColor: string;
  secondaryColor: string;
  foregroundColor: string;
  bgBase: string;
  terminalBgOpacity: number;
  ansiColors: AnsiColors;
}

const ANSI_KEYS = [
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
] as const satisfies readonly (keyof AnsiColors)[];

type AnsiTuple = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/** Build an AnsiColors record from an ordered 16-color tuple.
 *  Order matches ANSI_KEYS: normal 0–7 then bright 0–7. */
export function createAnsiPalette(colors: AnsiTuple): AnsiColors {
  const out = {} as AnsiColors;
  for (let i = 0; i < ANSI_KEYS.length; i++) {
    out[ANSI_KEYS[i]] = colors[i];
  }
  return out;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "graphite",
    name: "Graphite",
    accentColor: "#eab308",
    secondaryColor: "#71717a",
    foregroundColor: "#f5f7fb",
    bgBase: "10, 10, 10",
    terminalBgOpacity: 0.92,
    ansiColors: createAnsiPalette([
      "#181a21",
      "#f87171",
      "#4ade80",
      "#f59e0b",
      "#a1a1aa",
      "#c4c4cf",
      "#d7dae1",
      "#d7dce7",
      "#5c6270",
      "#fca5a5",
      "#86efac",
      "#fbbf24",
      "#c7cad2",
      "#d7dae1",
      "#e5e7eb",
      "#f5f7fb",
    ]),
  },
  {
    id: "obsidian",
    name: "Obsidian",
    accentColor: "#eab308",
    secondaryColor: "#a855f7",
    foregroundColor: "#f4f4f5",
    bgBase: "7, 7, 10",
    terminalBgOpacity: 0.68,
    ansiColors: createAnsiPalette([
      "#18181b",
      "#f87171",
      "#4ade80",
      "#eab308",
      "#c4b5fd",
      "#a855f7",
      "#67e8f9",
      "#e4e4e7",
      "#52525b",
      "#fb7185",
      "#86efac",
      "#facc15",
      "#ddd6fe",
      "#d8b4fe",
      "#a5f3fc",
      "#fafafa",
    ]),
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    accentColor: "#f5e0dc",
    secondaryColor: "#cba6f7",
    foregroundColor: "#cdd6f4",
    bgBase: "30, 30, 46",
    terminalBgOpacity: 0.82,
    ansiColors: createAnsiPalette([
      "#45475a",
      "#f38ba8",
      "#a6e3a1",
      "#f9e2af",
      "#89b4fa",
      "#cba6f7",
      "#94e2d5",
      "#bac2de",
      "#585b70",
      "#f38ba8",
      "#a6e3a1",
      "#f9e2af",
      "#89b4fa",
      "#cba6f7",
      "#94e2d5",
      "#a6adc8",
    ]),
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    accentColor: "#7aa2f7",
    secondaryColor: "#bb9af7",
    foregroundColor: "#c0caf5",
    bgBase: "26, 27, 38",
    terminalBgOpacity: 0.8,
    ansiColors: createAnsiPalette([
      "#1a1b26",
      "#f7768e",
      "#9ece6a",
      "#e0af68",
      "#7aa2f7",
      "#bb9af7",
      "#7dcfff",
      "#a9b1d6",
      "#414868",
      "#f7768e",
      "#9ece6a",
      "#e0af68",
      "#7aa2f7",
      "#bb9af7",
      "#7dcfff",
      "#c0caf5",
    ]),
  },
  {
    id: "dracula",
    name: "Dracula",
    accentColor: "#bd93f9",
    secondaryColor: "#ff79c6",
    foregroundColor: "#f8f8f2",
    bgBase: "40, 42, 54",
    terminalBgOpacity: 0.82,
    ansiColors: createAnsiPalette([
      "#21222c",
      "#ff5555",
      "#50fa7b",
      "#f1fa8c",
      "#bd93f9",
      "#ff79c6",
      "#8be9fd",
      "#f8f8f2",
      "#6272a4",
      "#ff6e6e",
      "#69ff94",
      "#ffffa5",
      "#d6acff",
      "#ff92df",
      "#a4ffff",
      "#ffffff",
    ]),
  },
  {
    id: "nord",
    name: "Nord",
    accentColor: "#88c0d0",
    secondaryColor: "#b48ead",
    foregroundColor: "#eceff4",
    bgBase: "46, 52, 64",
    terminalBgOpacity: 0.84,
    ansiColors: createAnsiPalette([
      "#3b4252",
      "#bf616a",
      "#a3be8c",
      "#ebcb8b",
      "#81a1c1",
      "#b48ead",
      "#88c0d0",
      "#e5e9f0",
      "#4c566a",
      "#bf616a",
      "#a3be8c",
      "#ebcb8b",
      "#81a1c1",
      "#b48ead",
      "#8fbcbb",
      "#eceff4",
    ]),
  },
  {
    id: "rose-pine",
    name: "Ros\u00e9 Pine",
    accentColor: "#ebbcba",
    secondaryColor: "#c4a7e7",
    foregroundColor: "#e0def4",
    bgBase: "25, 23, 36",
    terminalBgOpacity: 0.8,
    ansiColors: createAnsiPalette([
      "#26233a",
      "#eb6f92",
      "#9ccfd8",
      "#f6c177",
      "#31748f",
      "#c4a7e7",
      "#9ccfd8",
      "#e0def4",
      "#6e6a86",
      "#eb6f92",
      "#9ccfd8",
      "#f6c177",
      "#31748f",
      "#c4a7e7",
      "#9ccfd8",
      "#e0def4",
    ]),
  },
  {
    id: "gruvbox",
    name: "Gruvbox Dark",
    accentColor: "#fe8019",
    secondaryColor: "#d3869b",
    foregroundColor: "#ebdbb2",
    bgBase: "40, 40, 40",
    terminalBgOpacity: 0.84,
    ansiColors: createAnsiPalette([
      "#282828",
      "#cc241d",
      "#98971a",
      "#d79921",
      "#458588",
      "#b16286",
      "#689d6a",
      "#a89984",
      "#928374",
      "#fb4934",
      "#b8bb26",
      "#fabd2f",
      "#83a598",
      "#d3869b",
      "#8ec07c",
      "#ebdbb2",
    ]),
  },
  {
    id: "solarized",
    name: "Solarized Dark",
    accentColor: "#b58900",
    secondaryColor: "#6c71c4",
    foregroundColor: "#839496",
    bgBase: "0, 43, 54",
    terminalBgOpacity: 0.88,
    ansiColors: createAnsiPalette([
      "#073642",
      "#dc322f",
      "#859900",
      "#b58900",
      "#268bd2",
      "#d33682",
      "#2aa198",
      "#eee8d5",
      "#586e75",
      "#cb4b16",
      "#859900",
      "#b58900",
      "#268bd2",
      "#6c71c4",
      "#2aa198",
      "#fdf6e3",
    ]),
  },
  {
    id: "synthwave",
    name: "Synthwave '84",
    accentColor: "#f97e72",
    secondaryColor: "#ff7edb",
    foregroundColor: "#ffffff",
    bgBase: "34, 20, 50",
    terminalBgOpacity: 0.75,
    ansiColors: createAnsiPalette([
      "#2b213a",
      "#fe4450",
      "#72f1b8",
      "#fede5d",
      "#36f9f6",
      "#ff7edb",
      "#36f9f6",
      "#ffffff",
      "#614d85",
      "#fe4450",
      "#72f1b8",
      "#fede5d",
      "#36f9f6",
      "#ff7edb",
      "#36f9f6",
      "#ffffff",
    ]),
  },
  {
    id: "everforest",
    name: "Everforest",
    accentColor: "#a7c080",
    secondaryColor: "#d699b6",
    foregroundColor: "#d3c6aa",
    bgBase: "39, 48, 43",
    terminalBgOpacity: 0.84,
    ansiColors: createAnsiPalette([
      "#343f44",
      "#e67e80",
      "#a7c080",
      "#dbbc7f",
      "#7fbbb3",
      "#d699b6",
      "#83c092",
      "#d3c6aa",
      "#4a555b",
      "#e67e80",
      "#a7c080",
      "#dbbc7f",
      "#7fbbb3",
      "#d699b6",
      "#83c092",
      "#d3c6aa",
    ]),
  },
];

export const DEFAULT_FONT_FAMILY =
  "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Berkeley Mono', 'SF Mono', 'Menlo', monospace";

export const DEFAULT_ANSI_COLORS: AnsiColors = createAnsiPalette([
  "#18181b",
  "#f87171",
  "#4ade80",
  "#eab308",
  "#c4b5fd",
  "#a855f7",
  "#67e8f9",
  "#e4e4e7",
  "#52525b",
  "#fb7185",
  "#86efac",
  "#facc15",
  "#ddd6fe",
  "#d8b4fe",
  "#a5f3fc",
  "#fafafa",
]);

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  shellPath: "",
  scrollbackLines: 10000,

  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.2,
  cursorStyle: "block",
  cursorBlink: true,

  themePreset: THEME_PRESETS[0].id,
  accentColor: THEME_PRESETS[0].accentColor,
  secondaryColor: THEME_PRESETS[0].secondaryColor,
  terminalBgOpacity: THEME_PRESETS[0].terminalBgOpacity,
  foregroundColor: THEME_PRESETS[0].foregroundColor,
  bgBase: THEME_PRESETS[0].bgBase,
  ansiColors: { ...THEME_PRESETS[0].ansiColors },

  // Bloom defaults to OFF — it's a WebGL glow layer on top of xterm
  // glyphs, beautiful but CPU/GPU-expensive and not deterministic for
  // visual regression tests. Users can enable it from the Effects tab
  // of Settings; `bloomIntensity` stays at a sensible starting value so
  // re-enabling the toggle gives immediate visible effect.
  terminalBloom: false,
  bloomIntensity: 1.0,

  webMirrorPort: 3000,
  autoStartWebMirror: false,
  webMirrorBind: "0.0.0.0",
  webMirrorAuthToken: "",

  packageRunner: "bun",

  paneGap: 2,
  sidebarWidth: 320,

  browserSearchEngine: "google",
  browserHomePage: "",
  browserForceDarkMode: false,
  browserInterceptTerminalLinks: false,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function validateSettings(s: AppSettings): AppSettings {
  return {
    ...s,
    scrollbackLines: clamp(Math.round(s.scrollbackLines), 100, 100000),
    fontSize: clamp(Math.round(s.fontSize), 8, 32),
    lineHeight: clamp(s.lineHeight, 0.8, 2.0),
    terminalBgOpacity: clamp(s.terminalBgOpacity, 0, 1),
    bloomIntensity: clamp(s.bloomIntensity, 0, 2),
    webMirrorPort: clamp(Math.round(s.webMirrorPort), 1, 65535),
    webMirrorBind: s.webMirrorBind === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0",
    webMirrorAuthToken: (s.webMirrorAuthToken ?? "").trim(),
    paneGap: clamp(Math.round(s.paneGap), 0, 20),
    sidebarWidth: clamp(Math.round(s.sidebarWidth), 200, 600),
    browserSearchEngine:
      s.browserSearchEngine === "duckduckgo" ||
      s.browserSearchEngine === "bing" ||
      s.browserSearchEngine === "kagi"
        ? s.browserSearchEngine
        : "google",
    browserHomePage: (s.browserHomePage ?? "").trim(),
    browserForceDarkMode: !!s.browserForceDarkMode,
    browserInterceptTerminalLinks: !!s.browserInterceptTerminalLinks,
    cursorStyle:
      s.cursorStyle === "bar" || s.cursorStyle === "underline"
        ? s.cursorStyle
        : "block",
    packageRunner:
      s.packageRunner === "npm" ||
      s.packageRunner === "pnpm" ||
      s.packageRunner === "yarn"
        ? s.packageRunner
        : "bun",
  };
}

export function mergeSettings(
  current: AppSettings,
  partial: Partial<AppSettings>,
): AppSettings {
  const merged = { ...current, ...partial };
  // Deep merge for ansiColors
  if (partial.ansiColors) {
    merged.ansiColors = { ...current.ansiColors, ...partial.ansiColors };
  }
  return validateSettings(merged);
}

/** Build a partial settings update that applies a theme preset. */
export function presetToPartial(preset: ThemePreset): Partial<AppSettings> {
  return {
    themePreset: preset.id,
    accentColor: preset.accentColor,
    secondaryColor: preset.secondaryColor,
    foregroundColor: preset.foregroundColor,
    bgBase: preset.bgBase,
    terminalBgOpacity: preset.terminalBgOpacity,
    ansiColors: { ...preset.ansiColors },
  };
}

/** Convert a hex color (#rrggbb) to "r, g, b" for use in rgba(). */
export function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
