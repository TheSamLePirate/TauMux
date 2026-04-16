import { Electroview } from "electrobun/view";
import type {
  HyperTermRPC,
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
import { showPromptDialog } from "./prompt-dialog";
import { ProcessManagerPanel } from "./process-manager";
import { SettingsPanel } from "./settings-panel";
import { SurfaceDetailsPanel } from "./surface-details";
import { showToast } from "./toast";

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

const rpc = Electroview.defineRPC<HyperTermRPC>({
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

let currentSettings: AppSettings | null = null;

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
  syncPaletteCommands();
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
mountTitlebarIcons();

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
}

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

  // Settings panel takes priority
  if (settingsPanel.isVisible()) {
    if (e.key === "Escape") {
      e.preventDefault();
      settingsPanel.hide();
      surfaceManager.showBrowserWebviews();
    }
    return;
  }

  if (e.metaKey && e.key === ",") {
    e.preventDefault();
    openSettings();
    return;
  }

  if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    openCommandPalette();
    return;
  }

  if (e.metaKey && e.altKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    toggleProcessManager();
    return;
  }

  if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i") {
    e.preventDefault();
    toggleFocusedSurfaceInfo();
    return;
  }

  if (processManagerPanel.isVisible() && e.key === "Escape") {
    e.preventDefault();
    toggleProcessManager();
    return;
  }

  if (surfaceDetailsPanel.isVisible() && e.key === "Escape") {
    e.preventDefault();
    surfaceDetailsPanel.hide();
    surfaceManager.showBrowserWebviews();
    syncPaletteCommands();
    return;
  }

  if (palette.isVisible()) return;

  // ⌘⇧L — Open browser in split
  if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    rpc.send("splitBrowserSurface", { direction: "horizontal" });
    return;
  }

  // Browser-specific shortcuts when a browser pane is focused
  const activeSurfaceType = surfaceManager.getActiveSurfaceType();
  if (activeSurfaceType === "browser") {
    if (e.metaKey && !e.shiftKey && !e.altKey && e.key === "l") {
      e.preventDefault();
      surfaceManager.focusBrowserAddressBar();
      return;
    }
    if (e.metaKey && !e.shiftKey && e.key === "[") {
      e.preventDefault();
      surfaceManager.browserGoBack();
      return;
    }
    if (e.metaKey && !e.shiftKey && e.key === "]") {
      e.preventDefault();
      surfaceManager.browserGoForward();
      return;
    }
    if (e.metaKey && !e.shiftKey && !e.altKey && e.key === "r") {
      e.preventDefault();
      surfaceManager.browserReload();
      return;
    }
    if (e.metaKey && e.altKey && e.key.toLowerCase() === "i") {
      e.preventDefault();
      surfaceManager.browserToggleDevTools();
      return;
    }
    if (e.metaKey && !e.shiftKey && e.key === "f") {
      e.preventDefault();
      surfaceManager.browserFindInPage();
      return;
    }
    if (e.metaKey && !e.shiftKey && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      surfaceManager.browserZoomIn();
      return;
    }
    if (e.metaKey && !e.shiftKey && e.key === "-") {
      e.preventDefault();
      surfaceManager.browserZoomOut();
      return;
    }
    if (e.metaKey && !e.shiftKey && e.key === "0") {
      e.preventDefault();
      surfaceManager.browserZoomReset();
      return;
    }
  }

  if (e.metaKey && !e.shiftKey && e.key === "b") {
    e.preventDefault();
    toggleSidebar();
    return;
  }

  if (e.metaKey && !e.shiftKey && e.key === "n") {
    e.preventDefault();
    rpc.send("createSurface", {});
    return;
  }

  if (e.metaKey && !e.shiftKey && e.key === "d") {
    e.preventDefault();
    requestSplit("horizontal");
    return;
  }

  if (e.metaKey && e.shiftKey && e.key === "D") {
    e.preventDefault();
    requestSplit("vertical");
    return;
  }

  if (e.metaKey && !e.shiftKey && e.key === "w") {
    e.preventDefault();
    const id = surfaceManager.getActiveSurfaceId();
    if (id) rpc.send("closeSurface", { surfaceId: id });
    return;
  }

  if (e.metaKey && e.shiftKey && e.key === "W") {
    e.preventDefault();
    const id = surfaceManager.getActiveSurfaceId();
    if (id) rpc.send("closeSurface", { surfaceId: id });
    return;
  }

  if (e.metaKey && e.altKey && e.key === "ArrowLeft") {
    e.preventDefault();
    surfaceManager.focusDirection("left");
    return;
  }
  if (e.metaKey && e.altKey && e.key === "ArrowRight") {
    e.preventDefault();
    surfaceManager.focusDirection("right");
    return;
  }
  if (e.metaKey && e.altKey && e.key === "ArrowUp") {
    e.preventDefault();
    surfaceManager.focusDirection("up");
    return;
  }
  if (e.metaKey && e.altKey && e.key === "ArrowDown") {
    e.preventDefault();
    surfaceManager.focusDirection("down");
    return;
  }

  if (e.ctrlKey && e.metaKey && e.key === "]") {
    e.preventDefault();
    surfaceManager.nextWorkspace();
    return;
  }

  if (e.ctrlKey && e.metaKey && e.key === "[") {
    e.preventDefault();
    surfaceManager.prevWorkspace();
    return;
  }

  if (e.metaKey && !e.shiftKey && !e.ctrlKey && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    surfaceManager.focusWorkspaceByIndex(parseInt(e.key) - 1);
    return;
  }

  // Font size: Cmd+= (increase), Cmd+- (decrease), Cmd+0 (reset)
  if (e.metaKey && !e.shiftKey && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    changeFontSize(1);
    return;
  }
  if (e.metaKey && !e.shiftKey && e.key === "-") {
    e.preventDefault();
    changeFontSize(-1);
    return;
  }
  if (e.metaKey && !e.shiftKey && e.key === "0") {
    e.preventDefault();
    resetFontSize();
    return;
  }

  // Terminal search: Cmd+F
  if (e.metaKey && !e.shiftKey && e.key === "f") {
    e.preventDefault();
    surfaceManager.toggleSearchBar();
    return;
  }

  if (e.metaKey && e.key === "c") {
    copySelection();
    return;
  }

  if (e.metaKey && e.key === "v") {
    if (pasteClipboard()) {
      e.preventDefault();
    }
    // else: let native paste handle editable inputs
  }
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
  const runner =
    currentSettings?.packageRunner ?? DEFAULT_SETTINGS.packageRunner;
  const command = `${runner} run ${detail.scriptKey}`;
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

window.addEventListener("ht-clear-notifications", () => {
  clearTypingFocusMode();
  rpc.send("clearNotifications");
});

// ── Browser pane events ──

window.addEventListener("ht-browser-navigated", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) {
    rpc.send("browserNavigated", {
      surfaceId: detail.surfaceId,
      url: detail.url ?? "",
      title: detail.title ?? "",
    });
  }
});

window.addEventListener("ht-browser-title-changed", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) {
    rpc.send("browserTitleChanged", {
      surfaceId: detail.surfaceId,
      title: detail.title ?? "",
    });
  }
});

window.addEventListener("ht-browser-eval-result", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId && detail?.reqId) {
    rpc.send("browserEvalResult", {
      surfaceId: detail.surfaceId,
      reqId: detail.reqId,
      result: detail.result,
      error: detail.error,
    });
  }
});

window.addEventListener("ht-browser-zoom", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) {
    rpc.send("browserSetZoom", {
      surfaceId: detail.surfaceId,
      zoom: detail.zoom ?? 1.0,
    });
  }
});

window.addEventListener("ht-browser-console-log", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) {
    rpc.send("browserConsoleLog", {
      surfaceId: detail.surfaceId,
      level: detail.level ?? "log",
      args: detail.args ?? [],
      timestamp: detail.timestamp ?? Date.now(),
    });
  }
});

window.addEventListener("ht-browser-error", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId) {
    rpc.send("browserError", {
      surfaceId: detail.surfaceId,
      message: detail.message ?? "",
      filename: detail.filename,
      lineno: detail.lineno,
      timestamp: detail.timestamp ?? Date.now(),
    });
  }
});

window.addEventListener("ht-browser-dom-ready", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId && detail?.url) {
    rpc.send("browserDomReady", {
      surfaceId: detail.surfaceId,
      url: detail.url,
    });
  }
});

window.addEventListener("ht-cookie-import", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.data) {
    rpc.send("browserCookieAction", {
      action: "import",
      data: detail.data,
      format: detail.format,
    });
  }
});

window.addEventListener("ht-cookie-export", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  rpc.send("browserCookieAction", {
    action: "export",
    format: detail?.format || "json",
  });
});

window.addEventListener("ht-cookie-clear", () => {
  rpc.send("browserCookieAction", { action: "clear" });
});

window.addEventListener("ht-clear-logs", () => {
  surfaceManager.clearLogs();
});

// ── Agent pane events ──

window.addEventListener("ht-agent-prompt", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.message) {
    surfaceManager.agentAddUserMessage(
      detail.agentId,
      detail.message,
      detail.images,
    );
    rpc.send("agentPrompt", {
      agentId: detail.agentId,
      message: detail.message,
      images: detail.images,
    });
  }
});

window.addEventListener("ht-agent-abort", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentAbort", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-set-model", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.provider && detail?.modelId) {
    rpc.send("agentSetModel", {
      agentId: detail.agentId,
      provider: detail.provider,
      modelId: detail.modelId,
    });
  }
});

window.addEventListener("ht-agent-set-thinking", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.level) {
    rpc.send("agentSetThinking", {
      agentId: detail.agentId,
      level: detail.level,
    });
  }
});

window.addEventListener("ht-agent-new-session", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentNewSession", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-compact", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentCompact", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-get-models", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentGetModels", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-get-state", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentGetState", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-extension-ui-response", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.id) {
    rpc.send("agentExtensionUIResponse", {
      agentId: detail.agentId,
      id: detail.id,
      response: detail.response ?? { cancelled: detail.cancelled ?? true },
    });
  }
});

window.addEventListener("ht-agent-steer", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.message) {
    rpc.send("agentSteer", {
      agentId: detail.agentId,
      message: detail.message,
      images: detail.images,
    });
  }
});

window.addEventListener("ht-agent-follow-up", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.message) {
    rpc.send("agentFollowUp", {
      agentId: detail.agentId,
      message: detail.message,
      images: detail.images,
    });
  }
});

window.addEventListener("ht-agent-bash", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.command) {
    rpc.send("agentBash", {
      agentId: detail.agentId,
      command: detail.command,
      timeout: detail.timeout,
    });
  }
});

window.addEventListener("ht-agent-abort-bash", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentAbortBash", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-cycle-model", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentCycleModel", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-cycle-thinking", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentCycleThinking", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-get-commands", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentGetCommands", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-get-session-stats", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentGetSessionStats", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-get-messages", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentGetMessages", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-list-sessions", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentListSessions", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-get-session-tree", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentGetSessionTree", {
      agentId: detail.agentId,
      sessionPath: detail.sessionPath,
    });
  }
});

window.addEventListener("ht-agent-get-fork-messages", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentGetForkMessages", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-get-last-assistant-text", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentGetLastAssistantText", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-set-steering-mode", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.mode) {
    rpc.send("agentSetSteeringMode", {
      agentId: detail.agentId,
      mode: detail.mode,
    });
  }
});

window.addEventListener("ht-agent-set-follow-up-mode", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.mode) {
    rpc.send("agentSetFollowUpMode", {
      agentId: detail.agentId,
      mode: detail.mode,
    });
  }
});

window.addEventListener("ht-agent-set-auto-compaction", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.enabled != null) {
    rpc.send("agentSetAutoCompaction", {
      agentId: detail.agentId,
      enabled: detail.enabled,
    });
  }
});

window.addEventListener("ht-agent-set-auto-retry", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.enabled != null) {
    rpc.send("agentSetAutoRetry", {
      agentId: detail.agentId,
      enabled: detail.enabled,
    });
  }
});

window.addEventListener("ht-agent-abort-retry", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentAbortRetry", { agentId: detail.agentId });
  }
});

window.addEventListener("ht-agent-set-session-name", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.name) {
    rpc.send("agentSetSessionName", {
      agentId: detail.agentId,
      name: detail.name,
    });
  }
});

window.addEventListener("ht-agent-switch-session", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.sessionPath) {
    rpc.send("agentSwitchSession", {
      agentId: detail.agentId,
      sessionPath: detail.sessionPath,
    });
  }
});

window.addEventListener("ht-agent-fork", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId && detail?.entryId) {
    rpc.send("agentFork", { agentId: detail.agentId, entryId: detail.entryId });
  }
});

window.addEventListener("ht-agent-export-html", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.agentId) {
    rpc.send("agentExportHtml", {
      agentId: detail.agentId,
      outputPath: detail.outputPath,
    });
  }
});

window.addEventListener("ht-split", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.surfaceId && detail?.direction) {
    surfaceManager.focusSurface(detail.surfaceId);
    requestSplit(detail.direction);
  }
});

function handleSocketAction(action: string, payload: Record<string, unknown>) {
  switch (action) {
    case "selectWorkspace": {
      const id = payload["workspaceId"] as string;
      if (id) surfaceManager.focusWorkspaceById(id);
      break;
    }
    case "closeWorkspace": {
      const id = payload["workspaceId"] as string;
      if (id) surfaceManager.closeWorkspaceById(id);
      break;
    }
    case "renameWorkspace": {
      const id = payload["workspaceId"] as string;
      const name = payload["name"] as string;
      if (id && name) surfaceManager.renameWorkspace(id, name);
      break;
    }
    case "promptRenameWorkspace": {
      const id = payload["workspaceId"] as string;
      const name = (payload["name"] as string) || "Workspace";
      if (id) {
        void promptRenameWorkspace(id, name);
      }
      break;
    }
    case "promptRenameSurface": {
      const id = payload["surfaceId"] as string;
      const title =
        (payload["title"] as string) ||
        surfaceManager.getSurfaceTitle(id) ||
        id;
      if (id) {
        void promptRenameSurface(id, title);
      }
      break;
    }
    case "renameSurface": {
      const id = payload["surfaceId"] as string;
      const title = payload["title"] as string;
      if (id && title) surfaceManager.renameSurface(id, title);
      break;
    }
    case "setWorkspaceColor": {
      const id = payload["workspaceId"] as string;
      const color = payload["color"] as string;
      if (id && color) surfaceManager.setWorkspaceColor(id, color);
      break;
    }
    case "nextWorkspace":
      surfaceManager.nextWorkspace();
      break;
    case "prevWorkspace":
      surfaceManager.prevWorkspace();
      break;
    case "toggleSidebar":
      toggleSidebar();
      break;
    case "setSidebar": {
      const vis = payload["visible"] as boolean;
      suppressSidebarSync = true;
      surfaceManager.setSidebarVisible(vis);
      syncSidebarState();
      syncToolbarState();
      // Layout refit is handled by SurfaceManager.scheduleLayoutAfterTransition()
      suppressSidebarSync = false;
      break;
    }
    case "toggleCommandPalette":
      openCommandPalette();
      break;
    case "toggleProcessManager":
      toggleProcessManager();
      break;
    case "openSettings":
      openSettings();
      break;
    case "focusSurface": {
      const id = payload["surfaceId"] as string;
      if (id) surfaceManager.focusSurface(id);
      break;
    }
    case "copySelection":
      copySelection();
      break;
    case "pasteClipboard":
      pasteClipboard();
      break;
    case "selectAll":
      selectAll();
      break;
    case "setStatus":
      surfaceManager.setStatus(
        payload["workspaceId"] as string | undefined,
        payload["key"] as string,
        payload["value"] as string,
        payload["icon"] as string | undefined,
        payload["color"] as string | undefined,
      );
      break;
    case "clearStatus":
      surfaceManager.clearStatus(
        payload["workspaceId"] as string | undefined,
        payload["key"] as string,
      );
      break;
    case "setProgress":
      surfaceManager.setProgress(
        payload["workspaceId"] as string | undefined,
        payload["value"] as number,
        payload["label"] as string | undefined,
      );
      break;
    case "clearProgress":
      surfaceManager.clearProgress(
        payload["workspaceId"] as string | undefined,
      );
      break;
    case "readScreen": {
      const sid =
        (payload["surfaceId"] as string) ||
        surfaceManager.getActiveSurfaceId() ||
        "";
      const content = surfaceManager.readScreen(
        sid,
        payload["lines"] as number | undefined,
        payload["scrollback"] as boolean | undefined,
      );
      rpc.send("readScreenResponse", {
        reqId: payload["reqId"] as string,
        content,
      });
      break;
    }
    case "notification": {
      const notifs =
        (payload["notifications"] as {
          id: string;
          title: string;
          body: string;
          time: number;
        }[]) || [];
      surfaceManager.getSidebar().setNotifications(notifs);
      if (notifs.length === 0) {
        // Notifications cleared — stop all glows
        surfaceManager.clearGlow();
      } else {
        // Glow the source surface pane
        const notifSurfaceId = (payload["surfaceId"] as string) ?? null;
        surfaceManager.notifyGlow(notifSurfaceId);
      }
      break;
    }
    case "log": {
      surfaceManager.addLog(
        payload["workspaceId"] as string | undefined,
        (payload["level"] as string) || "info",
        (payload["message"] as string) || "",
        payload["source"] as string | undefined,
      );
      break;
    }
    // ── Browser actions from socket API ──
    case "browser.navigateTo": {
      const id = payload["surfaceId"] as string;
      const url = payload["url"] as string;
      if (id && url) surfaceManager.browserNavigateTo(id, url);
      break;
    }
    case "browser.goBack": {
      surfaceManager.browserGoBack(payload["surfaceId"] as string);
      break;
    }
    case "browser.goForward": {
      surfaceManager.browserGoForward(payload["surfaceId"] as string);
      break;
    }
    case "browser.reload": {
      surfaceManager.browserReload(payload["surfaceId"] as string);
      break;
    }
    case "browser.evalJs": {
      surfaceManager.browserEvalJs(
        payload["surfaceId"] as string,
        payload["script"] as string,
        payload["reqId"] as string | undefined,
      );
      break;
    }
    case "browser.findInPage": {
      surfaceManager.browserFindInPage(
        payload["surfaceId"] as string,
        payload["query"] as string,
      );
      break;
    }
    case "browser.stopFind": {
      surfaceManager.browserStopFind(payload["surfaceId"] as string);
      break;
    }
    case "browser.toggleDevTools": {
      surfaceManager.browserToggleDevTools(payload["surfaceId"] as string);
      break;
    }
    case "browser.getCookies": {
      surfaceManager.browserGetCookies(
        payload["surfaceId"] as string,
        payload["reqId"] as string,
      );
      break;
    }
    case "showToast": {
      const message = (payload["message"] as string) || "";
      const level =
        (payload["level"] as
          | "info"
          | "success"
          | "warning"
          | "error"
          | undefined) ?? "info";
      if (message) showToast(message, level);
      break;
    }
    // ── Agent surface actions ──
    case "agentSurfaceCreated": {
      const sid = payload["surfaceId"] as string;
      const aid = payload["agentId"] as string;
      const splitFrom = payload["splitFrom"] as string | undefined;
      const dir = payload["direction"] as "horizontal" | "vertical" | undefined;
      if (!sid || !aid) break;
      if (splitFrom && dir) {
        surfaceManager.addAgentSurfaceAsSplit(sid, aid, splitFrom, dir);
      } else {
        surfaceManager.addAgentSurface(sid, aid);
      }
      break;
    }
    case "agentEvent": {
      const agentId = payload["agentId"] as string;
      const event = payload["event"] as Record<string, unknown>;
      if (agentId && event) {
        surfaceManager.handleAgentEvent(agentId, event);
      }
      break;
    }
    case "agentSurfaceClosed": {
      const sid = payload["surfaceId"] as string;
      if (sid) surfaceManager.removeAgentSurface(sid);
      break;
    }
  }
  syncWorkspaceState();
  syncToolbarState();
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

window.addEventListener("ht-workspace-changed", scheduleSyncWorkspaceState);
window.addEventListener("ht-workspace-changed", syncToolbarState);

syncSidebarState();
syncToolbarState();
