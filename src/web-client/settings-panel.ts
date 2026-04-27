// τ-mux web mirror — Settings + About overlay (read-only mirror).
//
// Surfaces the knobs that actually do something in the mirror:
//
//   - Sound on / off + volume (sounds.ts)
//   - Web notifications: permission state + per-device opt-in
//   - Vibration: per-device opt-in (mobile only)
//   - Soft keyboard: per-device opt-in
//   - Pinch-zoom: per-device opt-in
//
// Plus an "About" section that shows the connection state so the user
// can verify the mirror is talking to the right server. The native
// AppSettings (shellPath, telegram tokens, etc.) are deliberately NOT
// mirrored — they're either sensitive or only meaningful for the
// desktop app.
//
// The pure summary builder (`summarizeConnection`) is hermetically
// tested.

import {
  getNotificationSoundEnabled,
  setNotificationSoundSettings,
} from "./sounds";
import {
  getNotificationsEnabled,
  setNotificationsEnabled,
  getVibrationEnabled,
  setVibrationEnabled,
  notificationApiAvailable,
  vibrationApiAvailable,
  notificationPermission,
  requestNotificationPermission,
} from "./web-notifications";
import type { AppState, Store } from "./store";
import { ICONS } from "./icons";

const PINCH_ENABLED_KEY = "ht:pinch-zoom-enabled";
const KBD_ENABLED_KEY = "ht:soft-keyboard-default";

export function getPinchZoomEnabled(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(PINCH_ENABLED_KEY);
    return raw !== "0";
  } catch {
    return true;
  }
}

export function setPinchZoomEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(PINCH_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode — silently skip */
  }
}

export function getSoftKeyboardDefault(): boolean {
  try {
    return globalThis.localStorage?.getItem(KBD_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoftKeyboardDefault(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(KBD_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode — silently skip */
  }
}

// ── Pure summary helpers ─────────────────────────────────────

export interface ConnectionSummary {
  /** Human-readable status line ("Connected · session abc123"). */
  statusText: string;
  /** "ok" / "warn" / "err" — colours the status pill. */
  statusKind: "ok" | "warn" | "err";
  /** Workspace count. */
  workspaceCount: number;
  /** Surface (terminal pane) count. */
  surfaceCount: number;
  /** Active panel (sideband overlay) count. */
  panelCount: number;
  /** Number of unread / pending notifications in the sidebar zone. */
  notificationCount: number;
  /** "Auth required" / "No auth (network-readable)" hint, derived
   *  from the page's URL token presence. */
  authText: string;
}

/** Pure: build a one-shot summary of connection + scene state. The
 *  derived fields are deterministic functions of input arguments. */
export function summarizeConnection(
  state: AppState,
  hasAuthToken: boolean,
): ConnectionSummary {
  let statusText: string;
  let statusKind: "ok" | "warn" | "err";
  switch (state.connection.status) {
    case "connected":
      statusText = state.connection.sessionId
        ? `Connected · session ${state.connection.sessionId.slice(0, 8)}`
        : "Connected";
      statusKind = "ok";
      break;
    case "connecting":
      statusText = "Connecting…";
      statusKind = "warn";
      break;
    case "disconnected":
      statusText = "Disconnected — retrying…";
      statusKind = "err";
      break;
  }
  const surfaceCount = Object.keys(state.surfaces).length;
  const panelCount = Object.keys(state.panels).length;
  const notificationCount = state.sidebar.notifications.length;
  return {
    statusText,
    statusKind,
    workspaceCount: state.workspaces.length,
    surfaceCount,
    panelCount,
    notificationCount,
    authText: hasAuthToken
      ? "Authenticated session"
      : "No auth — anyone on this network can read this terminal",
  };
}

// ── DOM ──────────────────────────────────────────────────────

export interface SettingsPanelView {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

export interface SettingsPanelDeps {
  store: Store;
  hostEl: HTMLElement;
  toggleBtn: HTMLElement;
  /** Tells the panel whether the page was loaded with an auth token. */
  hasAuthToken: boolean;
  /** Called when the user toggles "soft-keyboard default on" — the
   *  caller decides whether to show the soft keyboard now. */
  onSoftKeyboardDefaultChange?: (next: boolean) => void;
}

export function createSettingsPanelView(
  deps: SettingsPanelDeps,
): SettingsPanelView {
  const {
    store,
    hostEl,
    toggleBtn,
    hasAuthToken,
    onSoftKeyboardDefaultChange,
  } = deps;
  let open = false;
  let unsubscribe: (() => void) | null = null;
  let overlayEl: HTMLElement | null = null;
  let summaryEl: HTMLElement | null = null;

  function build(): HTMLElement {
    const root = document.createElement("div");
    root.className = "wm-settings";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Settings (read-only mirror)");

    const card = document.createElement("div");
    card.className = "wm-settings-card";

    const header = document.createElement("div");
    header.className = "wm-settings-header";
    const title = document.createElement("div");
    title.className = "wm-settings-title";
    title.textContent = "Settings";
    const badge = document.createElement("span");
    badge.className = "wm-settings-badge";
    badge.textContent = "read-only mirror";
    title.appendChild(badge);
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "wm-settings-close";
    closeBtn.title = "Close (Esc)";
    closeBtn.setAttribute("aria-label", "Close settings");
    closeBtn.innerHTML = ICONS.close;
    closeBtn.addEventListener("click", () => close());
    header.appendChild(closeBtn);
    card.appendChild(header);

    summaryEl = document.createElement("div");
    summaryEl.className = "wm-settings-summary";
    card.appendChild(summaryEl);

    // ── Audio + alerts section ───────────────────────────
    const alertsSec = section("Audio & alerts");
    alertsSec.appendChild(
      toggleRow({
        id: "wm-set-sound",
        label: "Notification sound",
        description: "Play a chime when a notification arrives.",
        initial: getNotificationSoundEnabled(),
        onChange: (next) => setNotificationSoundSettings({ enabled: next }),
      }),
    );

    if (notificationApiAvailable()) {
      const perm = notificationPermission();
      const enableInitial = getNotificationsEnabled() && perm === "granted";
      alertsSec.appendChild(
        toggleRow({
          id: "wm-set-notif",
          label: "OS notifications",
          description:
            perm === "denied"
              ? "Permission denied — enable in your browser to use this."
              : perm === "granted"
                ? "Show a system notification when the tab is in the background."
                : "Tap to grant permission, then a system notification will fire when the tab is in the background.",
          initial: enableInitial,
          disabled: perm === "denied",
          onChange: async (next) => {
            if (next && notificationPermission() !== "granted") {
              await requestNotificationPermission();
            }
            setNotificationsEnabled(
              next && notificationPermission() === "granted",
            );
            paint();
          },
        }),
      );
    }

    if (vibrationApiAvailable()) {
      alertsSec.appendChild(
        toggleRow({
          id: "wm-set-vibrate",
          label: "Vibration on alerts",
          description: "Pulse the device when a notification arrives (mobile).",
          initial: getVibrationEnabled(),
          onChange: (next) => setVibrationEnabled(next),
        }),
      );
    }
    card.appendChild(alertsSec);

    // ── Touch / mobile section ───────────────────────────
    const touchSec = section("Touch & mobile");
    touchSec.appendChild(
      toggleRow({
        id: "wm-set-pinch",
        label: "Pinch to zoom terminal",
        description:
          "Two-finger pinch resizes the terminal font in 1-px steps.",
        initial: getPinchZoomEnabled(),
        onChange: (next) => setPinchZoomEnabled(next),
      }),
    );
    touchSec.appendChild(
      toggleRow({
        id: "wm-set-kbd",
        label: "Soft-keyboard toolbar by default",
        description:
          "Show the Esc / Ctrl / arrow toolbar automatically on this device.",
        initial: getSoftKeyboardDefault(),
        onChange: (next) => {
          setSoftKeyboardDefault(next);
          onSoftKeyboardDefaultChange?.(next);
        },
      }),
    );
    card.appendChild(touchSec);

    // ── About section (read-only) ───────────────────────
    const aboutSec = section("About this mirror");
    const desc = document.createElement("div");
    desc.className = "wm-settings-desc";
    desc.textContent =
      "This is the τ-mux read-only mirror. Every change to the workspaces, panes, and notifications is broadcast from the desktop app. To configure shell, fonts, or other native behaviour, use the desktop Settings panel.";
    aboutSec.appendChild(desc);
    card.appendChild(aboutSec);

    root.appendChild(card);

    // Backdrop click closes.
    root.addEventListener("click", (e) => {
      if (e.target === root) close();
    });
    return root;
  }

  function section(title: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "wm-settings-section";
    const h = document.createElement("div");
    h.className = "wm-settings-section-title";
    h.textContent = title;
    el.appendChild(h);
    return el;
  }

  function toggleRow(opts: {
    id: string;
    label: string;
    description: string;
    initial: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void | Promise<void>;
  }): HTMLElement {
    const row = document.createElement("label");
    row.className = "wm-settings-row";
    if (opts.disabled) row.classList.add("disabled");
    row.htmlFor = opts.id;
    const text = document.createElement("div");
    text.className = "wm-settings-row-text";
    const lbl = document.createElement("div");
    lbl.className = "wm-settings-row-label";
    lbl.textContent = opts.label;
    text.appendChild(lbl);
    const desc = document.createElement("div");
    desc.className = "wm-settings-row-desc";
    desc.textContent = opts.description;
    text.appendChild(desc);
    row.appendChild(text);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "wm-settings-toggle";
    input.id = opts.id;
    input.checked = opts.initial;
    input.disabled = !!opts.disabled;
    input.addEventListener("change", async () => {
      const next = input.checked;
      try {
        await opts.onChange(next);
      } catch {
        input.checked = !next;
      }
    });
    row.appendChild(input);
    return row;
  }

  function paint() {
    if (!open || !summaryEl) return;
    const state = store.getState();
    const summary = summarizeConnection(state, hasAuthToken);
    summaryEl.innerHTML = "";
    summaryEl.appendChild(
      summaryPill(`status-${summary.statusKind}`, summary.statusText),
    );
    summaryEl.appendChild(
      summaryPill("", `${summary.workspaceCount} workspaces`),
    );
    summaryEl.appendChild(summaryPill("", `${summary.surfaceCount} panes`));
    summaryEl.appendChild(summaryPill("", `${summary.panelCount} panels`));
    summaryEl.appendChild(
      summaryPill(
        summary.notificationCount > 0 ? "status-warn" : "",
        `${summary.notificationCount} notifs`,
      ),
    );
    summaryEl.appendChild(
      summaryPill(hasAuthToken ? "status-ok" : "status-warn", summary.authText),
    );
  }

  function summaryPill(extraClass: string, text: string): HTMLElement {
    const pill = document.createElement("span");
    pill.className = `wm-settings-pill${extraClass ? " " + extraClass : ""}`;
    pill.textContent = text;
    return pill;
  }

  function open_() {
    if (open) return;
    open = true;
    overlayEl = build();
    hostEl.appendChild(overlayEl);
    document.addEventListener("keydown", onKeydown, true);
    unsubscribe = store.subscribe(paint);
    toggleBtn.classList.add("active");
    paint();
  }

  function close() {
    if (!open) return;
    open = false;
    if (overlayEl && overlayEl.parentNode)
      overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
    summaryEl = null;
    document.removeEventListener("keydown", onKeydown, true);
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    toggleBtn.classList.remove("active");
  }

  function toggle() {
    if (open) close();
    else open_();
  }

  function isOpen() {
    return open;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  return { toggle, close, isOpen };
}
