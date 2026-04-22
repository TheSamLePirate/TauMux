import { Electroview } from "electrobun/view";
import type {
  TauMuxRPC,
  NativeContextMenuRequest,
  SurfaceContextMenuRequest,
} from "../../shared/types";
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
} from "../../shared/settings";
import { SurfaceManager } from "./surface-manager";
import { CommandPalette, type PaletteCommand } from "./command-palette";
import { createIcon } from "./icons";
import { IconTau } from "./tau-icons";
import { StatusBar } from "./tau-primitives";
import { renderStatusKey, type StatusContext } from "./status-keys";
// Side-effect import: installs window.tauAuditFocus() for DevTools usage.
import "./tau-focus-audit";
import { VariantController } from "./variants/controller";
import type { VariantId } from "./variants/types";
import { showPromptDialog } from "./prompt-dialog";
import { ProcessManagerPanel } from "./process-manager";
import { SettingsPanel } from "./settings-panel";
import { SurfaceDetailsPanel } from "./surface-details";
import { showToast } from "./toast";
import { registerAgentEvents } from "./agent-events";
import { registerBrowserEvents } from "./browser-events";
import { createSocketActionDispatcher } from "./socket-actions";
import { createTestActionRouter } from "./__test-handlers";
import {
  type Binding,
  dispatchKeyboardEvent,
  keyMatch,
} from "./keyboard-shortcuts";

// Declared before rpc so handlers can reference it; assigned after rpc is created.
// eslint-disable-next-line prefer-const
let surfaceManager: SurfaceManager;

const sidebarEl = document.getElementById("sidebar")!;
const terminalContainerEl = document.getElementById("terminal-container")!;
const titlebarEl = document.getElementById("titlebar")!;
const sidebarToggleBtn = document.getElementById(
  "sidebar-toggle-btn",
) as HTMLButtonElement | null;
const commandPaletteBtn = document.getElementById(
  "command-palette-btn",
) as HTMLButtonElement | null;
const newWorkspaceBtn = document.getElementById(
  "new-workspace-btn",
) as HTMLButtonElement | null;
const splitRightBtn = document.getElementById(
  "split-right-btn",
) as HTMLButtonElement | null;
const splitDownBtn = document.getElementById(
  "split-down-btn",
) as HTMLButtonElement | null;
const titlebarBadgeLabelEl = document.getElementById("titlebar-badge-text");
const workspaceCountLabelEl = document.getElementById(
  "toolbar-workspace-count-label",
);
const paneCountLabelEl = document.getElementById("toolbar-pane-count-label");
const TERMINAL_EFFECTS_STORAGE_KEY =
  "hyperterm-canvas.terminal-effects.enabled";
const FONT_SIZE_STORAGE_KEY = "hyperterm-canvas.font-size";
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;
let typingFocusActive = false;

const rpc = Electroview.defineRPC<TauMuxRPC>({
  handlers: {
    messages: {
      writeStdout: (payload) => {
        surfaceManager.writeToSurface(payload.surfaceId, payload.data);
      },
      surfaceCreated: (payload) => {
        if (payload.launchFor) {
          surfaceManager.addSurfaceToWorkspace(
            payload.surfaceId,
            payload.title,
            payload.launchFor.workspaceId,
          );
          surfaceManager.registerScriptSurface(
            payload.surfaceId,
            payload.launchFor.workspaceId,
            payload.launchFor.scriptKey,
          );
        } else if (payload.splitFrom && payload.direction) {
          surfaceManager.addSurfaceAsSplit(
            payload.surfaceId,
            payload.title,
            payload.splitFrom,
            payload.direction,
          );
        } else {
          surfaceManager.addSurface(payload.surfaceId, payload.title);
        }
      },
      surfaceExited: (payload) => {
        surfaceManager.handleSurfaceExit(payload.surfaceId, payload.exitCode);
      },
      surfaceClosed: (payload) => {
        surfaceManager.removeSurface(payload.surfaceId);
      },
      browserSurfaceCreated: (payload) => {
        if (payload.splitFrom && payload.direction) {
          surfaceManager.addBrowserSurfaceAsSplit(
            payload.surfaceId,
            payload.url,
            payload.splitFrom,
            payload.direction,
          );
        } else {
          surfaceManager.addBrowserSurface(payload.surfaceId, payload.url);
        }
      },
      browserSurfaceClosed: (payload) => {
        surfaceManager.removeBrowserSurface(payload.surfaceId);
      },
      browserInjectCookies: (payload) => {
        surfaceManager.browserInjectCookies(payload.surfaceId, payload.cookies);
      },
      cookieExportResult: (payload) => {
        // Trigger file download in the webview
        try {
          const ext = payload.format === "netscape" ? "txt" : "json";
          const mime =
            payload.format === "netscape" ? "text/plain" : "application/json";
          const blob = new Blob([payload.data], { type: mime });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `cookies.${ext}`;
          a.click();
          URL.revokeObjectURL(a.href);
        } catch {
          /* ignore download errors */
        }
      },
      cookieActionResult: (payload) => {
        if (payload.message) {
          showToast(payload.message, "success");
        }
      },
      // Agent surface messages are routed via socketAction (proven channel)
      // rather than dedicated RPC message types.
      sidebandMeta: (payload) => {
        surfaceManager.handleSidebandMeta(payload.surfaceId, payload);
      },
      sidebandData: (payload) => {
        surfaceManager.handleSidebandData(
          payload.surfaceId,
          payload.id,
          payload.data,
        );
      },
      sidebandDataFailed: (payload) => {
        surfaceManager.handleSidebandDataFailed(
          payload.surfaceId,
          payload.id,
          payload.reason,
        );
      },
      webServerStatus: (payload) => {
        surfaceManager
          .getSidebar()
          .setWebServerStatus(payload.running, payload.port, payload.url);
      },
      restoreSettings: (payload) => {
        applySettings(payload.settings);
      },
      settingsChanged: (payload) => {
        applySettings(payload.settings);
      },
      restoreLayout: (payload) => {
        surfaceManager.restoreLayout(payload.layout, payload.surfaceMapping);
      },
      socketAction: (payload) => {
        handleSocketAction(payload.action, payload.payload);
      },
      enableTestMode: (payload) => {
        // Tier 2 runtime gate. Bun flips this only under HYPERTERM_TEST_MODE=1
        // + /tmp configDir (see src/bun/index.ts). The webview's test action
        // router refuses to handle anything until this flag is true.
        window.__htTestMode__ = payload.enabled === true;
      },
      // ── Telegram surface lifecycle (bun → webview) ──
      telegramSurfaceCreated: (payload) => {
        if (payload.splitFrom && payload.direction) {
          surfaceManager.addTelegramSurfaceAsSplit(
            payload.surfaceId,
            payload.splitFrom,
            payload.direction,
          );
        } else {
          surfaceManager.addTelegramSurface(payload.surfaceId);
        }
      },
      telegramMessage: (payload) => {
        surfaceManager.handleTelegramMessage(payload.message);
      },
      telegramHistory: (payload) => {
        surfaceManager.handleTelegramHistory(payload);
      },
      telegramState: (payload) => {
        surfaceManager.handleTelegramState(payload);
        surfaceManager.getSidebar().setTelegramStatus(payload.status);
      },
      // Note: browser navigation commands from socket API go through socketAction
      surfaceMetadata: (payload) => {
        surfaceManager.setSurfaceMetadata(payload.surfaceId, payload.metadata);
        processManagerPanel.refresh();
        if (
          surfaceDetailsPanel.isVisible() &&
          surfaceDetailsPanel.currentSurface() === payload.surfaceId
        ) {
          surfaceDetailsPanel.refresh();
        }
      },
    },
    requests: {
      readScreen: (params) => {
        return surfaceManager.readScreen(
          params.surfaceId,
          params.lines,
          params.scrollback,
        );
      },
    },
  },
});

surfaceManager = new SurfaceManager(
  terminalContainerEl,
  sidebarEl,
  (surfaceId, data) => rpc.send("writeStdin", { surfaceId, data }),
  (surfaceId, cols, rows) => rpc.send("resize", { surfaceId, cols, rows }),
  (surfaceId, event) => rpc.send("panelEvent", { ...event, surfaceId }),
  loadFontSize(),
);
surfaceManager.setTerminalEffectsEnabled(loadTerminalEffectsEnabled());

// τ-mux variants (Cockpit / Atlas) need a reference to surfaceManager
// to read workspace state and dispatch workspace switches without
// taking a circular import on index.ts. Installing on window is the
// same escape hatch index.ts already uses for panel registrations.
(
  window as unknown as { __tauSurfaceManager: SurfaceManager }
).__tauSurfaceManager = surfaceManager;

let currentSettings: AppSettings | null = null;
let variantController: VariantController | null = null;

const settingsPanel = new SettingsPanel((partial) => {
  // Apply eagerly on the webview side — don't wait for bun roundtrip
  const base = currentSettings ?? DEFAULT_SETTINGS;
  const merged = mergeSettings(base, partial);
  applySettings(merged);
  // Send to bun for persistence
  rpc.send("updateSettings", { settings: partial });
});

function applySettings(settings: AppSettings): void {
  currentSettings = settings;
  surfaceManager.applySettings(settings);
  if (settingsPanel.isVisible()) settingsPanel.updateSettings(settings);
  // τ-mux §9 — variant controller. Lazily constructed on first
  // applySettings so #tau-status-bar (mounted by mountStatusBar()) is
  // guaranteed to exist. Every subsequent call routes through
  // `refresh()` which transitions variants only when the id changes.
  if (!variantController) {
    variantController = new VariantController({
      settings,
      updateSettings: (partial) => {
        const base2 = currentSettings ?? DEFAULT_SETTINGS;
        const merged2 = mergeSettings(base2, partial);
        applySettings(merged2);
        rpc.send("updateSettings", { settings: partial });
      },
    });
  } else {
    variantController.refresh(settings);
  }
  syncPaletteCommands();
}

/** Switch to a specific τ-mux variant. Called from the command
 *  palette and (in Phase 9) from the settings panel. */
function setLayoutVariant(id: VariantId): void {
  if (!variantController) {
    // No controller yet → mutate the setting and let applySettings
    // build the controller on the correct initial variant.
    const base = currentSettings ?? DEFAULT_SETTINGS;
    const merged = mergeSettings(base, { layoutVariant: id });
    applySettings(merged);
    rpc.send("updateSettings", { settings: { layoutVariant: id } });
    return;
  }
  variantController.setVariant(id);
}

function openSettings(): void {
  clearTypingFocusMode();
  surfaceManager.hideBrowserWebviews();
  settingsPanel.show(currentSettings ?? DEFAULT_SETTINGS);
}

const processManagerPanel = new ProcessManagerPanel({
  getData: () => surfaceManager.getProcessManagerData(),
  onKill: (pid, signal) => {
    rpc.send("killPid", { pid, signal });
  },
});

function toggleProcessManager(): void {
  if (!processManagerPanel.isVisible()) {
    clearTypingFocusMode();
    surfaceManager.hideBrowserWebviews();
  } else {
    surfaceManager.showBrowserWebviews();
  }
  processManagerPanel.toggle();
  syncPaletteCommands();
}

/**
 * Send the split request with the active workspace's cwd attached. Falls
 * back bun-side to the splitFrom pane's live cwd if we send `undefined`.
 */
function requestSplit(direction: "horizontal" | "vertical"): void {
  const cwd = surfaceManager.getActiveWorkspaceCwd() ?? undefined;
  rpc.send("splitSurface", { direction, cwd });
}

const surfaceDetailsPanel = new SurfaceDetailsPanel({
  getRef: (surfaceId) => surfaceManager.getSurfaceDetailsRef(surfaceId),
  onKillPid: (pid, signal) => rpc.send("killPid", { pid, signal }),
  onOpenUrl: (url) => rpc.send("openExternal", { url }),
});

function showSurfaceInfo(surfaceId: string | null): void {
  const target =
    surfaceId ??
    surfaceManager.getActiveSurfaceId() ??
    surfaceManager.getSurfaceDetailsRef(
      surfaceManager.getActiveSurfaceId() ?? "",
    )?.id ??
    null;
  if (!target) return;
  clearTypingFocusMode();
  surfaceDetailsPanel.showFor(target);
  syncPaletteCommands();
}

function toggleFocusedSurfaceInfo(): void {
  const active = surfaceManager.getActiveSurfaceId();
  if (!active) return;
  if (!surfaceDetailsPanel.isVisible()) clearTypingFocusMode();
  surfaceDetailsPanel.toggleFor(active);
  syncPaletteCommands();
}

new Electroview({ rpc });

let resizeTimer: ReturnType<typeof setTimeout> | null = null;

function mountTitlebarIcons() {
  const buttons: Array<
    [HTMLButtonElement | null, Parameters<typeof createIcon>[0]]
  > = [
    [sidebarToggleBtn, "sidebar"],
    [commandPaletteBtn, "command"],
    [newWorkspaceBtn, "plus"],
    [splitRightBtn, "splitHorizontal"],
    [splitDownBtn, "splitVertical"],
  ];

  for (const [button, iconName] of buttons) {
    if (!button) continue;
    button.replaceChildren(createIcon(iconName));
  }

  // Pixel-τ logo per τ-mux §5/§6. Replaces the old icon.png background
  // with the guideline-prescribed <rect>-based SVG. The glow is applied
  // via `.titlebar-app-icon`'s CSS drop-shadow filter.
  const appIconEl = document.getElementById("titlebar-app-icon");
  if (appIconEl) appIconEl.replaceChildren(IconTau({ size: 14 }));
}

function mountStatusBar() {
  // τ-mux §8.3 StatusBar skeleton. The StatusBar primitive creates
  // four zones (identity · meters · spacer · cost) and exposes setters
  // so any subsystem can swap its content without rebuilding the bar.
  const mount = document.getElementById(
    "tau-status-bar",
  ) as HTMLDivElement | null;
  if (!mount) return;
  statusBarHandle = StatusBar(mount);
  // Initial identity zone — pane count populated by syncStatusBar().
  refreshStatusBar();
}

// StatusBar primitive handle populated by mountStatusBar(); every
// workspace / settings / surface change routes through refreshStatusBar.
let statusBarHandle: ReturnType<typeof StatusBar> | null = null;

/**
 * Structured bottom-bar data shared across Bridge / Cockpit / Atlas.
 * Three zones:
 *   identity — active workspace name (coloured dot) + pane count + ws count
 *   meters   — aggregated CPU + MEM across the active workspace
 *   cost     — focused surface's fg command + cwd (Mono, paste-safe)
 */
/**
 * Key-driven status bar: iterates the user's `statusBarKeys` setting
 * and renders each key via the registry. Shared by Bridge, Cockpit,
 * and Atlas (Atlas passes the result through its own brand-cap
 * wrapper but builds the key list the same way).
 */
function refreshStatusBar(): void {
  if (!statusBarHandle) return;
  const ctx = buildStatusContext();
  const settings = currentSettings ?? DEFAULT_SETTINGS;
  const ids = settings.statusBarKeys ?? [];

  // Atlas owns #tau-status-bar's children (τ-brand + right-cap). If
  // we wipe them here the bar renders the keys directly into the bar
  // root, Atlas's CSS can't see them, and the brand cap disappears.
  // Route to the Atlas-specific mount when it exists; fall back to
  // the bar root otherwise (Bridge / Cockpit). This is the single
  // source of truth for which element receives status-key children.
  const atlasRight = document.getElementById("tau-atlas-ticker-right");
  const mount: HTMLElement = atlasRight ?? statusBarHandle.root;
  mount.replaceChildren();

  let first = true;
  let rendered = 0;
  for (const id of ids) {
    const el = renderStatusKey(id, ctx);
    if (!el) continue;
    if (!first) {
      const s = document.createElement("span");
      s.className = "tau-hud-sep";
      s.textContent = "·";
      mount.appendChild(s);
    }
    mount.appendChild(el);
    first = false;
    rendered++;
  }

  // If nothing rendered — either no keys enabled or none had data —
  // drop a neutral hint so the bar isn't silently empty.
  if (rendered === 0) {
    const hint = document.createElement("span");
    hint.className = "tau-status-label";
    hint.textContent =
      ids.length === 0
        ? "no status keys — enable some in Settings → Layout"
        : "no live status data yet";
    mount.appendChild(hint);
  }
}

function buildStatusContext(): StatusContext {
  const wsState = surfaceManager?.getWorkspaceState?.();
  const workspaces = (wsState?.workspaces ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    color: w.color,
    surfaceIds: w.surfaceIds,
  }));
  const activeId = wsState?.activeWorkspaceId;
  const activeWorkspace = workspaces.find((w) => w.id === activeId);
  const pmData = surfaceManager?.getProcessManagerData?.() ?? [];
  const pmActive = pmData.find((w) => w.id === activeId);
  const focusedId = surfaceManager?.getActiveSurfaceId?.() ?? null;
  const focusedSurface = pmActive?.surfaces.find((s) => s.id === focusedId);
  return {
    settings: currentSettings ?? DEFAULT_SETTINGS,
    workspaces,
    activeWorkspaceId: activeId,
    activeWorkspace,
    pmData,
    pmActive,
    focusedSurfaceId: focusedId,
    focusedSurface,
    notifyWorkspaces: lastNotifyWorkspaces,
    // `ht set-status` entries for the active workspace. Surfaced by
    // the `ht-status` / `ht-title` / `ht-warning` / `ht-all` keys.
    // Fall back to all-workspaces aggregated entries when the active
    // workspace has none — so a status set from any pane is visible
    // regardless of which workspace the user is currently viewing.
    htStatuses: (() => {
      const active = surfaceManager?.getWorkspaceStatuses?.(activeId) ?? [];
      if (active.length > 0) return active;
      const all = surfaceManager?.getAllStatuses?.();
      if (!all || all.size === 0) return [];
      const merged: {
        key: string;
        value: string;
        icon?: string;
        color?: string;
      }[] = [];
      for (const entries of all.values()) merged.push(...entries);
      return merged;
    })(),
    now: Date.now(),
  };
}

function handleResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    surfaceManager.resizeAll();
    const rect = terminalContainerEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      rpc.send("viewportSize", {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
  }, 200);
}

const resizeObserver = new ResizeObserver(handleResize);
resizeObserver.observe(terminalContainerEl);
// Disconnect the observer on navigation away / webview reload. Not
// strictly needed in the happy path (the webview is long-lived), but
// prevents duplicate observers if this module ever re-executes, and
// matches the discipline we apply elsewhere (PanelManager, browser
// pane listeners).
window.addEventListener("pagehide", () => {
  try {
    resizeObserver.disconnect();
  } catch {
    /* ignore */
  }
});
mountTitlebarIcons();
mountStatusBar();

// The Atlas variant replaces the #tau-status-bar children with its
// activity ticker; on exit it fires `tau-status-bar-reset` so the
// standard StatusBar can be rebuilt from scratch. (If nothing fired
// it, the cached statusBarHandle would still reference detached zone
// nodes and subsequent refreshStatusBar() calls would silently no-op.)
document
  .getElementById("tau-status-bar")
  ?.addEventListener("tau-status-bar-reset", () => {
    mountStatusBar();
    refreshStatusBar();
  });

// Every `ht set-status <key> <value>` lands in SurfaceManager.setStatus
// which dispatches `ht-statuses-changed`. Without this listener the
// bottom-bar ht-status / ht-warning / ht-title / ht-all keys would
// only repaint on the next workspace or focus event — scripts setting
// a status then idling would leave the bar stale.
window.addEventListener("ht-statuses-changed", () => {
  refreshStatusBar();
});

// DevTools helper: `window.tauDumpStatus()` prints the status-bar
// context so users can verify what the bottom bar is reading. Uses
// plain console.log + a single object payload instead of groups so
// the output lands in one line every DevTools shows, and returns
// the payload so the REPL prints it inline even if console is muted.
(
  window as unknown as { tauDumpStatus: () => Record<string, unknown> }
).tauDumpStatus = () => {
  const ctx = buildStatusContext();
  const allStatuses = surfaceManager?.getAllStatuses?.();
  const dumped = {
    activeWorkspaceId: ctx.activeWorkspaceId,
    activeWorkspaceName: ctx.activeWorkspace?.name ?? null,
    statusBarKeys: ctx.settings.statusBarKeys,
    htStatuses: ctx.htStatuses,
    allWorkspaceStatuses: allStatuses
      ? Object.fromEntries(allStatuses.entries())
      : "(not available)",
    statusBarHtml:
      document.getElementById("tau-status-bar")?.outerHTML.slice(0, 800) ??
      "(no #tau-status-bar)",
  };
  console.log("[τ-mux status dump]", dumped);
  return dumped;
};

// 1 Hz tick so status-keys that depend on the wall clock (time /
// uptime) and any live metadata snapshot the poll just produced stay
// fresh without waiting for a workspace / focus event.
setInterval(() => {
  refreshStatusBar();
}, 1000);

setTimeout(() => {
  rpc.send("resize", { surfaceId: "__init__", cols: 80, rows: 24 });
  const rect = terminalContainerEl.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    rpc.send("viewportSize", {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }
}, 300);

const palette = new CommandPalette();
syncPaletteCommands();

function loadTerminalEffectsEnabled(): boolean {
  try {
    return localStorage.getItem(TERMINAL_EFFECTS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function persistTerminalEffectsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(TERMINAL_EFFECTS_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage failures in restricted webviews.
  }
}

function toggleTerminalEffects(): void {
  const enabled = surfaceManager.toggleTerminalEffects();
  persistTerminalEffectsEnabled(enabled);
  syncPaletteCommands();
}

function loadFontSize(): number {
  try {
    const stored = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE) return n;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_FONT_SIZE;
}

function persistFontSize(size: number): void {
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(size));
  } catch {
    /* ignore */
  }
}

function changeFontSize(delta: number): void {
  const current = surfaceManager.getFontSize();
  const next = Math.max(
    MIN_FONT_SIZE,
    Math.min(MAX_FONT_SIZE, current + delta),
  );
  if (next === current) return;
  surfaceManager.setFontSize(next);
  persistFontSize(next);
}

function resetFontSize(): void {
  surfaceManager.setFontSize(DEFAULT_FONT_SIZE);
  persistFontSize(DEFAULT_FONT_SIZE);
}

function buildPaletteCommands(): PaletteCommand[] {
  const terminalEffectsEnabled = surfaceManager.areTerminalEffectsEnabled();

  return [
    {
      id: "new-workspace",
      category: "Workspace",
      label: "New Workspace",
      description: "Open a fresh shell workspace.",
      shortcut: "\u2318N",
      action: () => rpc.send("createSurface", {}),
    },
    {
      id: "split-right",
      category: "Layout",
      label: "Split Right",
      description: "Create a new pane to the right of the current one.",
      shortcut: "\u2318D",
      action: () => requestSplit("horizontal"),
    },
    {
      id: "split-down",
      category: "Layout",
      label: "Split Down",
      description: "Create a new pane below the current one.",
      shortcut: "\u2318\u21e7D",
      action: () => requestSplit("vertical"),
    },
    {
      id: "close-pane",
      category: "Layout",
      label: "Close Pane",
      description: "Close the currently focused terminal pane.",
      shortcut: "\u2318W",
      action: () => {
        const id = surfaceManager.getActiveSurfaceId();
        if (id) rpc.send("closeSurface", { surfaceId: id });
      },
    },
    {
      id: "toggle-sidebar",
      category: "View",
      label: "Toggle Sidebar",
      description: "Show or hide workspace navigation and activity.",
      shortcut: "\u2318B",
      action: () => toggleSidebar(),
    },
    // τ-mux §9 — three layout variants, switchable at runtime. The
    // active variant is persisted via updateSettings so the choice
    // survives restart and is observable from bun.
    {
      id: "layout-bridge",
      category: "Layout",
      label: "Layout: Bridge (default)",
      description:
        "Refined default. 240 px sidebar, 3-pane split, Codex / Week / $ status meters.",
      action: () => setLayoutVariant("bridge"),
    },
    {
      id: "layout-cockpit",
      category: "Layout",
      label: "Layout: Cockpit",
      description:
        "Dense. 52 px icon rail, per-pane HUD (model · state · tok/s · $ · Δ), up to 4 panes.",
      action: () => setLayoutVariant("cockpit"),
    },
    {
      id: "layout-atlas",
      category: "Layout",
      label: "Layout: Atlas",
      description:
        "Radical. Workspace graph sidebar, activity ticker bottom bar.",
      action: () => setLayoutVariant("atlas"),
    },
    {
      id: "toggle-terminal-effects",
      category: "View",
      label: terminalEffectsEnabled
        ? "Disable Terminal Bloom"
        : "Enable Terminal Bloom",
      description: terminalEffectsEnabled
        ? "Turn off the GPU blur, glow, and bloom pass over terminal pixels."
        : "Turn on the GPU blur, glow, and bloom pass over terminal pixels.",
      action: () => toggleTerminalEffects(),
    },
    {
      // Route through the normal settings pipeline so the persisted
      // value round-trips to disk and the settings panel reflects the
      // flip immediately.
      id: "toggle-notification-sound",
      category: "View",
      label:
        (currentSettings?.notificationSoundEnabled ?? true)
          ? "Mute Notification Sound"
          : "Unmute Notification Sound",
      description:
        (currentSettings?.notificationSoundEnabled ?? true)
          ? "Stop playing finish.mp3 when sidebar notifications arrive."
          : "Play finish.mp3 when sidebar notifications arrive.",
      action: () => {
        const next = !(currentSettings?.notificationSoundEnabled ?? true);
        const base = currentSettings ?? DEFAULT_SETTINGS;
        applySettings(mergeSettings(base, { notificationSoundEnabled: next }));
        rpc.send("updateSettings", {
          settings: { notificationSoundEnabled: next },
        });
      },
    },
    {
      id: "focus-left",
      category: "Navigation",
      label: "Focus Pane Left",
      description: "Move focus to the pane on the left.",
      shortcut: "\u2318\u2325\u2190",
      action: () => surfaceManager.focusDirection("left"),
    },
    {
      id: "focus-right",
      category: "Navigation",
      label: "Focus Pane Right",
      description: "Move focus to the pane on the right.",
      shortcut: "\u2318\u2325\u2192",
      action: () => surfaceManager.focusDirection("right"),
    },
    {
      id: "focus-up",
      category: "Navigation",
      label: "Focus Pane Up",
      description: "Move focus to the pane above.",
      shortcut: "\u2318\u2325\u2191",
      action: () => surfaceManager.focusDirection("up"),
    },
    {
      id: "focus-down",
      category: "Navigation",
      label: "Focus Pane Down",
      description: "Move focus to the pane below.",
      shortcut: "\u2318\u2325\u2193",
      action: () => surfaceManager.focusDirection("down"),
    },
    {
      id: "next-workspace",
      category: "Workspace",
      label: "Next Workspace",
      description: "Jump to the next workspace in the stack.",
      shortcut: "\u2303\u2318]",
      action: () => surfaceManager.nextWorkspace(),
    },
    {
      id: "prev-workspace",
      category: "Workspace",
      label: "Previous Workspace",
      description: "Jump to the previous workspace.",
      shortcut: "\u2303\u2318[",
      action: () => surfaceManager.prevWorkspace(),
    },
    {
      id: "maximize",
      category: "Window",
      label: "Toggle Maximize",
      description: "Expand or restore the main window.",
      action: () => rpc.send("toggleMaximize"),
    },
    {
      id: "toggle-web-mirror",
      category: "Network",
      label: "Toggle Web Mirror",
      description: "Start or stop the web terminal mirror server.",
      action: () => rpc.send("toggleWebServer"),
    },
    {
      id: "font-increase",
      category: "View",
      label: "Increase Font Size",
      description: "Make terminal text larger.",
      shortcut: "\u2318+",
      action: () => changeFontSize(1),
    },
    {
      id: "font-decrease",
      category: "View",
      label: "Decrease Font Size",
      description: "Make terminal text smaller.",
      shortcut: "\u2318\u2212",
      action: () => changeFontSize(-1),
    },
    {
      id: "font-reset",
      category: "View",
      label: "Reset Font Size",
      description: "Reset terminal text to default size.",
      shortcut: "\u23180",
      action: () => resetFontSize(),
    },
    {
      id: "find-in-terminal",
      category: "Terminal",
      label: "Find in Terminal",
      description: "Search text in the active terminal.",
      shortcut: "\u2318F",
      action: () => surfaceManager.toggleSearchBar(),
    },
    {
      id: "open-settings",
      category: "View",
      label: "Settings",
      description: "Open application settings.",
      shortcut: "\u2318,",
      action: () => openSettings(),
    },
    {
      id: "toggle-process-manager",
      category: "View",
      label: processManagerPanel.isVisible()
        ? "Close Process Manager"
        : "Process Manager",
      description:
        "Inspect every process in the workspace — pid, command, cwd, ports, CPU, memory. Kill from the row.",
      shortcut: "\u2318\u2325P",
      action: () => toggleProcessManager(),
    },
    {
      id: "browser-split",
      category: "Browser",
      label: "Open Browser Split",
      description: "Split a built-in browser pane alongside the current pane.",
      shortcut: "\u2318\u21e7L",
      action: () =>
        rpc.send("splitBrowserSurface", { direction: "horizontal" }),
    },
    {
      id: "browser-new",
      category: "Browser",
      label: "New Browser Workspace",
      description: "Open a new workspace with a browser pane.",
      action: () => rpc.send("createBrowserSurface", {}),
    },
    {
      id: "agent-new",
      category: "Agent",
      label: "New Agent Workspace",
      description: "Open a pi coding agent in a new workspace.",
      action: () => rpc.send("createAgentSurface", {}),
    },
    {
      id: "agent-split-right",
      category: "Agent",
      label: "Split Agent Right",
      description: "Split a pi coding agent alongside the current pane.",
      action: () => rpc.send("splitAgentSurface", { direction: "horizontal" }),
    },
    {
      id: "agent-split-down",
      category: "Agent",
      label: "Split Agent Down",
      description: "Split a pi coding agent below the current pane.",
      action: () => rpc.send("splitAgentSurface", { direction: "vertical" }),
    },
    {
      id: "telegram-new",
      category: "Telegram",
      label: "New Telegram Pane",
      description: "Open a Telegram chat pane in a new workspace.",
      action: () => rpc.send("createTelegramSurface", {}),
    },
    {
      id: "telegram-split-right",
      category: "Telegram",
      label: "Split Telegram Right",
      description: "Open a Telegram chat pane next to the current pane.",
      action: () =>
        rpc.send("splitTelegramSurface", { direction: "horizontal" }),
    },
    {
      id: "telegram-split-down",
      category: "Telegram",
      label: "Split Telegram Down",
      description: "Open a Telegram chat pane below the current pane.",
      action: () => rpc.send("splitTelegramSurface", { direction: "vertical" }),
    },
    {
      id: "show-pane-info",
      category: "View",
      label: surfaceDetailsPanel.isVisible()
        ? "Close Pane Info"
        : "Show Pane Info",
      description:
        "Full detail view for the focused pane — identity, git, ports, process tree, kill buttons.",
      shortcut: "\u2318I",
      action: () => toggleFocusedSurfaceInfo(),
    },
  ];
}

function syncPaletteCommands(): void {
  palette.setCommands(buildPaletteCommands());
}

function syncSidebarState() {
  const collapsed = sidebarEl.classList.contains("collapsed");
  terminalContainerEl.classList.toggle("sidebar-collapsed", collapsed);
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  sidebarToggleBtn?.classList.toggle("active", !collapsed);
}

function syncToolbarState() {
  const state = surfaceManager.getWorkspaceState();
  const workspaces = state.workspaces;
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ??
    null;

  if (titlebarBadgeLabelEl) {
    titlebarBadgeLabelEl.textContent = activeWorkspace
      ? `Workspace ${String(workspaces.indexOf(activeWorkspace) + 1).padStart(2, "0")}`
      : "No Workspace";
  }

  if (workspaceCountLabelEl) {
    workspaceCountLabelEl.textContent = `${workspaces.length} workspace${
      workspaces.length === 1 ? "" : "s"
    }`;
  }

  if (paneCountLabelEl) {
    const paneCount = activeWorkspace?.surfaceIds.length ?? 0;
    paneCountLabelEl.textContent = `${paneCount} pane${paneCount === 1 ? "" : "s"}`;
  }

  refreshStatusBar();
  // Notify variant chrome (Cockpit rail, Atlas graph) that the
  // workspace set or active workspace changed. Variants that don't
  // care ignore the event; ones that do re-render on the next tick.
  window.dispatchEvent(new CustomEvent("ht-workspaces-changed"));
}

// refreshBridgeSwitcher() + #tau-workspace-switcher removed — the
// pill strip kept pushing the 4-button action group off-screen.
// Workspace switching is still reachable via the sidebar, ⌘+digit
// shortcuts, and the command palette ("Switch Workspace").

// Notify state mirror — kept in sync by the `ht-notify-state-changed`
// event dispatched from SurfaceManager.emitNotifyState(). Variants read
// from here so each renderer stays a pure function of state.
let lastNotifyWorkspaces = new Set<string>();
window.addEventListener("ht-notify-state-changed", (e) => {
  const detail = (
    e as CustomEvent<{ surfaces: string[]; workspaces: string[] }>
  ).detail;
  lastNotifyWorkspaces = new Set(detail?.workspaces ?? []);
  // Mirror onto window so variants can read without a back-channel.
  (
    window as unknown as { __tauNotifyWorkspaces: Set<string> }
  ).__tauNotifyWorkspaces = lastNotifyWorkspaces;
  syncToolbarState();
});

function toggleSidebar() {
  surfaceManager.toggleSidebar();
  syncSidebarState();
  // Layout refit is handled by SurfaceManager.scheduleLayoutAfterTransition()
}

function openCommandPalette() {
  clearTypingFocusMode();
  if (!palette.isVisible()) {
    surfaceManager.hideBrowserWebviews();
  }
  syncPaletteCommands();
  palette.toggle();
  // Restore browser webviews when palette closes
  if (!palette.isVisible()) {
    surfaceManager.showBrowserWebviews();
  }
}

function isTerminalInputActive(): boolean {
  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLTextAreaElement &&
    activeElement.classList.contains("xterm-helper-textarea")
  );
}

function setTypingFocusMode() {
  if (typingFocusActive) return;
  typingFocusActive = true;
  document.body.classList.add("terminal-typing");
}

function clearTypingFocusMode() {
  if (!typingFocusActive) return;
  typingFocusActive = false;
  document.body.classList.remove("terminal-typing");
}

function getEditableTarget():
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLElement
  | null {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement
  ) {
    return activeElement;
  }

  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
    return activeElement;
  }

  return null;
}

function copySelection() {
  const editableTarget = getEditableTarget();
  if (
    editableTarget instanceof HTMLElement &&
    editableTarget.isContentEditable
  ) {
    document.execCommand("copy");
    return;
  }

  const term = surfaceManager.getActiveTerm();
  if (!term) return;

  const selection = term.getSelection();
  if (!selection) return;

  rpc.send("clipboardWrite", { text: selection });
  term.clearSelection();
}

/**
 * Paste into the terminal via bun-side native clipboard read.
 * Returns true if handled (terminal paste), false if the caller
 * should let the native paste event through (editable input).
 */
function pasteClipboard(): boolean {
  const editableTarget = getEditableTarget();
  if (editableTarget) {
    // Let the native paste event handle input fields
    return false;
  }

  const id = surfaceManager.getActiveSurfaceId();
  if (id) {
    // Bun reads clipboard natively and writes directly to stdin
    rpc.send("clipboardPaste", { surfaceId: id });
  }
  return true;
}

function selectAll() {
  const editableTarget = getEditableTarget();
  if (editableTarget instanceof HTMLInputElement) {
    editableTarget.select();
    return;
  }

  if (editableTarget instanceof HTMLTextAreaElement) {
    editableTarget.select();
    return;
  }

  if (
    editableTarget instanceof HTMLElement &&
    editableTarget.isContentEditable
  ) {
    document.execCommand("selectAll");
    return;
  }

  surfaceManager.getActiveTerm()?.selectAll();
}

let surfaceContextMenuEl: HTMLDivElement | null = null;

function ensureSurfaceContextMenu(): HTMLDivElement {
  if (surfaceContextMenuEl) return surfaceContextMenuEl;

  const el = document.createElement("div");
  el.className = "surface-context-menu";
  el.setAttribute("aria-hidden", "true");
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  document.body.appendChild(el);
  surfaceContextMenuEl = el;
  return el;
}

function hideSurfaceContextMenu(): void {
  if (!surfaceContextMenuEl) return;
  surfaceContextMenuEl.classList.remove("surface-context-menu-visible");
  surfaceContextMenuEl.setAttribute("aria-hidden", "true");
}

function createSurfaceContextMenuItem(
  label: string,
  onSelect: () => void,
  tone: "default" | "danger" = "default",
): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.tabIndex = -1;
  item.className = `surface-context-menu-item${tone === "danger" ? " surface-context-menu-item-danger" : ""}`;
  item.textContent = label;
  item.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });
  item.addEventListener("click", () => {
    hideSurfaceContextMenu();
    onSelect();
  });
  return item;
}

function createSurfaceContextMenuDivider(): HTMLDivElement {
  const divider = document.createElement("div");
  divider.className = "surface-context-menu-divider";
  return divider;
}

function showSurfaceContextMenu(detail: SurfaceContextMenuRequest): void {
  const menu = ensureSurfaceContextMenu();
  const title =
    surfaceManager.getSurfaceTitle(detail.surfaceId) ??
    detail.title ??
    detail.surfaceId;

  surfaceManager.focusSurface(detail.surfaceId);
  menu.replaceChildren(
    createSurfaceContextMenuItem("Rename Pane…", () => {
      void promptRenameSurface(detail.surfaceId, title);
    }),
    createSurfaceContextMenuDivider(),
    createSurfaceContextMenuItem("Split Right", () => {
      surfaceManager.focusSurface(detail.surfaceId);
      requestSplit("horizontal");
    }),
    createSurfaceContextMenuItem("Split Down", () => {
      surfaceManager.focusSurface(detail.surfaceId);
      requestSplit("vertical");
    }),
    createSurfaceContextMenuDivider(),
    createSurfaceContextMenuItem("Copy", () => {
      surfaceManager.focusSurface(detail.surfaceId);
      copySelection();
    }),
    createSurfaceContextMenuItem("Paste", () => {
      surfaceManager.focusSurface(detail.surfaceId);
      pasteClipboard();
    }),
    createSurfaceContextMenuDivider(),
    createSurfaceContextMenuItem(
      "Close Pane",
      () => {
        rpc.send("closeSurface", { surfaceId: detail.surfaceId });
      },
      "danger",
    ),
  );

  menu.classList.add("surface-context-menu-visible");
  menu.setAttribute("aria-hidden", "false");

  const margin = 8;
  const x = detail.x ?? window.innerWidth / 2;
  const y = detail.y ?? window.innerHeight / 2;

  requestAnimationFrame(() => {
    const maxX = Math.max(
      margin,
      window.innerWidth - menu.offsetWidth - margin,
    );
    const maxY = Math.max(
      margin,
      window.innerHeight - menu.offsetHeight - margin,
    );
    menu.style.left = `${Math.max(margin, Math.min(x, maxX))}px`;
    menu.style.top = `${Math.max(margin, Math.min(y, maxY))}px`;
  });
}

async function promptRenameWorkspace(workspaceId: string, name: string) {
  const nextName = await showPromptDialog({
    title: "Rename Workspace",
    message: "Choose a clearer name for this workspace.",
    initialValue: name,
    placeholder: "Workspace name",
    confirmLabel: "Rename",
  });
  if (nextName) {
    surfaceManager.renameWorkspace(workspaceId, nextName);
  }
}

async function promptRenameSurface(surfaceId: string, title: string) {
  const nextName = await showPromptDialog({
    title: "Rename Pane",
    message: "Give this pane a short label that is easy to spot in the UI.",
    initialValue: title,
    placeholder: "Pane name",
    confirmLabel: "Rename",
  });
  if (nextName) {
    rpc.send("renameSurface", { surfaceId, title: nextName });
  }
}

let suppressSidebarSync = false;
window.addEventListener("ht-sidebar-toggle", () => {
  syncSidebarState();
  syncToolbarState();
  // Layout refit is handled by SurfaceManager.scheduleLayoutAfterTransition()
  if (!suppressSidebarSync) {
    rpc.send("sidebarToggle", {
      visible: surfaceManager.isSidebarVisible(),
    });
  }
});

window.addEventListener("ht-surface-focused", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) {
    rpc.send("focusSurface", { surfaceId: detail.surfaceId });
  }
});

window.addEventListener("ht-open-context-menu", (e: Event) => {
  const detail = (e as CustomEvent<NativeContextMenuRequest>).detail;
  if (detail) {
    rpc.send("showContextMenu", detail);
  }
});

window.addEventListener("ht-open-surface-context-menu", (e: Event) => {
  const detail = (e as CustomEvent<SurfaceContextMenuRequest>).detail;
  if (detail) {
    showSurfaceContextMenu(detail);
  }
});

sidebarToggleBtn?.addEventListener("click", () => {
  toggleSidebar();
});

commandPaletteBtn?.addEventListener("click", () => {
  openCommandPalette();
});

newWorkspaceBtn?.addEventListener("click", () => {
  rpc.send("createSurface", {});
});

splitRightBtn?.addEventListener("click", () => {
  requestSplit("horizontal");
});

splitDownBtn?.addEventListener("click", () => {
  requestSplit("vertical");
});

// ---- Keyboard shortcuts (data-driven) --------------------------------------
//
// The prologue handles typing-focus mode and the two full-screen overlay
// preemptions (settings panel swallows everything except Escape; the
// command palette swallows everything once we're past the high-priority
// bindings). All other shortcuts are expressed as Binding entries — adding
// a new one means appending a row, and a future help dialog or command
// palette can enumerate the same array to drive its own UI.

interface KeyCtx {
  activeSurfaceType: string | null;
}

const isDigit1to9 = (k: string) => k >= "1" && k <= "9";

const KEYBOARD_BINDINGS: Binding<KeyCtx>[] = [
  // Overlays: Process Manager / Surface Details can be dismissed with Escape.
  {
    id: "process-manager.dismiss",
    description: "Close Process Manager",
    category: "Overlays",
    when: () => processManagerPanel.isVisible(),
    match: keyMatch({ key: "Escape" }),
    action: () => toggleProcessManager(),
  },
  {
    id: "surface-details.dismiss",
    description: "Close Surface Details",
    category: "Overlays",
    when: () => surfaceDetailsPanel.isVisible(),
    match: keyMatch({ key: "Escape" }),
    action: () => {
      surfaceDetailsPanel.hide();
      surfaceManager.showBrowserWebviews();
      syncPaletteCommands();
    },
  },

  // Browser pane — context-specific shortcuts.
  {
    id: "browser.focus-address-bar",
    description: "Focus address bar",
    category: "Browser",
    when: (ctx) => ctx.activeSurfaceType === "browser",
    match: keyMatch({ key: "l", meta: true, shift: false, alt: false }),
    action: () => surfaceManager.focusBrowserAddressBar(),
  },
  {
    id: "browser.back",
    description: "Navigate back",
    category: "Browser",
    when: (ctx) => ctx.activeSurfaceType === "browser",
    match: keyMatch({ key: "[", meta: true, shift: false }),
    action: () => surfaceManager.browserGoBack(),
  },
  {
    id: "browser.forward",
    description: "Navigate forward",
    category: "Browser",
    when: (ctx) => ctx.activeSurfaceType === "browser",
    match: keyMatch({ key: "]", meta: true, shift: false }),
    action: () => surfaceManager.browserGoForward(),
  },
  {
    id: "browser.reload",
    description: "Reload page",
    category: "Browser",
    when: (ctx) => ctx.activeSurfaceType === "browser",
    match: keyMatch({ key: "r", meta: true, shift: false, alt: false }),
    action: () => surfaceManager.browserReload(),
  },
  {
    id: "browser.toggle-devtools",
    description: "Toggle DevTools",
    category: "Browser",
    when: (ctx) => ctx.activeSurfaceType === "browser",
    match: keyMatch({ key: "i", meta: true, alt: true, caseInsensitive: true }),
    action: () => surfaceManager.browserToggleDevTools(),
  },
  {
    id: "browser.find",
    description: "Find in page",
    category: "Browser",
    when: (ctx) => ctx.activeSurfaceType === "browser",
    match: keyMatch({ key: "f", meta: true, shift: false }),
    action: () => surfaceManager.browserFindInPage(),
  },
  {
    id: "browser.zoom-in",
    description: "Zoom in",
    category: "Browser",
    when: (ctx) => ctx.activeSurfaceType === "browser",
    match: keyMatch({
      key: (k) => k === "=" || k === "+",
      meta: true,
      shift: false,
    }),
    action: () => surfaceManager.browserZoomIn(),
  },
  {
    id: "browser.zoom-out",
    description: "Zoom out",
    category: "Browser",
    when: (ctx) => ctx.activeSurfaceType === "browser",
    match: keyMatch({ key: "-", meta: true, shift: false }),
    action: () => surfaceManager.browserZoomOut(),
  },
  {
    id: "browser.zoom-reset",
    description: "Reset zoom",
    category: "Browser",
    when: (ctx) => ctx.activeSurfaceType === "browser",
    match: keyMatch({ key: "0", meta: true, shift: false }),
    action: () => surfaceManager.browserZoomReset(),
  },

  // Workspace / pane
  {
    id: "sidebar.toggle",
    description: "Toggle sidebar",
    category: "View",
    match: keyMatch({ key: "b", meta: true, shift: false }),
    action: () => toggleSidebar(),
  },

  // τ-mux §10 variant shortcuts.
  // - ⌘\ collapses the sidebar / icon rail / graph column in Cockpit +
  //   Atlas (acts like toggleSidebar() for those variants, and like a
  //   plain sidebar toggle in Bridge so Bridge users still get a useful
  //   binding; Bridge's sidebar is "never collapsible" per §9.1, so we
  //   wire the behaviour to toggle a body attribute the variant CSS
  //   can respect).
  {
    id: "layout.toggle-rail",
    description: "Collapse sidebar / icon rail / graph",
    category: "Layout",
    match: keyMatch({ key: "\\", meta: true }),
    action: () => {
      const variant = currentSettings?.layoutVariant ?? "bridge";
      if (variant === "bridge") {
        // §9.1 says Bridge is never collapsible — keep that contract
        // but still let ⌘\ do something sensible (toggle sidebar).
        toggleSidebar();
        return;
      }
      document.body.classList.toggle("tau-rail-collapsed");
      // Ask the terminal to resize after the transition so xterm
      // reflows to the new available width.
      setTimeout(() => surfaceManager.resizeAll(), 220);
    },
  },
  // - ⌘G toggles graph visibility (Atlas only). In other variants it
  //   is a no-op so the binding is discoverable but harmless.
  {
    id: "layout.toggle-graph",
    description: "Toggle graph view (Atlas)",
    category: "Layout",
    when: () => (currentSettings?.layoutVariant ?? "bridge") === "atlas",
    match: keyMatch({ key: "g", meta: true, shift: false }),
    action: () => {
      document.body.classList.toggle("tau-atlas-graph-hidden");
      setTimeout(() => surfaceManager.resizeAll(), 220);
    },
  },
  {
    id: "surface.new",
    description: "New terminal pane",
    category: "Surface",
    match: keyMatch({ key: "n", meta: true, shift: false }),
    action: () => rpc.send("createSurface", {}),
  },
  {
    id: "surface.split-horizontal",
    description: "Split right",
    category: "Surface",
    match: keyMatch({ key: "d", meta: true, shift: false }),
    action: () => requestSplit("horizontal"),
  },
  {
    id: "surface.split-vertical",
    description: "Split down",
    category: "Surface",
    match: keyMatch({ key: "D", meta: true, shift: true }),
    action: () => requestSplit("vertical"),
  },
  {
    id: "surface.close",
    description: "Close pane",
    category: "Surface",
    match: keyMatch({ key: "w", meta: true, shift: false }),
    action: () => {
      const id = surfaceManager.getActiveSurfaceId();
      if (id) rpc.send("closeSurface", { surfaceId: id });
    },
  },
  {
    id: "surface.close-shift",
    description: "Close pane (⌘⇧W)",
    category: "Surface",
    match: keyMatch({ key: "W", meta: true, shift: true }),
    action: () => {
      const id = surfaceManager.getActiveSurfaceId();
      if (id) rpc.send("closeSurface", { surfaceId: id });
    },
  },

  // Focus navigation
  {
    id: "focus.left",
    description: "Focus pane left",
    category: "Focus",
    match: keyMatch({ key: "ArrowLeft", meta: true, alt: true }),
    action: () => surfaceManager.focusDirection("left"),
  },
  {
    id: "focus.right",
    description: "Focus pane right",
    category: "Focus",
    match: keyMatch({ key: "ArrowRight", meta: true, alt: true }),
    action: () => surfaceManager.focusDirection("right"),
  },
  {
    id: "focus.up",
    description: "Focus pane up",
    category: "Focus",
    match: keyMatch({ key: "ArrowUp", meta: true, alt: true }),
    action: () => surfaceManager.focusDirection("up"),
  },
  {
    id: "focus.down",
    description: "Focus pane down",
    category: "Focus",
    match: keyMatch({ key: "ArrowDown", meta: true, alt: true }),
    action: () => surfaceManager.focusDirection("down"),
  },

  // Workspace cycling
  {
    id: "workspace.next",
    description: "Next workspace",
    category: "Workspace",
    match: keyMatch({ key: "]", meta: true, ctrl: true }),
    action: () => surfaceManager.nextWorkspace(),
  },
  {
    id: "workspace.prev",
    description: "Previous workspace",
    category: "Workspace",
    match: keyMatch({ key: "[", meta: true, ctrl: true }),
    action: () => surfaceManager.prevWorkspace(),
  },
  {
    id: "workspace.jump",
    description: "Jump to workspace 1–9",
    category: "Workspace",
    match: keyMatch({
      key: isDigit1to9,
      meta: true,
      shift: false,
      ctrl: false,
    }),
    action: (e) => surfaceManager.focusWorkspaceByIndex(parseInt(e.key) - 1),
  },

  // Font size
  {
    id: "font.bigger",
    description: "Increase font size",
    category: "View",
    match: keyMatch({
      key: (k) => k === "=" || k === "+",
      meta: true,
      shift: false,
    }),
    action: () => changeFontSize(1),
  },
  {
    id: "font.smaller",
    description: "Decrease font size",
    category: "View",
    match: keyMatch({ key: "-", meta: true, shift: false }),
    action: () => changeFontSize(-1),
  },
  {
    id: "font.reset",
    description: "Reset font size",
    category: "View",
    match: keyMatch({ key: "0", meta: true, shift: false }),
    action: () => resetFontSize(),
  },

  // Terminal search
  {
    id: "terminal.search",
    description: "Find in terminal",
    category: "Terminal",
    match: keyMatch({ key: "f", meta: true, shift: false }),
    action: () => surfaceManager.toggleSearchBar(),
  },

  // Clipboard
  {
    id: "clipboard.copy",
    description: "Copy",
    category: "Clipboard",
    match: keyMatch({ key: "c", meta: true }),
    action: () => copySelection(),
    // copySelection relies on the default system copy behavior staying
    // available for editable inputs, so no preventDefault here.
    noPreventDefault: true,
  },
  {
    id: "clipboard.paste",
    description: "Paste",
    category: "Clipboard",
    match: keyMatch({ key: "v", meta: true }),
    action: (e) => {
      if (pasteClipboard()) e.preventDefault();
      // else: let native paste handle editable inputs.
    },
    noPreventDefault: true,
  },
];

// The high-priority bindings must fire even when the palette is visible
// (⌘⇧P toggles the palette, ⌘, opens settings, ⌘⌥P toggles process mgr).
const HIGH_PRIORITY_BINDINGS: Binding<KeyCtx>[] = [
  {
    id: "app.settings",
    description: "Open settings",
    category: "App",
    match: keyMatch({ key: ",", meta: true }),
    action: () => openSettings(),
  },
  {
    id: "app.command-palette",
    description: "Open command palette",
    category: "App",
    match: keyMatch({
      key: "p",
      meta: true,
      shift: true,
      caseInsensitive: true,
    }),
    action: () => openCommandPalette(),
  },
  {
    id: "app.process-manager",
    description: "Toggle Process Manager",
    category: "App",
    match: keyMatch({ key: "p", meta: true, alt: true, caseInsensitive: true }),
    action: () => toggleProcessManager(),
  },
  {
    id: "app.surface-info",
    description: "Toggle Surface Info",
    category: "App",
    match: keyMatch({
      key: "i",
      meta: true,
      shift: false,
      alt: false,
      caseInsensitive: true,
    }),
    action: () => toggleFocusedSurfaceInfo(),
  },
  {
    id: "app.split-browser",
    description: "Split with browser",
    category: "Surface",
    match: keyMatch({
      key: "l",
      meta: true,
      shift: true,
      caseInsensitive: true,
    }),
    action: () => rpc.send("splitBrowserSurface", { direction: "horizontal" }),
  },
];

document.addEventListener("keydown", (e) => {
  if (
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !palette.isVisible() &&
    isTerminalInputActive()
  ) {
    setTypingFocusMode();
  }

  // Settings panel takes priority — swallow everything except Escape.
  if (settingsPanel.isVisible()) {
    if (e.key === "Escape") {
      e.preventDefault();
      settingsPanel.hide();
      surfaceManager.showBrowserWebviews();
    }
    return;
  }

  const ctx: KeyCtx = {
    activeSurfaceType: surfaceManager.getActiveSurfaceType(),
  };

  if (dispatchKeyboardEvent(e, HIGH_PRIORITY_BINDINGS, ctx)) return;

  // Command palette visible — block the rest of the bindings.
  if (palette.isVisible()) return;

  dispatchKeyboardEvent(e, KEYBOARD_BINDINGS, ctx);
});

document.addEventListener(
  "mousemove",
  () => {
    clearTypingFocusMode();
  },
  { passive: true },
);

document.addEventListener(
  "mousedown",
  (e) => {
    clearTypingFocusMode();
    if (
      surfaceContextMenuEl &&
      surfaceContextMenuEl.classList.contains("surface-context-menu-visible")
    ) {
      const target = e.target;
      if (!(target instanceof Node) || !surfaceContextMenuEl.contains(target)) {
        hideSurfaceContextMenu();
      }
    }
  },
  { passive: true, capture: true },
);

titlebarEl.addEventListener("dblclick", () => {
  rpc.send("toggleMaximize");
});

window.addEventListener("ht-close-surface", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) {
    rpc.send("closeSurface", { surfaceId: detail.surfaceId });
  }
});

window.addEventListener("ht-new-workspace", () => {
  rpc.send("createSurface", {});
});

window.addEventListener("ht-open-external", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.url) rpc.send("openExternal", { url: detail.url });
});

window.addEventListener("ht-show-surface-info", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) showSurfaceInfo(detail.surfaceId);
});

window.addEventListener("ht-run-script", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (!detail?.workspaceId || !detail?.cwd || !detail?.scriptKey) return;
  // Manifest cards can ship a fully-formed command (cargo path:
  // "cargo build --release", "cargo run --bin server"). When absent
  // we're on the package.json path: synthesize from the configured
  // runner + script name as before.
  let command: string;
  if (typeof detail.command === "string" && detail.command.trim() !== "") {
    command = detail.command;
  } else {
    const runner =
      currentSettings?.packageRunner ?? DEFAULT_SETTINGS.packageRunner;
    command = `${runner} run ${detail.scriptKey}`;
  }
  rpc.send("runScript", {
    workspaceId: detail.workspaceId,
    cwd: detail.cwd,
    command,
    scriptKey: detail.scriptKey,
  });
});

window.addEventListener("ht-select-workspace-cwd", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (!detail?.workspaceId || !detail?.cwd) return;
  surfaceManager.setWorkspaceCwd(detail.workspaceId, detail.cwd);
});

window.addEventListener("ht-rename-workspace", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (!detail?.workspaceId || typeof detail.name !== "string") return;
  surfaceManager.renameWorkspace(detail.workspaceId, detail.name);
});

// Metadata poll rate follows window visibility: full rate visible, slow hidden.
function reportVisibility(): void {
  rpc.send("windowVisibility", { visible: !document.hidden });
}
document.addEventListener("visibilitychange", () => {
  hideSurfaceContextMenu();
  reportVisibility();
});
reportVisibility();

window.addEventListener("blur", () => {
  hideSurfaceContextMenu();
});

window.addEventListener("resize", () => {
  hideSurfaceContextMenu();
});

window.addEventListener("ht-sidebar-resize-commit", (e: Event) => {
  const detail = (e as CustomEvent).detail as { width?: number } | undefined;
  const width = detail?.width;
  if (typeof width !== "number") return;
  // Route through the normal settings pipeline so the clamp + persist
  // + bun-side `sidebarChanged` broadcast all stay in one code path.
  const base = currentSettings ?? DEFAULT_SETTINGS;
  const merged = mergeSettings(base, { sidebarWidth: width });
  applySettings(merged);
  rpc.send("updateSettings", { settings: { sidebarWidth: width } });
});

window.addEventListener("ht-clear-notifications", () => {
  clearTypingFocusMode();
  rpc.send("clearNotifications");
});

window.addEventListener("ht-dismiss-notification", (e: Event) => {
  const detail = (e as CustomEvent).detail as { id?: string } | undefined;
  if (detail?.id) rpc.send("dismissNotification", { id: detail.id });
});

// ── Telegram pane → bun ──
window.addEventListener("ht-telegram-send", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { chatId?: string; text?: string }
    | undefined;
  if (!detail?.chatId || !detail.text) return;
  rpc.send("telegramSend", { chatId: detail.chatId, text: detail.text });
});

window.addEventListener("ht-telegram-request-history", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { chatId?: string; before?: number }
    | undefined;
  if (!detail?.chatId) return;
  rpc.send("telegramRequestHistory", {
    chatId: detail.chatId,
    before: detail.before,
  });
});

window.addEventListener("ht-telegram-request-state", () => {
  rpc.send("telegramRequestState");
});

window.addEventListener("ht-focus-notification-source", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { surfaceId?: string | null }
    | undefined;
  const surfaceId = detail?.surfaceId;
  if (!surfaceId) return;
  const ws = surfaceManager.findWorkspaceForSurface(surfaceId);
  if (!ws) return;
  surfaceManager.focusWorkspaceById(ws.id);
  surfaceManager.focusSurface(surfaceId);
});

// ── Browser pane events ──
registerBrowserEvents(rpc);

window.addEventListener("ht-clear-logs", () => {
  surfaceManager.clearLogs();
});

// ── Agent pane events ──
registerAgentEvents(rpc, surfaceManager);

window.addEventListener("ht-split", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId && detail?.direction) {
    surfaceManager.focusSurface(detail.surfaceId);
    requestSplit(detail.direction);
  }
});

const dispatchSocketAction = createSocketActionDispatcher({
  surfaceManager,
  rpc,
  toggleSidebar,
  openCommandPalette,
  toggleProcessManager,
  openSettings,
  copySelection,
  pasteClipboard: () => {
    pasteClipboard();
  },
  selectAll,
  promptRenameWorkspace: (id, name) => {
    void promptRenameWorkspace(id, name);
  },
  promptRenameSurface: (id, title) => {
    void promptRenameSurface(id, title);
  },
  setSidebarVisibleProgrammatic: (visible) => {
    suppressSidebarSync = true;
    surfaceManager.setSidebarVisible(visible);
    syncSidebarState();
    syncToolbarState();
    // Layout refit is handled by SurfaceManager.scheduleLayoutAfterTransition()
    suppressSidebarSync = false;
  },
  flushWorkspaceStateSync,
  onActionComplete: () => {
    syncWorkspaceState();
    syncToolbarState();
  },
});

// Tier 2 test router. No-op in production (window.__htTestMode__ is never
// set). Consults the flag at dispatch time, so flipping it on/off at runtime
// (via the `enableTestMode` message) takes effect immediately.
//
// Compile-time gate: set `HYPERTERM_INCLUDE_TEST_HOOKS=0` at build time
// (stable builds) to let the bundler dead-code-eliminate the entire router.
// Dev/test builds default to including it.

const TEST_HOOKS_COMPILED_IN: boolean = (() => {
  try {
    // process may be undefined in strict browser contexts; guarded.
    return (
      typeof process === "undefined" ||
      process.env?.["HYPERTERM_INCLUDE_TEST_HOOKS"] !== "0"
    );
  } catch {
    return true;
  }
})();
const dispatchTestAction = TEST_HOOKS_COMPILED_IN
  ? createTestActionRouter({
      surfaceManager,
      palette,
      settingsPanel,
      processManagerPanel,
      getCurrentSettings: () => currentSettings,
      applySettings,
      openCommandPalette,
      openSettings,
      toggleProcessManager,
      toggleSidebar,
      openRenameWorkspaceDialog: (id, name) => {
        void promptRenameWorkspace(id, name);
      },
      openRenameSurfaceDialog: (id, title) => {
        void promptRenameSurface(id, title);
      },
      rpc,
    })
  : ((() => false) as ReturnType<typeof createTestActionRouter>);

function handleSocketAction(action: string, payload: Record<string, unknown>) {
  if (dispatchTestAction(action, payload)) return;
  dispatchSocketAction(action, payload);
}

function syncWorkspaceState() {
  const state = surfaceManager.getWorkspaceState();
  rpc.send("workspaceStateSync", state);
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSyncWorkspaceState() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncWorkspaceState, 100);
}

/** Cancel any pending debounced sync and fire one immediately. Used by
 *  the `forceLayoutSync` socket action at graceful-shutdown time so a
 *  just-made split is persisted before `saveLayout` runs bun-side. */
function flushWorkspaceStateSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  syncWorkspaceState();
}

window.addEventListener("ht-workspace-changed", scheduleSyncWorkspaceState);
window.addEventListener("ht-workspace-changed", syncToolbarState);

syncSidebarState();
syncToolbarState();
