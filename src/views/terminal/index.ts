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
  THEME_PRESETS,
} from "../../shared/settings";
import { SurfaceManager } from "./surface-manager";
import { CommandPalette, type PaletteCommand } from "./command-palette";
import { htEvents } from "../../shared/event-bus";
import { variantContext } from "./variants/variant-context";
import { KeyboardCheatsheet } from "./keyboard-cheatsheet";
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
import { PlanPanel } from "./plan-panel";
import { AskUserState } from "./ask-user-state";
import { installAskUserModal } from "./ask-user-modal";
import { SurfaceDetailsPanel } from "./surface-details";
import { showToast } from "./toast";
import { registerAgentEvents } from "./agent-events";
import { registerBrowserEvents } from "./browser-events";
import { createSocketActionDispatcher } from "./socket-actions";
import { NotificationOverlay } from "./notification-overlay";
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

// Plan #10 commit C — webview-side mirror of the bun ask-user queue.
// Declared early so the rpc message handler closure can reference it
// at module load. The modal is installed below, after surfaceManager
// is constructed (modal needs surface attribution + active id).
const askUserState = new AskUserState();

// N15 / I11 / I12 — central pagehide registry. Modules that own
// observers, intervals, long-lived listeners, or timer-bearing UI
// components push their inverse onto this array at construction time.
// The single `pagehide` listener below runs them all on webview
// teardown so a strict-leak audit is boring rather than a scavenger
// hunt. Failures in one disposer never block the rest.
const lifecycleDisposers: Array<() => void> = [];
window.addEventListener("pagehide", () => {
  for (const dispose of lifecycleDisposers) {
    try {
      dispose();
    } catch {
      /* never let one disposer fail the rest */
    }
  }
});

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
            payload.partition,
          );
        } else {
          surfaceManager.addBrowserSurface(
            payload.surfaceId,
            payload.url,
            payload.partition,
          );
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
      editorSurfaceCreated: (payload) => {
        if (payload.splitFrom && payload.direction) {
          surfaceManager.addEditorSurfaceAsSplit(
            payload.surfaceId,
            payload.path,
            payload.splitFrom,
            payload.direction,
          );
        } else {
          surfaceManager.addEditorSurface(payload.surfaceId, payload.path);
        }
      },
      editorFileSnapshot: (payload) => {
        surfaceManager.applyEditorFileSnapshot(payload);
      },
      editorSaveResult: (payload) => {
        surfaceManager.applyEditorSaveResult(payload);
        if (payload.ok) showToast("File saved", "success");
        else showToast(payload.error ?? "Save failed", "error");
      },
      extensionSurfaceCreated: (payload) => {
        const handle = {
          extensionId: payload.extensionId,
          title: payload.title,
          icon: payload.icon,
          devUrl: payload.devUrl,
          bundleUrl: payload.bundleUrl,
        };
        if (payload.splitFrom && payload.direction) {
          surfaceManager.addExtensionSurfaceAsSplit(
            payload.surfaceId,
            handle,
            payload.splitFrom,
            payload.direction,
          );
        } else {
          surfaceManager.addExtensionSurface(payload.surfaceId, handle);
        }
      },
      extensionBackendMessage: (payload) => {
        surfaceManager.applyExtensionBackendMessage(
          payload.surfaceId,
          payload.payload as import("../../shared/extension-types").ExtensionHostPayload,
        );
      },
      extensionList: (payload) => {
        availableExtensions = payload.extensions;
        extensionTemplates = payload.templates;
        syncPaletteCommands();
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
      restoreDiagnostics: (payload) => {
        settingsPanel.setDiagnostics(payload);
      },
      restoreHtKeysSeen: (payload) => {
        settingsPanel.setHtKeysSeen(payload.keys);
      },
      settingsChanged: (payload) => {
        applySettings(payload.settings);
      },
      restoreLayout: (payload) => {
        surfaceManager.restoreLayout(payload.layout, payload.surfaceMapping);
      },
      socketAction: (payload) => {
        if (payload.action === "editorSave") {
          surfaceManager.saveEditorSurface(
            (payload.payload["surfaceId"] ?? payload.payload["surface_id"]) as
              | string
              | undefined,
          );
          return;
        }
        if (payload.action === "editorReload") {
          surfaceManager.reloadEditorSurface(
            (payload.payload["surfaceId"] ?? payload.payload["surface_id"]) as
              | string
              | undefined,
          );
          return;
        }
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
      // Plan #09 — agent plans: setPlans is keyed-render so unchanged
      // plans don't blow away the visible cards.
      restorePlans: (payload) => {
        planPanel.setPlans(payload.plans);
      },
      // Plan #09 commit B — auto-continue audit ring. We render the
      // last few entries inline under the plan cards so the user
      // sees why the engine did or didn't fire.
      autoContinueAudit: (payload) => {
        planPanel.setAudit(payload.audit);
      },
      // Plan #10 commit C — ask-user push channel. Bun emits shown /
      // resolved transitions and (on demand) a snapshot. Forward each
      // into the local store; the modal subscribes to the store and
      // re-renders the head request for the active surface, the
      // sidebar badge reads pending counts. Wrapped so a bug in the
      // store can't take down the rpc dispatch loop.
      askUserEvent: (payload) => {
        try {
          if (payload.kind === "shown") {
            askUserState.pushShown(payload.request);
          } else if (payload.kind === "resolved") {
            askUserState.pushResolved(payload.request_id);
          } else if (payload.kind === "snapshot") {
            askUserState.seedSnapshot(payload.pending);
          }
        } catch (err) {
          console.error("[ask-user] state update failed:", err);
        }
      },
      sidebarFileExplorerListing: (payload) => {
        try {
          surfaceManager?.getSidebar().setFileExplorerListing(payload);
        } catch (err) {
          console.error("[sidebar-file-explorer] apply failed:", err);
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
surfaceManager.getSidebar().setFileExplorerRequester((request) => {
  rpc.send("sidebarFileExplorerList", request);
});

// τ-mux variants (Cockpit / Atlas) need a reference to surfaceManager
// to read workspace state and dispatch workspace switches without
// taking a circular import on index.ts. Installing on window is the
// same escape hatch index.ts already uses for panel registrations.
// P7 S9 (A7) — register the surface manager handle for the variant
// chrome (Atlas / Cockpit) via the typed VariantContext singleton.
// The legacy `window.__tauSurfaceManager` is still written as a
// back-compat shim until the design-review harness migrates.
variantContext.setSurfaceManager(surfaceManager);

// Plan #10 commit C — install the ask-user modal. The state is
// already populated via the askUserEvent rpc handler above; the
// modal reads the head request for the focused surface and renders.
// All ask-user wiring is wrapped in try/catch so a bug here cannot
// poison the rest of webview bootstrap (settings panel, surface
// creation, sidebar render). Snapshot seed is deferred to the same
// setTimeout that fires the initial resize so it never races with
// the bun bridge readiness.
function shouldRestoreBrowserWebviewsAfterAskModal(): boolean {
  // Ask/plan prompts are top-layer, but other overlays also hide native
  // browser OOPIF panes. Do not reveal browsers under those overlays when
  // an ask prompt closes.
  return !document.querySelector(
    ".settings-overlay.visible, .palette-overlay:not(.hidden), .process-manager-overlay.visible, .surface-details-overlay.visible, .kbd-cheatsheet:not(.hidden)",
  );
}

let askUserModalHandle: {
  rerender: () => void;
  isVisible: () => boolean;
  destroy: () => void;
} = {
  rerender: () => {},
  isVisible: () => false,
  destroy: () => {},
};
try {
  askUserModalHandle = installAskUserModal({
    state: askUserState,
    onAnswer: (request_id, value) => {
      rpc.send("askUserAnswer", { request_id, value });
    },
    onCancel: (request_id, reason) => {
      rpc.send("askUserCancel", {
        request_id,
        ...(reason ? { reason } : {}),
      });
    },
    getActiveSurfaceId: () => surfaceManager.getActiveSurfaceId(),
    getAttribution: (surface_id) => {
      try {
        const ref = surfaceManager.getSurfaceDetailsRef(surface_id);
        return {
          workspace: ref?.workspaceName ?? "",
          surface: ref?.title ?? "",
        };
      } catch {
        return { workspace: "", surface: "" };
      }
    },
    onModalShown: () => {
      surfaceManager.hideBrowserWebviews();
    },
    onModalHidden: () => {
      if (shouldRestoreBrowserWebviewsAfterAskModal()) {
        surfaceManager.showBrowserWebviews();
      }
    },
  });
  lifecycleDisposers.push(() => askUserModalHandle.destroy());
  // Sidebar badge: when the per-surface pending count changes, push a
  // per-workspace aggregation into the sidebar so the workspace card
  // can show a "1 question pending" pill.
  askUserState.subscribe(() => {
    try {
      const map = new Map<string, number>();
      const ws = surfaceManager.getWorkspaceState();
      for (const w of ws.workspaces) {
        let n = 0;
        for (const sid of w.surfaceIds) n += askUserState.getPendingCount(sid);
        if (n > 0) map.set(w.id, n);
      }
      surfaceManager.getSidebar().setAskUserPending(map);
    } catch (err) {
      console.error("[ask-user] badge update failed:", err);
    }
  });
} catch (err) {
  console.error("[ask-user] install failed — modal disabled:", err);
}

let currentSettings: AppSettings | null = null;
let variantController: VariantController | null = null;

// Settings-change pipeline. A slider drag fires `input` many times per
// frame; applying the full (heavy, O(panes)) `applySettings` synchronously on
// every event — plus a per-event persist RPC whose echo re-applied AGAIN —
// stalled the drag to one step at a time. We instead:
//   • coalesce the local apply to ONE per animation frame (smooth preview), and
//   • debounce the persist RPC so bun isn't flooded and the echo storm stops.
// `mergeSettings` clamps identically to bun, so the panel + currentSettings
// stay in lockstep with what gets persisted.
let pendingMerged: AppSettings | null = null;
let applyFrame: number | null = null;
let pendingPartial: Partial<AppSettings> = {};
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const flushSettingsPersist = () => {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (Object.keys(pendingPartial).length === 0) return;
  const toSend = pendingPartial;
  pendingPartial = {};
  rpc.send("updateSettings", { settings: toSend });
};
const settingsPanel = new SettingsPanel(
  (partial) => {
    // Eager LOCAL apply (no bun round-trip needed for preview), coalesced.
    const base = pendingMerged ?? currentSettings ?? DEFAULT_SETTINGS;
    pendingMerged = mergeSettings(base, partial);
    currentSettings = pendingMerged; // keep base current for the next tick
    if (applyFrame === null) {
      applyFrame = requestAnimationFrame(() => {
        applyFrame = null;
        if (pendingMerged) applySettings(pendingMerged);
      });
    }
    // Accumulate the partial and debounce the persist (settles ~200 ms after
    // the last change). The eager local apply already reflects it on screen.
    Object.assign(pendingPartial, partial);
    if (partial.ansiColors) {
      pendingPartial.ansiColors = {
        ...(pendingPartial.ansiColors ?? {}),
        ...partial.ansiColors,
      };
    }
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(flushSettingsPersist, 200);
  },
  {
    onRevealLogFile: () => rpc.send("revealLogFile"),
  },
);
// Flush any pending settings persist when the panel closes or the window is
// hidden, so a quick close right after a drag can't drop the last change.
lifecycleDisposers.push(() => flushSettingsPersist());
window.addEventListener("blur", flushSettingsPersist);

// Plan #09 commit B — sidebar plan widget. Mounted directly into
// the sidebar's host element so it renders before the workspace
// list. The widget hides itself when there are no plans + no
// audit entries to surface.
const planPanel = new PlanPanel({
  onSelectWorkspace: (workspaceId) => {
    surfaceManager.selectWorkspaceById(workspaceId);
  },
});
sidebarEl.appendChild(planPanel.getElement());
lifecycleDisposers.push(() => planPanel.destroy());

/** Fire `action` once the named CSS transition on `el` completes,
 *  with a safety-net fallback in case the transition doesn't fire
 *  (reduced motion, display change, identical computed value, etc.).
 *  Replaces hard-coded `setTimeout(.., 220)` blind waits with a real
 *  signal that the layout settled. The fallback duration is the old
 *  hard-coded value plus a small margin so the worst-case behaviour
 *  is unchanged. */
function afterTransition(
  el: HTMLElement,
  property: string,
  fallbackMs: number,
  action: () => void,
): void {
  let done = false;
  const handler = (e: TransitionEvent) => {
    if (e.target !== el || e.propertyName !== property) return;
    if (done) return;
    done = true;
    el.removeEventListener("transitionend", handler);
    action();
  };
  el.addEventListener("transitionend", handler);
  setTimeout(() => {
    if (done) return;
    done = true;
    el.removeEventListener("transitionend", handler);
    action();
  }, fallbackMs);
}

function applySettings(settings: AppSettings): void {
  currentSettings = settings;
  // Phase 5 / U2 — apply the chrome theme via `data-theme` so the
  // `[data-theme="…"]` token blocks in web-theme-tokens.css activate.
  // The `forced-colors: active` media query layers on top regardless,
  // and `[data-theme="system"]` defers to `prefers-color-scheme: light`.
  document.documentElement.dataset["theme"] = settings.chromeTheme;
  surfaceManager.applySettings(settings);
  planPanel.setAutoContinueAuditVisible(settings.autoContinue.engine !== "off");
  if (settingsPanel.isVisible()) settingsPanel.updateSettings(settings);
  // Plan #03 — push the latest overlay knobs to the manager. A flip
  // of `notificationOverlayEnabled` to false dismisses every live
  // overlay; an `Ms` change refreshes the auto-dismiss timers in
  // place rather than waiting for the next notification.
  notificationOverlay.setOptions({
    enabled: settings.notificationOverlayEnabled,
    autoDismissMs: settings.notificationOverlayMs,
  });
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

  // Build into an off-DOM scratch first so we can hash the result and
  // skip the mount.replaceChildren when nothing visible changed. The
  // 1 Hz tick fires whether or not state moved; this turns the steady-
  // state cost of paint+style-recalc to zero on uneventful ticks.
  const scratch = document.createElement("div");
  let first = true;
  let rendered = 0;
  for (const id of ids) {
    const el = renderStatusKey(id, ctx);
    if (!el) continue;
    if (!first) {
      const s = document.createElement("span");
      s.className = "tau-hud-sep";
      s.textContent = "·";
      scratch.appendChild(s);
    }
    scratch.appendChild(el);
    first = false;
    rendered++;
  }

  if (rendered === 0) {
    const hint = document.createElement("span");
    hint.className = "tau-status-label";
    hint.textContent =
      ids.length === 0
        ? "no status keys — enable some in Settings → Layout"
        : "no live status data yet";
    scratch.appendChild(hint);
  }

  // Hash via innerHTML — the bar is small (a handful of spans) so
  // this is well under a millisecond. Compare against the last hash
  // stored on the mount; a match means the new render is byte-
  // identical to what's already on screen, so skip the swap.
  const sig = scratch.innerHTML;
  if (mount.dataset["statusBarSig"] === sig) return;
  mount.dataset["statusBarSig"] = sig;
  mount.replaceChildren(...scratch.childNodes);
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
lifecycleDisposers.push(() => resizeObserver.disconnect());
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
  // Plan #10 commit C — request the bun-side ask-user snapshot from
  // here rather than at module load: the bridge is guaranteed ready
  // (the resize call above just used it), and a missing snapshot is
  // never fatal — the modal still works for live shown / resolved
  // events that arrive afterwards.
  try {
    rpc.send("askUserRequestSnapshot");
  } catch (err) {
    console.error("[ask-user] snapshot request failed:", err);
  }
}, 300);

const palette = new CommandPalette();
lifecycleDisposers.push(() => palette.destroy());
const keyboardCheatsheet = new KeyboardCheatsheet();
lifecycleDisposers.push(() => keyboardCheatsheet.destroy());

function syncCheatsheetBindings(): void {
  // Aggregate normal + high-priority bindings so the dialog covers
  // every shortcut a user can hit. Run on first call (KEYBOARD_BINDINGS
  // is initialized at module-load time, after this declaration); the
  // cheatsheet itself only renders on `show()`, so re-syncing is fine.
  keyboardCheatsheet.setBindings([
    ...KEYBOARD_BINDINGS,
    ...HIGH_PRIORITY_BINDINGS,
  ]);
}

/** Installed extensions, pushed by bun via `extensionList`. Drives the
 *  command-palette "Extensions: Open / Edit / Remove …" entries. Declared
 *  ABOVE the module-init `syncPaletteCommands()` call below — `buildPaletteCommands`
 *  reads these, so a later `let` would TDZ-throw during init and break every
 *  handler wired after this point. */
let availableExtensions: {
  id: string;
  name: string;
  icon?: string;
  hasBuild: boolean;
  hasBackend: boolean;
  path: string;
  backendEntry?: string;
}[] = [];
/** Bundled scaffold templates (for "Extensions: New …"). */
let extensionTemplates: string[] = [];

syncPaletteCommands();
// Ask bun for the installed-extension list so the palette has them at boot.
// Guarded so a transport hiccup can never abort the rest of module init
// (the list is re-requested every time the palette opens anyway).
try {
  rpc.send("requestExtensionList");
} catch {
  /* non-fatal — palette open will retry */
}

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
  const wsState = surfaceManager.getWorkspaceState();
  const activeWsId = wsState.activeWorkspaceId;
  const activeWs = activeWsId
    ? wsState.workspaces.find((w) => w.id === activeWsId)
    : null;
  const activeSurfaceId = surfaceManager.getActiveSurfaceId();
  const activeSurfaceType = surfaceManager.getActiveSurfaceType();
  const activeSurfaceMetadata = activeSurfaceId
    ? surfaceManager.getSurfaceMetadata(activeSurfaceId)
    : null;
  const activeSurfaceCwd = activeSurfaceMetadata?.cwd ?? null;
  const isBrowser = activeSurfaceType === "browser";
  const activePresetId = currentSettings?.themePreset ?? THEME_PRESETS[0].id;

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
      id: "workspace-rename",
      category: "Workspace",
      label: "Rename Workspace",
      description: activeWs
        ? `Change the name of "${activeWs.name}".`
        : "Change the name of the active workspace.",
      action: () => {
        if (activeWs) {
          void promptRenameWorkspace(activeWs.id, activeWs.name);
        }
      },
    },
    {
      id: "workspace-close",
      category: "Workspace",
      label: "Close Workspace",
      description: activeWs
        ? `Close "${activeWs.name}" and every pane it owns.`
        : "Close the active workspace and all its panes.",
      action: () => {
        if (activeWs) surfaceManager.closeWorkspaceById(activeWs.id);
      },
    },
    {
      id: "workspace-color",
      category: "Workspace",
      label: "Set Workspace Color",
      description: "Override the accent color for the active workspace.",
      action: async () => {
        if (!activeWs) return;
        const next = await showPromptDialog({
          title: "Workspace color",
          message:
            "Hex color (e.g. #6fe9ff). Leave blank to keep the current value.",
          initialValue: activeWs.color,
          placeholder: "#6fe9ff",
          confirmLabel: "Apply",
        });
        if (next && /^#?[0-9a-fA-F]{3,8}$/.test(next.trim())) {
          const value = next.trim().startsWith("#")
            ? next.trim()
            : `#${next.trim()}`;
          surfaceManager.setWorkspaceColor(activeWs.id, value);
        }
      },
    },
    {
      id: "workspace-cwd",
      category: "Workspace",
      label: "Set Workspace CWD",
      description:
        "Pin the cwd this workspace uses for new panes and the file explorer.",
      action: async () => {
        if (!activeWs) return;
        const next = await showPromptDialog({
          title: "Workspace cwd",
          message:
            "Absolute path used by new panes + the sidebar file explorer.",
          initialValue: activeWs.selectedCwd ?? "",
          placeholder: "/Users/me/code/foo",
          confirmLabel: "Set CWD",
        });
        if (next && next.trim()) {
          surfaceManager.setWorkspaceCwd(activeWs.id, next.trim());
        }
      },
    },
    ...wsState.workspaces.map((ws, idx) => ({
      id: `workspace-jump-${ws.id}`,
      category: "Workspace",
      label: `Switch to Workspace: ${ws.name}`,
      description: `Focus workspace ${idx + 1} (${ws.surfaceIds.length} pane${ws.surfaceIds.length === 1 ? "" : "s"}).`,
      shortcut: idx < 9 ? `\u2318${idx + 1}` : undefined,
      action: () => surfaceManager.focusWorkspaceById(ws.id),
    })),
    {
      id: "pane-rename",
      category: "Pane",
      label: "Rename Pane",
      description: "Give the focused pane a custom label.",
      action: () => {
        if (!activeSurfaceId) return;
        const title = surfaceManager.getSurfaceTitle(activeSurfaceId) ?? "";
        void promptRenameSurface(activeSurfaceId, title);
      },
    },
    {
      id: "pane-copy-cwd",
      category: "Pane",
      label: "Copy Pane CWD",
      description: activeSurfaceCwd
        ? `Copy "${activeSurfaceCwd}" to the clipboard.`
        : "Copy the focused pane's working directory to the clipboard.",
      action: () => {
        if (activeSurfaceCwd) {
          rpc.send("clipboardWrite", { text: activeSurfaceCwd });
          showToast(`Copied ${activeSurfaceCwd}`, "info");
        }
      },
    },
    {
      id: "pane-open-cwd-editor",
      category: "Pane",
      label: "Open Pane CWD in Editor",
      description:
        "Open a CodeMirror editor pane rooted at the focused pane's CWD.",
      action: () => {
        if (!activeSurfaceCwd) return;
        rpc.send("splitEditorSurface", {
          direction: "horizontal",
          cwd: activeSurfaceCwd,
        });
      },
    },
    {
      id: "editor-open-path",
      category: "Editor",
      label: "Open File in Editor",
      description:
        "Prompt for an absolute path and open it in a new editor pane.",
      action: async () => {
        const next = await showPromptDialog({
          title: "Open file",
          message: "Absolute path to a text file.",
          placeholder: activeSurfaceCwd
            ? `${activeSurfaceCwd}/`
            : "/Users/me/code/foo/README.md",
          confirmLabel: "Open",
        });
        if (next && next.trim()) {
          rpc.send("splitEditorSurface", {
            direction: "horizontal",
            path: next.trim(),
          });
        }
      },
    },
    {
      id: "browser-back",
      category: "Browser",
      label: "Browser: Back",
      description: "Navigate the focused browser pane backwards.",
      action: () => {
        if (isBrowser) surfaceManager.browserGoBack();
      },
    },
    {
      id: "browser-forward",
      category: "Browser",
      label: "Browser: Forward",
      description: "Navigate the focused browser pane forward.",
      action: () => {
        if (isBrowser) surfaceManager.browserGoForward();
      },
    },
    {
      id: "browser-reload",
      category: "Browser",
      label: "Browser: Reload",
      description: "Reload the focused browser pane.",
      action: () => {
        if (isBrowser) surfaceManager.browserReload();
      },
    },
    {
      id: "browser-devtools",
      category: "Browser",
      label: "Browser: Toggle DevTools",
      description:
        "Open or close the WebKit inspector for the focused browser pane.",
      action: () => {
        if (isBrowser) surfaceManager.browserToggleDevTools();
      },
    },
    {
      id: "browser-find",
      category: "Browser",
      label: "Browser: Find in Page",
      description: "Open the find-in-page bar for the focused browser pane.",
      action: () => {
        if (isBrowser) surfaceManager.browserFindInPage();
      },
    },
    {
      id: "browser-address-bar",
      category: "Browser",
      label: "Browser: Focus Address Bar",
      description: "Move keyboard focus to the URL field.",
      action: () => {
        if (isBrowser) surfaceManager.focusBrowserAddressBar();
      },
    },
    {
      id: "browser-zoom-in",
      category: "Browser",
      label: "Browser: Zoom In",
      description: "Increase the zoom level of the focused browser pane.",
      action: () => {
        if (isBrowser) surfaceManager.browserZoomIn();
      },
    },
    {
      id: "browser-zoom-out",
      category: "Browser",
      label: "Browser: Zoom Out",
      description: "Decrease the zoom level of the focused browser pane.",
      action: () => {
        if (isBrowser) surfaceManager.browserZoomOut();
      },
    },
    {
      id: "browser-zoom-reset",
      category: "Browser",
      label: "Browser: Reset Zoom",
      description: "Restore the focused browser pane to 100%.",
      action: () => {
        if (isBrowser) surfaceManager.browserZoomReset();
      },
    },
    ...THEME_PRESETS.map((preset) => ({
      id: `theme-${preset.id}`,
      category: "Theme",
      label: `Theme: ${preset.name}${preset.id === activePresetId ? " \u2713" : ""}`,
      description: `Apply the ${preset.name} preset (accent ${preset.accentColor}).`,
      action: () => {
        const base = currentSettings ?? DEFAULT_SETTINGS;
        const partial: Partial<AppSettings> = {
          themePreset: preset.id,
          accentColor: preset.accentColor,
          secondaryColor: preset.secondaryColor,
          foregroundColor: preset.foregroundColor,
          bgBase: preset.bgBase,
          terminalBgOpacity: preset.terminalBgOpacity,
          ansiColors: { ...preset.ansiColors },
        };
        applySettings(mergeSettings(base, partial));
        rpc.send("updateSettings", { settings: partial });
      },
    })),
    {
      id: "sidebar-clear-logs",
      category: "View",
      label: "Clear Sidebar Logs",
      description: "Clear the activity log feed in the sidebar.",
      action: () => surfaceManager.clearLogs(),
    },
    {
      id: "reveal-log-file",
      category: "View",
      label: "Reveal Log File",
      description: "Open the \u03c4-mux log file in Finder.",
      action: () => rpc.send("revealLogFile"),
    },
    {
      id: "keyboard-help",
      category: "Help",
      label: "Keyboard shortcuts",
      description: "Show the cheat-sheet of every keybinding.",
      shortcut: "\u2318?",
      action: () => keyboardCheatsheet.toggle(),
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
      // Same settings pipeline as the bloom / sound toggles: the flip
      // persists to disk and the settings panel reflects it immediately.
      // SurfaceManager re-attaches every live terminal in place, so the
      // switch is visible without reopening panes.
      id: "toggle-terminal-renderer",
      category: "View",
      label:
        (currentSettings?.terminalRenderer ?? "webgl") === "webgl"
          ? "Use DOM Terminal Renderer"
          : "Use GPU Terminal Renderer",
      description:
        (currentSettings?.terminalRenderer ?? "webgl") === "webgl"
          ? "Fall back to xterm's element-per-run renderer."
          : "Draw glyphs from a GPU texture atlas — much cheaper under heavy output.",
      action: () => {
        const next =
          (currentSettings?.terminalRenderer ?? "webgl") === "webgl"
            ? ("dom" as const)
            : ("webgl" as const);
        const base = currentSettings ?? DEFAULT_SETTINGS;
        applySettings(mergeSettings(base, { terminalRenderer: next }));
        rpc.send("updateSettings", { settings: { terminalRenderer: next } });
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
      description:
        "Creates a new browser pane to the right of the focused pane.",
      shortcut: "\u2318\u21e7L",
      action: () =>
        rpc.send("splitBrowserSurface", { direction: "horizontal" }),
    },
    {
      id: "browser-new",
      category: "Browser",
      label: "New Browser Workspace",
      description:
        "Opens a fresh workspace containing a single browser pane (does not affect the current workspace).",
      action: () => rpc.send("createBrowserSurface", {}),
    },
    {
      id: "editor-split",
      category: "Editor",
      label: "Open Editor Split",
      description: "Creates a CodeMirror editor pane next to the focused pane.",
      action: () => rpc.send("splitEditorSurface", { direction: "horizontal" }),
    },
    {
      id: "editor-new",
      category: "Editor",
      label: "New Editor Workspace",
      description: "Opens a fresh workspace containing an empty editor pane.",
      action: () => rpc.send("createEditorSurface", {}),
    },
    {
      id: "editor-save",
      category: "Editor",
      label: "Save Editor File",
      description: "Save the active CodeMirror editor pane.",
      shortcut: "⌘S",
      action: () => surfaceManager.saveEditorSurface(),
    },
    {
      id: "editor-reload",
      category: "Editor",
      label: "Reload Editor File",
      description: "Reload the active CodeMirror editor pane from disk.",
      action: () => surfaceManager.reloadEditorSurface(),
    },
    {
      id: "agent-new",
      category: "Agent",
      label: "New Agent Workspace",
      description:
        "Opens a fresh workspace containing a pi coding agent pane (does not affect the current workspace).",
      action: () => rpc.send("createAgentSurface", {}),
    },
    {
      id: "agent-split-right",
      category: "Agent",
      label: "Split Agent Right",
      description:
        "Creates a new pi coding agent pane to the right of the focused pane.",
      action: () => rpc.send("splitAgentSurface", { direction: "horizontal" }),
    },
    {
      id: "agent-split-down",
      category: "Agent",
      label: "Split Agent Down",
      description: "Creates a new pi coding agent pane below the focused pane.",
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
    // Extension apps \u2014 the editor surface. Per installed extension: Open
    // (run it), Edit (open its source in the CodeMirror editor), Remove. Plus
    // "New Extension\u2026" to scaffold from a bundled template. The list is pushed
    // by bun (`extensionList`) on startup and palette open.
    ...availableExtensions.flatMap((ext): PaletteCommand[] => {
      const label = `${ext.icon ? ext.icon + " " : ""}${ext.name}`;
      const editTarget = ext.hasBackend
        ? `${ext.path}/${ext.backendEntry}`
        : `${ext.path}/manifest.json`;
      return [
        {
          id: `extension-open-${ext.id}`,
          category: "Extensions",
          label: `Open ${label}`,
          description: `Launch the "${ext.name}" extension app in a new pane.`,
          action: () =>
            rpc.send("createExtensionSurface", { extensionId: ext.id }),
        },
        {
          id: `extension-edit-${ext.id}`,
          category: "Extensions",
          label: `Edit ${label}`,
          description: `Open ${ext.hasBackend ? ext.backendEntry : "manifest.json"} in the editor.`,
          action: () =>
            rpc.send("splitEditorSurface", {
              direction: "horizontal",
              path: editTarget,
            }),
        },
        {
          id: `extension-remove-${ext.id}`,
          category: "Extensions",
          label: `Remove ${label}`,
          description: `Uninstall "${ext.name}" (deletes its folder).`,
          action: () => {
            if (
              confirm(
                `Remove the "${ext.name}" extension? This deletes its folder.`,
              )
            ) {
              rpc.send("extensionRemove", { id: ext.id });
            }
          },
        },
      ];
    }),
    {
      id: "extension-new",
      category: "Extensions",
      label: "New Extension\u2026",
      description: extensionTemplates.length
        ? `Scaffold from a template (${extensionTemplates.join(", ")}).`
        : "Scaffold a new extension app from a bundled template.",
      action: () => void scaffoldNewExtension(),
    },
  ];
}

/** Prompt for an id + template, then ask bun to scaffold a new extension. */
async function scaffoldNewExtension(): Promise<void> {
  if (extensionTemplates.length === 0) {
    showToast("No extension templates available", "error");
    return;
  }
  const id = await showPromptDialog({
    title: "New extension",
    message: "Extension id (e.g. com.you.my-app):",
    placeholder: "com.you.my-app",
  });
  if (!id) return;
  const template = await showPromptDialog({
    title: "New extension",
    message: `Template \u2014 one of: ${extensionTemplates.join(", ")}`,
    placeholder: extensionTemplates[0],
    initialValue: extensionTemplates[0],
  });
  if (!template) return;
  rpc.send("extensionScaffold", { id: id.trim(), template: template.trim() });
  showToast(`Scaffolding ${id}\u2026`, "success");
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
  htEvents.emit("ht-workspaces-changed", undefined);
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
  // P7 S9 (A7) — typed VariantContext replaces the
  // window.__tauNotifyWorkspaces shim.
  variantContext.setNotifyWorkspaces(lastNotifyWorkspaces);
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
    // Refresh the installed-extension list so newly scaffolded/installed
    // extensions appear (the response re-runs syncPaletteCommands).
    rpc.send("requestExtensionList");
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

// Plan #03 §A — programmatic surface focus. Notification overlay
// fires this when the user taps a card body so the originating pane
// gets keyboard focus + the bun side is told.
window.addEventListener("ht-focus-surface", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (typeof detail?.surfaceId === "string") {
    surfaceManager.focusSurface(detail.surfaceId);
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
      afterTransition(terminalContainerEl, "left", 240, () =>
        surfaceManager.resizeAll(),
      );
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
      afterTransition(terminalContainerEl, "left", 240, () =>
        surfaceManager.resizeAll(),
      );
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
    // Skip browser panes: `browser.zoom-reset` claims ⌘0 there. Without
    // this guard the dispatcher would still match the browser entry first,
    // but being explicit keeps the table self-documenting.
    when: (ctx) =>
      ctx.activeSurfaceType !== "browser" &&
      ctx.activeSurfaceType !== "telegram",
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

  // Workspace switch by ordinal — ⌘1..⌘9 (I.6 / U13). Standard
  // muscle memory shared with iTerm, Warp, Wezterm, and tmux. The
  // method is a no-op when fewer workspaces exist, so the binding
  // is safe to register unconditionally.
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
    (n): Binding<KeyCtx> => ({
      id: `workspace.switch-${n}`,
      description: `Switch to workspace ${n}`,
      category: "Workspace",
      match: keyMatch({ key: String(n), meta: true, shift: false, alt: false }),
      action: () => {
        surfaceManager.selectWorkspaceByIndex(n - 1);
      },
    }),
  ),

  // Keyboard cheat-sheet — ⌘? (I.11 / U11). Discoverability for
  // every other binding above. Same array drives the rendered
  // dialog, so adding a new binding shows up in the help instantly.
  {
    id: "app.keyboard-help",
    description: "Show keyboard shortcuts",
    category: "App",
    match: keyMatch({
      key: "?",
      meta: true,
      shift: true,
    }),
    action: () => keyboardCheatsheet.toggle(),
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

  // Plan #10 commit C — ask-user modal owns its own keyboard
  // (Esc → cancel, Enter → submit, two-step click for confirm-cmd).
  // When it's visible, swallow everything else so the bindings array
  // and xterm don't see keystrokes meant for the modal. Defensive
  // guard: if the install threw and the handle is the no-op stub,
  // isVisible always returns false and we keep the existing
  // keyboard flow.
  try {
    if (askUserModalHandle.isVisible()) {
      return;
    }
  } catch (err) {
    console.error("[ask-user] isVisible check failed:", err);
  }

  const ctx: KeyCtx = {
    activeSurfaceType: surfaceManager.getActiveSurfaceType(),
  };

  if (dispatchKeyboardEvent(e, HIGH_PRIORITY_BINDINGS, ctx)) return;

  // Cheat-sheet binding may have fired and toggled visibility — no
  // re-sync needed since the bindings array is static; we sync once
  // at module bottom.

  // Command palette visible — block the rest of the bindings.
  if (palette.isVisible()) return;

  dispatchKeyboardEvent(e, KEYBOARD_BINDINGS, ctx);
});

// One-shot sync now that both binding arrays are initialized.
syncCheatsheetBindings();

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

// H13 — restart a dead (exited) agent. Spawns a fresh agent surface
// carrying the model/provider/thinking the panel knew, then closes the
// dead husk so it doesn't linger. Both are the same proven RPC paths
// the "new agent" command and pane-close use; rpc.send preserves order.
window.addEventListener("ht-agent-restart", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (!detail?.surfaceId) return;
  rpc.send("createAgentSurface", {
    provider: detail.provider,
    model: detail.model,
    thinkingLevel: detail.thinkingLevel,
  });
  rpc.send("closeSurface", { surfaceId: detail.surfaceId });
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

// Metadata poll rate follows window visibility AND focus (W2-METADATA-BLUR):
// full rate when focused, intermediate when visible-but-unfocused, slow when
// hidden. Folding focus in lets the poller back off when the user tabs away to
// another app while τ-mux stays on screen, without going fully stale.
function reportVisibility(): void {
  rpc.send("windowVisibility", {
    visible: !document.hidden,
    focused: document.hasFocus(),
  });
}
document.addEventListener("visibilitychange", () => {
  hideSurfaceContextMenu();
  reportVisibility();
});
reportVisibility();

window.addEventListener("blur", () => {
  hideSurfaceContextMenu();
  reportVisibility();
});

window.addEventListener("focus", () => {
  reportVisibility();
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

// ── Editor pane → bun ──
window.addEventListener("ht-editor-read-file", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { surfaceId?: string; path?: string; create?: boolean }
    | undefined;
  if (!detail?.surfaceId || !detail.path) return;
  rpc.send("editorReadFile", {
    surfaceId: detail.surfaceId,
    path: detail.path,
    create: detail.create,
  });
});

window.addEventListener("ht-editor-save-file", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | {
        surfaceId?: string;
        path?: string;
        content?: string;
        expectedMtimeMs?: number | null;
      }
    | undefined;
  if (!detail?.surfaceId || !detail.path || typeof detail.content !== "string")
    return;
  rpc.send("editorSaveFile", {
    surfaceId: detail.surfaceId,
    path: detail.path,
    content: detail.content,
    expectedMtimeMs: detail.expectedMtimeMs ?? null,
  });
});

window.addEventListener("ht-editor-reload-file", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { surfaceId?: string; path?: string }
    | undefined;
  if (!detail?.surfaceId || !detail.path) return;
  rpc.send("editorReloadFile", {
    surfaceId: detail.surfaceId,
    path: detail.path,
  });
});

window.addEventListener("ht-split-editor", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { path?: string; direction?: "horizontal" | "vertical" }
    | undefined;
  rpc.send("splitEditorSurface", {
    direction: detail?.direction ?? "horizontal",
    path: detail?.path,
  });
});

window.addEventListener("ht-split-extension", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { extensionId?: string; direction?: "horizontal" | "vertical" }
    | undefined;
  if (!detail?.extensionId) return;
  rpc.send("splitExtensionSurface", {
    direction: detail.direction ?? "horizontal",
    extensionId: detail.extensionId,
  });
});

window.addEventListener("ht-extension-frontend-message", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { surfaceId?: string; payload?: unknown }
    | undefined;
  if (!detail?.surfaceId) return;
  rpc.send("extensionFrontendMessage", {
    surfaceId: detail.surfaceId,
    payload: detail.payload,
  });
});

window.addEventListener("ht-open-file-in-editor", (e: Event) => {
  const detail = (e as CustomEvent).detail as
    | { path?: string; create?: boolean }
    | undefined;
  if (!detail?.path) return;
  rpc.send("splitEditorSurface", {
    direction: "horizontal",
    path: detail.path,
    create: detail.create,
  });
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

// Plan #03 §A — overlay manager. Hooks dispatch a `ht-focus-surface`
// event for click-to-focus and route close-button taps through the
// existing `notification.dismiss` RPC so sidebar + native chrome
// stay in sync. We also dismiss the local card *optimistically*
// before the RPC fires — the round-trip echo is idempotent thanks to
// `dismiss()`'s early-return on unknown id, but the local removal
// makes the click feel instant instead of laggy.
const notificationOverlay = new NotificationOverlay({
  onCardActivate: ({ id, surfaceId }) => {
    notificationOverlay.dismiss(surfaceId, id);
    htEvents.emit("ht-focus-surface", { surfaceId });
    rpc.send("dismissNotification", { id });
  },
  onCardDismiss: ({ id, surfaceId }) => {
    notificationOverlay.dismiss(surfaceId, id);
    rpc.send("dismissNotification", { id });
  },
  onOverflowClick: () => {
    surfaceManager.setSidebarVisible(true);
  },
});
lifecycleDisposers.push(() => notificationOverlay.destroy());

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
  notificationOverlay,
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
