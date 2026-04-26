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

  /** OSC 9;4 progress passthrough. When true, the xterm OSC 9
   *  handler decodes ConEmu-style progress messages (`ESC ] 9 ; 4 ; …`)
   *  and bridges them to the workspace progress bar. Default true.
   *  Disable if a tool emits OSC 9;4 noise you don't want surfaced. */
  terminalOsc94Enabled: boolean;

  /** Pinned `git config --global user.name` checked at startup by
   *  the audit module (`src/bun/audits.ts`). Mismatch surfaces a
   *  warn-level audit result with a one-step fix. Null disables the
   *  audit so collaborators on this project don't get false alarms.
   *  Default: `"olivierveinand"` per the original ask in
   *  `doc/issues_now.md`. */
  auditsGitUserNameExpected: string | null;

  /** Plan #03 — when true, a notification carrying a `surface_id`
   *  also pops a transient overlay card anchored over that surface.
   *  Independent from the sidebar list (the sidebar always tracks
   *  every notification regardless). Default true. */
  notificationOverlayEnabled: boolean;
  /** Auto-dismiss duration for the overlay card, in ms. 0 disables
   *  auto-dismiss (overlay stays until clicked). Hover pauses the
   *  timer; the remaining duration restarts on mouseleave. */
  notificationOverlayMs: number;

  /** Sidebar workspace-card density. Drives padding + font-size
   *  scale via the `[data-ws-card-density]` attribute on the
   *  sidebar root. Plan #06 — users can choose how much vertical
   *  real estate each workspace card takes. */
  workspaceCardDensity: "compact" | "comfortable" | "spacious";
  /** Sidebar workspace card subfield toggles. Each flag gates
   *  whether the corresponding section is rendered for the active
   *  workspace. Defaults to true so an upgrade from a pre-Plan-#06
   *  settings file keeps rendering everything until the user opts
   *  out. */
  workspaceCardShowMeta: boolean;
  workspaceCardShowStats: boolean;
  workspaceCardShowPanes: boolean;
  workspaceCardShowManifests: boolean;
  workspaceCardShowStatusPills: boolean;
  workspaceCardShowProgress: boolean;

  /** τ-mux §11 bloom gate. Stamped by SettingsManager the first time
   *  a pre-τ-mux settings file is loaded; we also snapshot the user's
   *  pre-migration bloomIntensity into `legacyBloomIntensity` so
   *  "Restore previous bloom" stays one click away. Never surfaced in
   *  the UI — purely a migration stamp. */
  bloomMigratedToTau: boolean;
  legacyBloomIntensity: number;

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

  // Notifications
  /** Master toggle for the arrival cue when a sidebar notification
   *  lands. Dismissing individual notifications is always silent; this
   *  gate only controls the `finish.mp3` one-shot. */
  notificationSoundEnabled: boolean;
  /** Playback volume for the arrival cue. 0 is silent, 1 is full
   *  volume. Drives `HTMLAudioElement.volume` on every play. */
  notificationSoundVolume: number;

  // Advanced
  paneGap: number;
  sidebarWidth: number;

  /** τ-mux layout variant per design guideline §9.
   *  - "bridge"  — refined default. 240 px sidebar, 1 large + 1 utility
   *                + 1 wide pane split, status bar with Codex/Week/$.
   *  - "cockpit" — 52 px icon rail + per-pane HUD strip; up to 4 panes.
   *  - "atlas"   — workspace graph sidebar + activity ticker bottom bar.
   *  Source: design_guidelines/Design Guidelines tau-mux.md §9. */
  layoutVariant: "bridge" | "cockpit" | "atlas";

  /** Ordered list of status-key ids displayed in the bottom status
   *  bar across every variant. The full registry lives in
   *  `src/views/terminal/status-keys.ts`; user picks which to show
   *  and in what order from Settings → Layout. Unknown ids are
   *  dropped by validateSettings so stale configs don't crash the
   *  renderer. Empty array = empty bar (allowed). */
  statusBarKeys: string[];

  /** Custom display order for `ht set-status` keys. Keys not listed
   *  fall back to the insertion order in the bun-side `htKeysSeen`
   *  set. Empty array = pure insertion order. Used by the `ht-all`
   *  bottom-bar renderer and the sidebar workspace card status grid
   *  so a user's reorder choice applies in both places. */
  htStatusKeyOrder: string[];

  /** Subset of seen `ht set-status` keys the user has unchecked in
   *  Settings → Layout → Discovered ht keys. Hidden keys are filtered
   *  out of `ht-all` and the sidebar status grid. New keys default
   *  to visible (absent from this list) so a script doesn't have to
   *  ask permission to surface a new metric. */
  htStatusKeyHidden: string[];

  // Browser
  /** Search engine for browser address bar non-URL queries. */
  browserSearchEngine: "google" | "duckduckgo" | "bing" | "kagi";
  /** Default URL when opening a new browser pane (empty = about:blank). */
  browserHomePage: string;
  /** Force dark mode on web pages via CSS injection. */
  browserForceDarkMode: boolean;
  /** Open terminal URL clicks in the built-in browser instead of externally. */
  browserInterceptTerminalLinks: boolean;

  // Telegram
  /** Master switch — when off the long-poll loop is not started even if a
   *  token is configured. */
  telegramEnabled: boolean;
  /** Bot API token from @BotFather. Stored unencrypted alongside other
   *  secrets in settings.json (same trust model as `webMirrorAuthToken`). */
  telegramBotToken: string;
  /** Comma-separated list of Telegram numeric user IDs allowed to message
   *  the bot. Empty = accept from anyone (not recommended). Whitespace
   *  around entries is trimmed. */
  telegramAllowedUserIds: string;
  /** Forward sidebar notifications to Telegram when on. Independent of
   *  `notificationSoundEnabled`. */
  telegramNotificationsEnabled: boolean;
  /** Plan #08: when on, every forwarded notification carries an
   *  inline keyboard (OK / Continue / Stop). Tapped buttons fire
   *  the corresponding action on the originating surface — Continue
   *  sends a newline; Stop sends Ctrl-C; OK dismisses the
   *  notification. Off by default — the buttons execute keystrokes
   *  on the user's machine. */
  telegramNotificationButtonsEnabled: boolean;
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
    id: "tau",
    name: "τ-mux",
    // Cyan = humans + focus + system identity. Amber = agents.
    // Sealed by the τ-mux design guideline §7; other themes can exist
    // but this is the default.
    accentColor: "#6fe9ff",
    secondaryColor: "#ffc56b",
    foregroundColor: "#d6e2e8",
    // Pure black terminal body on --tau-bg #07090b window (see §1).
    bgBase: "0, 0, 0",
    terminalBgOpacity: 1,
    ansiColors: createAnsiPalette([
      "#0b1013",
      "#ff8a8a",
      "#8ce99a",
      "#ffc56b",
      "#6fe9ff",
      "#d6bfff",
      "#8ce9ff",
      "#d6e2e8",
      "#38434a",
      "#ff8a8a",
      "#8ce99a",
      "#ffc56b",
      "#6fe9ff",
      "#d6bfff",
      "#8ce9ff",
      "#f4f9fb",
    ]),
  },
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
  lineHeight: 1.0,
  cursorStyle: "block",
  cursorBlink: true,

  themePreset: THEME_PRESETS[0].id,
  accentColor: THEME_PRESETS[0].accentColor,
  secondaryColor: THEME_PRESETS[0].secondaryColor,
  terminalBgOpacity: THEME_PRESETS[0].terminalBgOpacity,
  foregroundColor: THEME_PRESETS[0].foregroundColor,
  bgBase: THEME_PRESETS[0].bgBase,
  ansiColors: { ...THEME_PRESETS[0].ansiColors },

  // τ-mux §4 + §11: bloom is OFF by design. The design system uses
  // only the focused-pane glow; a chrome-wide WebGL bloom pass
  // competes with that signal and also costs CPU/GPU while being
  // non-deterministic for visual-regression tests. Users can still
  // opt in from Settings → Effects — when they do, SettingsManager
  // bumps bloomIntensity to 1 so the toggle gives immediate visible
  // effect. Fresh installs start at 0 so enabling the toggle without
  // adjusting the slider is a no-op (prevents surprise glow).
  terminalBloom: false,
  bloomIntensity: 0,
  terminalOsc94Enabled: true,
  auditsGitUserNameExpected: "olivierveinand",
  notificationOverlayEnabled: true,
  notificationOverlayMs: 6000,
  workspaceCardDensity: "comfortable",
  workspaceCardShowMeta: true,
  workspaceCardShowStats: true,
  workspaceCardShowPanes: true,
  workspaceCardShowManifests: true,
  workspaceCardShowStatusPills: true,
  workspaceCardShowProgress: true,
  bloomMigratedToTau: false,
  legacyBloomIntensity: 0,

  webMirrorPort: 3000,
  autoStartWebMirror: false,
  webMirrorBind: "0.0.0.0",
  webMirrorAuthToken: "",

  packageRunner: "bun",

  notificationSoundEnabled: true,
  notificationSoundVolume: 1.0,

  paneGap: 2,
  sidebarWidth: 320,

  // τ-mux §9 default variant.
  layoutVariant: "bridge",
  // Sensible default status-key set — covers identity, load, the
  // focused-surface detail columns, plus the `ht set-status`
  // catch-all so scripts that publish workspace status via
  // `ht set-status <key> <value>` are immediately visible. Users
  // can edit this list in Settings → Layout.
  statusBarKeys: [
    "workspace",
    "panes",
    "cpu",
    "mem",
    "procs",
    "fg",
    "cwd",
    "branch",
    "ht-all",
    "ports",
    "time",
  ],
  htStatusKeyOrder: [],
  htStatusKeyHidden: [],

  browserSearchEngine: "google",
  browserHomePage: "",
  browserForceDarkMode: false,
  browserInterceptTerminalLinks: false,

  telegramEnabled: false,
  telegramBotToken: "",
  // Pre-fill the user's own ID so the bot ignores DMs from random
  // accounts the moment it goes live. Trim/edit in Settings → Telegram.
  telegramAllowedUserIds: "8446656662",
  telegramNotificationsEnabled: false,
  telegramNotificationButtonsEnabled: false,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Normalize a comma-separated list of Telegram user IDs: trim whitespace,
 *  drop entries that aren't strings of digits, dedupe while preserving order.
 *  Empty input → "" (allow-all). */
function normalizeAllowedIds(input: string | undefined | null): string {
  if (!input) return "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.join(",");
}

/** Parse the persisted comma-list into a Set for fast lookup at message
 *  arrival. Mirrors `normalizeAllowedIds` exactly — drops non-numeric
 *  entries and dedupes — so the storage and runtime paths stay in
 *  lockstep regardless of input source. Empty set means "allow all" —
 *  callers should branch on `.size`. */
export function parseAllowedTelegramIds(value: string): Set<string> {
  const out = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    out.add(trimmed);
  }
  return out;
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
    notificationSoundEnabled: !!s.notificationSoundEnabled,
    notificationSoundVolume: clamp(s.notificationSoundVolume, 0, 1),
    browserSearchEngine:
      s.browserSearchEngine === "duckduckgo" ||
      s.browserSearchEngine === "bing" ||
      s.browserSearchEngine === "kagi"
        ? s.browserSearchEngine
        : "google",
    browserHomePage: (s.browserHomePage ?? "").trim(),
    browserForceDarkMode: !!s.browserForceDarkMode,
    browserInterceptTerminalLinks: !!s.browserInterceptTerminalLinks,
    telegramEnabled: !!s.telegramEnabled,
    telegramBotToken: (s.telegramBotToken ?? "").trim(),
    telegramAllowedUserIds: normalizeAllowedIds(s.telegramAllowedUserIds),
    telegramNotificationsEnabled: !!s.telegramNotificationsEnabled,
    telegramNotificationButtonsEnabled:
      typeof s.telegramNotificationButtonsEnabled === "boolean"
        ? s.telegramNotificationButtonsEnabled
        : false,
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
    layoutVariant:
      s.layoutVariant === "cockpit" || s.layoutVariant === "atlas"
        ? s.layoutVariant
        : "bridge",
    statusBarKeys: Array.isArray(s.statusBarKeys)
      ? (s.statusBarKeys.filter(
          (k): k is string => typeof k === "string" && k.length > 0,
        ) as string[])
      : ["workspace", "panes", "cpu", "mem", "fg", "cwd", "branch", "time"],
    bloomMigratedToTau: !!s.bloomMigratedToTau,
    legacyBloomIntensity: clamp(
      typeof s.legacyBloomIntensity === "number" ? s.legacyBloomIntensity : 0,
      0,
      2,
    ),
    terminalOsc94Enabled:
      typeof s.terminalOsc94Enabled === "boolean"
        ? s.terminalOsc94Enabled
        : true,
    auditsGitUserNameExpected:
      s.auditsGitUserNameExpected === null
        ? null
        : typeof s.auditsGitUserNameExpected === "string" &&
            s.auditsGitUserNameExpected.length > 0
          ? s.auditsGitUserNameExpected
          : "olivierveinand",
    notificationOverlayEnabled:
      typeof s.notificationOverlayEnabled === "boolean"
        ? s.notificationOverlayEnabled
        : true,
    notificationOverlayMs:
      typeof s.notificationOverlayMs === "number" &&
      Number.isFinite(s.notificationOverlayMs) &&
      s.notificationOverlayMs >= 0
        ? Math.min(60_000, Math.max(0, Math.floor(s.notificationOverlayMs)))
        : 6000,
    workspaceCardDensity:
      s.workspaceCardDensity === "compact" ||
      s.workspaceCardDensity === "spacious"
        ? s.workspaceCardDensity
        : "comfortable",
    workspaceCardShowMeta:
      typeof s.workspaceCardShowMeta === "boolean"
        ? s.workspaceCardShowMeta
        : true,
    workspaceCardShowStats:
      typeof s.workspaceCardShowStats === "boolean"
        ? s.workspaceCardShowStats
        : true,
    workspaceCardShowPanes:
      typeof s.workspaceCardShowPanes === "boolean"
        ? s.workspaceCardShowPanes
        : true,
    workspaceCardShowManifests:
      typeof s.workspaceCardShowManifests === "boolean"
        ? s.workspaceCardShowManifests
        : true,
    workspaceCardShowStatusPills:
      typeof s.workspaceCardShowStatusPills === "boolean"
        ? s.workspaceCardShowStatusPills
        : true,
    workspaceCardShowProgress:
      typeof s.workspaceCardShowProgress === "boolean"
        ? s.workspaceCardShowProgress
        : true,
    htStatusKeyOrder: Array.isArray(s.htStatusKeyOrder)
      ? (s.htStatusKeyOrder.filter(
          (k): k is string => typeof k === "string" && k.length > 0,
        ) as string[])
      : [],
    htStatusKeyHidden: Array.isArray(s.htStatusKeyHidden)
      ? (s.htStatusKeyHidden.filter(
          (k): k is string => typeof k === "string" && k.length > 0,
        ) as string[])
      : [],
  };
}

/** Compose the final ordered list of visible `ht set-status` keys
 *  from a discovered-key set + user's order/hide preferences.
 *
 *  Pure helper so the bottom-bar `ht-all` renderer, the sidebar
 *  workspace card, and tests can all share a single source of truth.
 *
 *  Algorithm:
 *    1. Start with `htStatusKeyOrder` (user's customised order).
 *    2. Append any `seen` keys not yet listed, in their original
 *       insertion order — so newly-published keys land at the end.
 *    3. Drop anything in `htStatusKeyHidden`.
 *    4. Drop anything not in `seen` (a key might be in
 *       `htStatusKeyOrder` from a previous session but no longer
 *       firing — leave the entry as-is in settings, just don't
 *       render).
 */
export function applyHtStatusKeySettings(
  seen: readonly string[],
  order: readonly string[],
  hidden: readonly string[],
): string[] {
  const seenSet = new Set(seen);
  const hiddenSet = new Set(hidden);
  const visited = new Set<string>();
  const out: string[] = [];
  for (const k of order) {
    if (visited.has(k)) continue;
    visited.add(k);
    if (!seenSet.has(k) || hiddenSet.has(k)) continue;
    out.push(k);
  }
  for (const k of seen) {
    if (visited.has(k)) continue;
    visited.add(k);
    if (hiddenSet.has(k)) continue;
    out.push(k);
  }
  return out;
}

/** τ-mux §11 bloom gate — run once per install on the first load of a
 *  pre-revamp settings file. Snapshots the user's bloom intensity into
 *  `legacyBloomIntensity` so it can be restored from a future UI; does
 *  NOT flip `terminalBloom` off (that would remove a feature the user
 *  chose). The only side effect is the stamp + snapshot. */
export function applyBloomMigration(settings: AppSettings): AppSettings {
  if (settings.bloomMigratedToTau) return settings;
  const legacy = settings.bloomIntensity > 0 ? settings.bloomIntensity : 0;
  return {
    ...settings,
    bloomMigratedToTau: true,
    legacyBloomIntensity: legacy,
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
