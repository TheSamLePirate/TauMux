// Re-export shim — the data-driven registry moved to
// `src/shared/status-keys.ts` in M12. The native-only `model` + `kind`
// keys, which query DOM nodes specific to the Electrobun webview, are
// registered from `./native-status-keys.ts` (imported eagerly below so
// every native consumer of `STATUS_KEY_META` / `renderStatusKey` sees
// them registered).

import "./native-status-keys";

export {
  type StatusKeyRenderer,
  type StatusKeyMeta,
  type StatusContext,
  type StatusWorkspaceInfo,
  type StatusPmSurface,
  type StatusPmWorkspace,
  type HtStatusEntry,
  STATUS_KEY_IDS,
  STATUS_KEY_META,
  STATUS_KEY_GROUPS,
  renderStatusKey,
  registerStatusKey,
  getStatusKeyMeta,
} from "../../shared/status-keys";
