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

  // Scripts
  /** Command used to run `package.json` scripts from the sidebar. */
  packageRunner: "bun" | "npm" | "pnpm" | "yarn";

  // Advanced
  paneGap: number;
  sidebarWidth: number;
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

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "obsidian",
    name: "Obsidian",
    accentColor: "#eab308",
    secondaryColor: "#a855f7",
    foregroundColor: "#f4f4f5",
    bgBase: "7, 7, 10",
    terminalBgOpacity: 0.68,
    ansiColors: {
      black: "#18181b",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#eab308",
      blue: "#c4b5fd",
      magenta: "#a855f7",
      cyan: "#67e8f9",
      white: "#e4e4e7",
      brightBlack: "#52525b",
      brightRed: "#fb7185",
      brightGreen: "#86efac",
      brightYellow: "#facc15",
      brightBlue: "#ddd6fe",
      brightMagenta: "#d8b4fe",
      brightCyan: "#a5f3fc",
      brightWhite: "#fafafa",
    },
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    accentColor: "#f5e0dc",
    secondaryColor: "#cba6f7",
    foregroundColor: "#cdd6f4",
    bgBase: "30, 30, 46",
    terminalBgOpacity: 0.82,
    ansiColors: {
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#cba6f7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#cba6f7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    accentColor: "#7aa2f7",
    secondaryColor: "#bb9af7",
    foregroundColor: "#c0caf5",
    bgBase: "26, 27, 38",
    terminalBgOpacity: 0.8,
    ansiColors: {
      black: "#1a1b26",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    accentColor: "#bd93f9",
    secondaryColor: "#ff79c6",
    foregroundColor: "#f8f8f2",
    bgBase: "40, 42, 54",
    terminalBgOpacity: 0.82,
    ansiColors: {
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "nord",
    name: "Nord",
    accentColor: "#88c0d0",
    secondaryColor: "#b48ead",
    foregroundColor: "#eceff4",
    bgBase: "46, 52, 64",
    terminalBgOpacity: 0.84,
    ansiColors: {
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  {
    id: "rose-pine",
    name: "Ros\u00e9 Pine",
    accentColor: "#ebbcba",
    secondaryColor: "#c4a7e7",
    foregroundColor: "#e0def4",
    bgBase: "25, 23, 36",
    terminalBgOpacity: 0.8,
    ansiColors: {
      black: "#26233a",
      red: "#eb6f92",
      green: "#9ccfd8",
      yellow: "#f6c177",
      blue: "#31748f",
      magenta: "#c4a7e7",
      cyan: "#9ccfd8",
      white: "#e0def4",
      brightBlack: "#6e6a86",
      brightRed: "#eb6f92",
      brightGreen: "#9ccfd8",
      brightYellow: "#f6c177",
      brightBlue: "#31748f",
      brightMagenta: "#c4a7e7",
      brightCyan: "#9ccfd8",
      brightWhite: "#e0def4",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox Dark",
    accentColor: "#fe8019",
    secondaryColor: "#d3869b",
    foregroundColor: "#ebdbb2",
    bgBase: "40, 40, 40",
    terminalBgOpacity: 0.84,
    ansiColors: {
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },
  {
    id: "solarized",
    name: "Solarized Dark",
    accentColor: "#b58900",
    secondaryColor: "#6c71c4",
    foregroundColor: "#839496",
    bgBase: "0, 43, 54",
    terminalBgOpacity: 0.88,
    ansiColors: {
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#859900",
      brightYellow: "#b58900",
      brightBlue: "#268bd2",
      brightMagenta: "#6c71c4",
      brightCyan: "#2aa198",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "synthwave",
    name: "Synthwave '84",
    accentColor: "#f97e72",
    secondaryColor: "#ff7edb",
    foregroundColor: "#ffffff",
    bgBase: "34, 20, 50",
    terminalBgOpacity: 0.75,
    ansiColors: {
      black: "#2b213a",
      red: "#fe4450",
      green: "#72f1b8",
      yellow: "#fede5d",
      blue: "#36f9f6",
      magenta: "#ff7edb",
      cyan: "#36f9f6",
      white: "#ffffff",
      brightBlack: "#614d85",
      brightRed: "#fe4450",
      brightGreen: "#72f1b8",
      brightYellow: "#fede5d",
      brightBlue: "#36f9f6",
      brightMagenta: "#ff7edb",
      brightCyan: "#36f9f6",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "everforest",
    name: "Everforest",
    accentColor: "#a7c080",
    secondaryColor: "#d699b6",
    foregroundColor: "#d3c6aa",
    bgBase: "39, 48, 43",
    terminalBgOpacity: 0.84,
    ansiColors: {
      black: "#343f44",
      red: "#e67e80",
      green: "#a7c080",
      yellow: "#dbbc7f",
      blue: "#7fbbb3",
      magenta: "#d699b6",
      cyan: "#83c092",
      white: "#d3c6aa",
      brightBlack: "#4a555b",
      brightRed: "#e67e80",
      brightGreen: "#a7c080",
      brightYellow: "#dbbc7f",
      brightBlue: "#7fbbb3",
      brightMagenta: "#d699b6",
      brightCyan: "#83c092",
      brightWhite: "#d3c6aa",
    },
  },
];

export const DEFAULT_FONT_FAMILY =
  "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Berkeley Mono', 'SF Mono', 'Menlo', monospace";

export const DEFAULT_ANSI_COLORS: AnsiColors = {
  black: "#18181b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#eab308",
  blue: "#c4b5fd",
  magenta: "#a855f7",
  cyan: "#67e8f9",
  white: "#e4e4e7",
  brightBlack: "#52525b",
  brightRed: "#fb7185",
  brightGreen: "#86efac",
  brightYellow: "#facc15",
  brightBlue: "#ddd6fe",
  brightMagenta: "#d8b4fe",
  brightCyan: "#a5f3fc",
  brightWhite: "#fafafa",
};

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  shellPath: "",
  scrollbackLines: 10000,

  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.2,
  cursorStyle: "block",
  cursorBlink: true,

  themePreset: "obsidian",
  accentColor: "#eab308",
  secondaryColor: "#a855f7",
  terminalBgOpacity: 0.68,
  foregroundColor: "#f4f4f5",
  bgBase: "7, 7, 10",
  ansiColors: { ...DEFAULT_ANSI_COLORS },

  terminalBloom: true,
  bloomIntensity: 1.0,

  webMirrorPort: 3000,
  autoStartWebMirror: false,

  packageRunner: "bun",

  paneGap: 2,
  sidebarWidth: 304,
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
    paneGap: clamp(Math.round(s.paneGap), 0, 20),
    sidebarWidth: clamp(Math.round(s.sidebarWidth), 200, 600),
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
