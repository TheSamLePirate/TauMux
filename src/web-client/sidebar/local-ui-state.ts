// Per-mirror sidebar UI state — persisted in localStorage so the
// expansion / pinning choices survive a reload.
//
// Keys deliberately match the native webview's
// `tau-mux.sidebar.*` namespace so a user opening the mirror on the
// same browser as a previous session sees their pins/sections from
// before. Browsers don't share localStorage between origins (the
// webview lives at `webview://` while the mirror lives at
// `http://localhost:PORT`), but using the same names keeps the API
// surface identical and avoids divergence if origins ever align.

const LS_PREFIX = "tau-mux.sidebar.";
export const LS_PINS = LS_PREFIX + "pins";
export const LS_SECTIONS = LS_PREFIX + "sections";
export const LS_UI_STATE = LS_PREFIX + "ui-state";
export const LS_SELECTED_CWDS = LS_PREFIX + "selected-cwds";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled — silently skip */
  }
}

export interface SidebarUiPerWorkspace {
  pinned?: boolean;
  manifestsOpen?: boolean;
  panesOpen?: boolean;
  statusOpen?: boolean;
}

export interface SidebarUiState {
  workspaces: Record<string, SidebarUiPerWorkspace>;
}

const DEFAULTS: SidebarUiPerWorkspace = {
  pinned: false,
  manifestsOpen: true,
  panesOpen: false,
  statusOpen: true,
};

let cachedUiState: SidebarUiState | null = null;
let cachedSelectedCwds: Map<string, string> | null = null;

function loadUiState(): SidebarUiState {
  if (cachedUiState) return cachedUiState;
  const raw = loadJson<SidebarUiState>(LS_UI_STATE, { workspaces: {} });
  cachedUiState = {
    workspaces: { ...(raw.workspaces ?? {}) },
  };
  return cachedUiState;
}

function persistUiState(): void {
  if (!cachedUiState) return;
  saveJson(LS_UI_STATE, cachedUiState);
}

/** Read a per-workspace UI flag, falling back to the documented
 *  default. Workspace ids that aren't present in storage just return
 *  the default — no entry is created until the user actually flips a
 *  toggle (keeps the JSON small for users with hundreds of
 *  workspaces over time). */
export function getWorkspaceUi<K extends keyof SidebarUiPerWorkspace>(
  workspaceId: string,
  field: K,
): SidebarUiPerWorkspace[K] {
  const ui = loadUiState();
  return ui.workspaces[workspaceId]?.[field] ?? DEFAULTS[field];
}

export function setWorkspaceUi<K extends keyof SidebarUiPerWorkspace>(
  workspaceId: string,
  field: K,
  value: SidebarUiPerWorkspace[K],
): void {
  const ui = loadUiState();
  if (!ui.workspaces[workspaceId]) ui.workspaces[workspaceId] = {};
  ui.workspaces[workspaceId][field] = value;
  persistUiState();
}

/** Selected-cwd map driving the manifest card / cwd-chip active state.
 *  Returned as a live `Map` so the shared `buildSidebarWorkspaces`
 *  can prune stale entries by reference. */
export function loadSelectedCwds(): Map<string, string> {
  if (cachedSelectedCwds) return cachedSelectedCwds;
  const raw = loadJson<Record<string, string>>(LS_SELECTED_CWDS, {});
  cachedSelectedCwds = new Map(Object.entries(raw));
  return cachedSelectedCwds;
}

export function persistSelectedCwds(map: Map<string, string>): void {
  const obj: Record<string, string> = {};
  for (const [k, v] of map) obj[k] = v;
  saveJson(LS_SELECTED_CWDS, obj);
}

/** Test seam — drop the cached objects so a fresh `loadJson` runs.
 *  Production callers never need this. */
export function __resetForTests(): void {
  cachedUiState = null;
  cachedSelectedCwds = null;
}
