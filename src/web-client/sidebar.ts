// Web-mirror sidebar renderer.
//
// Split into four independent zones so the notification subtree stays
// stable across re-renders (which keeps the glow CSS animation running
// instead of snapping back to frame zero every time workspaces change):
//
//   sb-plan-zone    — agent plans + auto-continue audit (M17). Sits
//                     above everything else so an active plan stays
//                     visible while the user scrolls past workspaces.
//   sb-notif-zone   — notifications. Incremental per-id DOM; rows are
//                     reused across renders. Matches the native
//                     sidebar's actionable-notification UX: click body
//                     to focus the emitter, hover-revealed `×` dismiss,
//                     purple/cyan glow until acknowledged.
//   sb-main-zone    — workspaces. innerHTML rebuild on each render.
//   sb-log-zone     — logs. innerHTML rebuild on each render.
//
// Zone order matches the native sidebar in doc/system-webview-ui.md §4.

import type { AutoContinueAuditEntry, Plan } from "../shared/types";
import type { AppState, Store } from "./store";
import { ICONS } from "./icons";
import { escapeHtml } from "../shared/escape-html";
import {
  buildSidebarWorkspaces,
  type SidebarStateWorkspace,
} from "../shared/sidebar-state";
import { WorkspaceCardBuilder } from "./sidebar/workspace-card";
import {
  loadSelectedCwds,
  persistSelectedCwds,
} from "./sidebar/local-ui-state";
import {
  createPlanPanelMirror,
  type PlanPanelMirrorView,
} from "./plan-panel-mirror";

export { escapeHtml };

export interface SidebarDeps {
  store: Store;
  sendMsg: (type: string, payload: Record<string, unknown>) => void;
  sidebarEl: HTMLElement;
  sidebarToggleBtn: HTMLElement;
  workspaceSelectEl: HTMLSelectElement;
}

export interface SidebarView {
  applyVisibility(state: AppState): void;
  updateWorkspaceSelect(state: AppState): void;
  render(state: AppState): void;
  /** M17 — plan-panel setters live on the sidebar view itself so the
   *  panel survives the inner zone rebuilds (M11/M13). The protocol
   *  dispatcher routes `plansSnapshot` and `autoContinueAudit`
   *  envelopes here. */
  setPlans(plans: readonly Plan[]): void;
  setAutoContinueAudit(audit: readonly AutoContinueAuditEntry[]): void;
  setAutoContinueAuditVisible(visible: boolean): void;
}

export function createSidebarView(deps: SidebarDeps): SidebarView {
  const { store, sendMsg, sidebarEl, sidebarToggleBtn, workspaceSelectEl } =
    deps;

  // ── Zones ────────────────────────────────────────────────────────
  // Four persistent siblings inside #sidebar. Notifications live in
  // their own zone so the main / log rebuilds don't wipe them out.
  // M13 — main zone now hosts a `WorkspaceCardBuilder` that owns its
  // own per-card DOM cache and reuses unchanged sections across 1 Hz
  // metadata ticks.
  // M17 — plan zone is the new top-of-sidebar slot, owned by this
  // view so its DOM survives every inner zone rebuild.
  sidebarEl.innerHTML = "";
  const planZoneEl = document.createElement("div");
  planZoneEl.className = "sb-plan-zone";
  const notifZoneEl = document.createElement("div");
  notifZoneEl.className = "sb-notif-zone";
  const mainZoneEl = document.createElement("div");
  mainZoneEl.className = "sb-main-zone";
  const logZoneEl = document.createElement("div");
  logZoneEl.className = "sb-log-zone";
  sidebarEl.appendChild(planZoneEl);
  sidebarEl.appendChild(notifZoneEl);
  sidebarEl.appendChild(mainZoneEl);
  sidebarEl.appendChild(logZoneEl);

  // M17 — instantiate the plan panel inside the sidebar so the
  // dispatcher's `plansSnapshot` + `autoContinueAudit` envelopes flow
  // through `sidebarView.setPlans` / `setAutoContinueAudit`. The panel
  // owns its own DOM under the plan zone; the sidebar render path
  // never touches it.
  const planPanel: PlanPanelMirrorView = createPlanPanelMirror({
    hostEl: planZoneEl,
    onSelectWorkspace: (workspaceId) => {
      if (workspaceId === store.getState().activeWorkspaceId) return;
      store.dispatch({ kind: "workspace/active", workspaceId });
      store.dispatch({ kind: "fullscreen/exit" });
      sendMsg("selectWorkspace", { workspaceId });
      sendMsg("subscribeWorkspace", { workspaceId });
    },
  });

  // Persistent workspace-list host inside the main zone. The card
  // builder appends/moves cards in place; the section title above
  // it never re-renders.
  const wsHostEl = document.createElement("div");
  wsHostEl.className = "sb-workspace-list";
  const mainSectionTitle = document.createElement("div");
  mainSectionTitle.className = "sb-section-title";
  mainSectionTitle.textContent = "Workspaces";
  mainZoneEl.appendChild(mainSectionTitle);
  mainZoneEl.appendChild(wsHostEl);

  const selectedCwds = loadSelectedCwds();

  const cardBuilder = new WorkspaceCardBuilder({
    onSelectWorkspace: (workspaceId) => {
      if (workspaceId === store.getState().activeWorkspaceId) return;
      store.dispatch({ kind: "workspace/active", workspaceId });
      store.dispatch({ kind: "fullscreen/exit" });
      sendMsg("selectWorkspace", { workspaceId });
      sendMsg("subscribeWorkspace", { workspaceId });
    },
    onSelectCwd: (workspaceId, cwd) => {
      // M13 v1 — pin is web-local. Persist immediately so a reload
      // restores the user's selection. Server-side wiring is deferred
      // to v1.1 (the host's hook is null-safe).
      const current = selectedCwds.get(workspaceId);
      if (current === cwd) {
        selectedCwds.delete(workspaceId);
      } else {
        selectedCwds.set(workspaceId, cwd);
      }
      persistSelectedCwds(selectedCwds);
      sendMsg("selectWorkspaceCwd", { workspaceId, cwd });
      // The store doesn't track cwd selection directly; re-rendering
      // the sidebar picks up the change through `buildSidebarWorkspaces`.
      render(store.getState());
    },
    onRequestRerender: () => {
      // M14 — manifest expand/collapse persists in localStorage, so a
      // re-render with the same store state shows the new state.
      render(store.getState());
    },
  });

  // ── Notification state ───────────────────────────────────────────
  const notifItemEls = new Map<string, HTMLElement>();
  let notifListEl: HTMLElement | null = null;
  let notifCountEl: HTMLElement | null = null;
  // Ids the user has clicked / dismissed / whose source pane has
  // gained focus. Pruned whenever a notification leaves the list.
  const acknowledged = new Set<string>();

  // ── Click delegation — every button below carries data-action ─────
  sidebarToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = !store.getState().sidebarVisible;
    store.dispatch({ kind: "sidebar/visible", visible: next });
    sendMsg("sidebarToggle", { visible: next });
  });

  sidebarEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest("[data-action]") as HTMLElement | null;
    if (!btn) return;
    const action = btn.getAttribute("data-action");

    if (action === "clear-notifs") {
      store.dispatch({ kind: "notification/clear" });
      sendMsg("clearNotifications", {});
      return;
    }
    if (action === "select-workspace") {
      const workspaceId = btn.getAttribute("data-workspace-id");
      if (!workspaceId || workspaceId === store.getState().activeWorkspaceId) {
        return;
      }
      store.dispatch({ kind: "workspace/active", workspaceId });
      store.dispatch({ kind: "fullscreen/exit" });
      sendMsg("selectWorkspace", { workspaceId });
      sendMsg("subscribeWorkspace", { workspaceId });
      return;
    }
    if (action === "clear-logs") {
      // Client-side only — logs are local state pushed from the server;
      // clearing hides what's buffered and the next server log
      // re-populates.
      store.dispatch({
        kind: "sidebar/action",
        action: "__clearLogs",
        payload: {},
      });
      return;
    }
    if (action === "copy-log") {
      // M17 — click on a log row copies a tab-separated
      // `[HH:MM:SS] [source] [level] message` line to the clipboard
      // so the user can paste a sample into a bug report. The
      // `Clipboard` API may be unavailable on `http://` origins
      // without HTTPS; fall back to a hidden textarea + execCommand
      // so non-secure contexts still work.
      e.stopPropagation();
      const payload = btn.getAttribute("data-copy");
      if (!payload) return;
      void copyTextToClipboard(payload);
      return;
    }
    if (action === "dismiss-notif") {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      if (!id) return;
      // Optimistic local remove so the row disappears instantly; the
      // server will rebroadcast `notificationDismiss` which our
      // dispatcher applies (no-op if already gone).
      store.dispatch({ kind: "notification/remove", id });
      sendMsg("dismissNotification", { id });
      return;
    }
    if (action === "focus-notif") {
      const id = btn.getAttribute("data-id");
      const surfaceId = btn.getAttribute("data-surface-id");
      if (id) {
        acknowledged.add(id);
        const row = notifItemEls.get(id);
        if (row) row.classList.remove("glow");
      }
      if (surfaceId) {
        // focusSurface already flows to the native host via the bun-
        // side `ws.onFocusSurface` hook — it focuses the pane there
        // and broadcasts `focusChanged` back to every web client.
        sendMsg("focusSurface", { surfaceId });
      }
    }
  });

  function applyVisibility(state: AppState) {
    sidebarEl.classList.toggle("collapsed", !state.sidebarVisible);
    document.body.classList.toggle("sidebar-open", state.sidebarVisible);
  }

  function updateWorkspaceSelect(state: AppState) {
    workspaceSelectEl.innerHTML = "";
    for (const ws of state.workspaces) {
      const opt = document.createElement("option");
      opt.value = ws.id;
      opt.textContent = ws.name || ws.id;
      if (ws.id === state.activeWorkspaceId) opt.selected = true;
      workspaceSelectEl.appendChild(opt);
    }
  }

  function render(state: AppState) {
    renderNotifications(state);
    renderMain(state);
    renderLogs(state);
  }

  // ── Notifications ─ incremental DOM (preserves glow animation) ───

  function renderNotifications(state: AppState) {
    const notifs = state.sidebar.notifications;

    if (notifs.length === 0) {
      notifZoneEl.innerHTML = "";
      notifListEl = null;
      notifCountEl = null;
      notifItemEls.clear();
      return;
    }

    // Build the persistent shell on first use. Subsequent renders keep
    // the same elements — we only swap the header count text and the
    // notification rows individually.
    if (!notifListEl || !notifCountEl) {
      notifZoneEl.innerHTML = "";
      const header = document.createElement("div");
      header.className = "sb-section-title sb-notif-header";
      notifCountEl = document.createElement("span");
      header.appendChild(notifCountEl);
      const clearBtn = document.createElement("button");
      clearBtn.className = "sb-section-clear";
      clearBtn.setAttribute("data-action", "clear-notifs");
      clearBtn.setAttribute("title", "Clear all notifications");
      clearBtn.setAttribute("aria-label", "Clear all notifications");
      clearBtn.innerHTML = ICONS.close;
      header.appendChild(clearBtn);
      notifZoneEl.appendChild(header);

      notifListEl = document.createElement("div");
      notifListEl.className = "sb-notif-list";
      notifZoneEl.appendChild(notifListEl);
    }

    notifCountEl.textContent = `Notifications (${notifs.length})`;

    // Auto-acknowledge every notification bound to the currently
    // focused surface — matches the native webview where focusing a
    // pane silently quiets its own pending notification rows (the
    // "I've seen it" signal).
    if (state.focusedSurfaceId) {
      for (const n of notifs) {
        if (n.surfaceId === state.focusedSurfaceId) acknowledged.add(n.id);
      }
    }

    // Prune acknowledged ids that no longer exist so a reused id later
    // still glows.
    const alive = new Set(notifs.map((n) => n.id));
    for (const id of [...acknowledged]) {
      if (!alive.has(id)) acknowledged.delete(id);
    }

    // Render the newest 5 in reverse (top = most recent).
    const visible = notifs.slice(-5).reverse();
    const visibleIds = new Set(visible.map((n) => n.id));

    // Remove rows that fell out of the window.
    for (const [id, el] of [...notifItemEls]) {
      if (!visibleIds.has(id)) {
        el.remove();
        notifItemEls.delete(id);
      }
    }

    // Insert new rows in the right position; update existing rows'
    // glow class without rebuilding them.
    let cursor: ChildNode | null = notifListEl.firstChild;
    for (const n of visible) {
      const existing = notifItemEls.get(n.id);
      if (existing) {
        updateNotifRow(existing, n);
        cursor = existing.nextSibling;
      } else {
        const el = buildNotifRow(n);
        notifItemEls.set(n.id, el);
        notifListEl.insertBefore(el, cursor);
      }
    }
  }

  function buildNotifRow(n: {
    id: string;
    title: string;
    body: string;
    surfaceId?: string;
    at: number;
  }): HTMLElement {
    const el = document.createElement("div");
    el.className = "sb-notif";
    const hasSource = typeof n.surfaceId === "string" && n.surfaceId.length > 0;
    if (hasSource) el.classList.add("has-source");
    if (!acknowledged.has(n.id)) el.classList.add("glow");
    el.setAttribute("data-id", n.id);
    el.title = hasSource
      ? "Click to focus the pane that emitted this notification"
      : "";

    // Clickable body — only wired when we have a surfaceId, else the
    // button is still rendered for DOM symmetry but does nothing
    // useful. The click handler short-circuits on missing data-surface-id.
    const body = document.createElement("button");
    body.type = "button";
    body.className = "sb-notif-body-btn";
    body.setAttribute("data-action", "focus-notif");
    body.setAttribute("data-id", n.id);
    if (hasSource) body.setAttribute("data-surface-id", n.surfaceId!);

    const titleEl = document.createElement("div");
    titleEl.className = "sb-notif-title";
    titleEl.textContent = n.title;
    body.appendChild(titleEl);
    if (n.body) {
      const msgEl = document.createElement("div");
      msgEl.className = "sb-notif-body";
      msgEl.textContent = n.body;
      body.appendChild(msgEl);
    }
    el.appendChild(body);

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "sb-notif-dismiss";
    dismiss.setAttribute("data-action", "dismiss-notif");
    dismiss.setAttribute("data-id", n.id);
    dismiss.setAttribute("title", "Dismiss notification");
    dismiss.setAttribute("aria-label", "Dismiss notification");
    dismiss.innerHTML = ICONS.close;
    el.appendChild(dismiss);

    return el;
  }

  function updateNotifRow(
    el: HTMLElement,
    n: { id: string; surfaceId?: string },
  ): void {
    // Glow is the only thing that can flip while a row survives across
    // renders — other fields (title, body, surfaceId) are immutable
    // once minted server-side.
    el.classList.toggle("glow", !acknowledged.has(n.id));
    // Defensive: if a focus came in from elsewhere and we just
    // learned the surface binding, keep the button's data attr fresh.
    const btn = el.querySelector(
      "[data-action='focus-notif']",
    ) as HTMLElement | null;
    if (btn && n.surfaceId) btn.setAttribute("data-surface-id", n.surfaceId);
  }

  // ── Main (workspaces) — structured per-card builder with section
  // signature caching. Replaces M11 string-concat so 1 Hz metadata
  // ticks don't blow away the card subtree (focus rings, expansion
  // state, sparkline DOM all survive across renders).

  // Web mirror v1 has no script-error tracking — manifest cards are
  // deferred to M14 anyway, so we feed an empty map and let the
  // shared builder skip the error-pill branch.
  const SCRIPT_ERRORS_EMPTY = new Map<string, number>();

  function renderMain(state: AppState) {
    const { workspaces, sidebar } = state;
    if (workspaces.length === 0) {
      wsHostEl.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "sb-empty";
      empty.textContent = "No workspaces";
      wsHostEl.appendChild(empty);
      return;
    }
    // Project the wire workspaces + AppState slices into the abstract
    // shape `buildSidebarWorkspaces` expects. Cheap because every
    // input is already in `state` — we just wrap arrays as Sets and
    // status records as Maps.
    const surfaces = new Map<string, { title: string }>();
    const metadata = new Map<
      string,
      import("../shared/types").SurfaceMetadata
    >();
    for (const sid in state.surfaces) {
      const s = state.surfaces[sid]!;
      surfaces.set(sid, { title: s.title });
      if (s.metadata) metadata.set(sid, s.metadata);
    }

    const adaptedWorkspaces: SidebarStateWorkspace[] = workspaces.map((w) => {
      const statusMap = new Map<
        string,
        { value: string; icon?: string; color?: string }
      >();
      const bucket = sidebar.status[w.id] ?? {};
      for (const k of Object.keys(bucket)) statusMap.set(k, bucket[k]!);
      return {
        id: w.id,
        name: w.name,
        color: w.color,
        surfaceIdsInLayoutOrder: collectSurfaceIdsInOrder(w.layout),
        surfaceIdSet: new Set(w.surfaceIds),
        status: statusMap,
        progress: sidebar.progress[w.id] ?? null,
      };
    });

    const activeIdx = workspaces.findIndex(
      (w) => w.id === state.activeWorkspaceId,
    );
    const infos = buildSidebarWorkspaces({
      workspaces: adaptedWorkspaces,
      surfaces,
      focusedSurfaceId: state.focusedSurfaceId,
      activeWorkspaceIndex: activeIdx,
      metadata,
      selectedCwds,
      scriptErrors: SCRIPT_ERRORS_EMPTY,
      htStatusKeyOrder: state.settings?.htStatusKeyOrder ?? [],
      htStatusKeyHidden: state.settings?.htStatusKeyHidden ?? [],
    });

    cardBuilder.render(infos, wsHostEl);
  }

  // Helper: walk a wire `PaneNode` tree depth-first to extract the
  // surface id list in display order. Mirrors PaneLayout.getAllSurfaceIds.
  function collectSurfaceIdsInOrder(node: unknown): string[] {
    const out: string[] = [];
    walkLayout(node, out);
    return out;
  }
  function walkLayout(node: unknown, out: string[]): void {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      surfaceId?: string;
      children?: unknown[];
    };
    if (n.type === "leaf" && typeof n.surfaceId === "string") {
      out.push(n.surfaceId);
      return;
    }
    if (Array.isArray(n.children))
      for (const c of n.children) walkLayout(c, out);
  }

  // ── Logs ─── M17 polished renderer.
  //
  // Each row carries: a coloured level badge (info/warning/error/
  // success), the optional source label (`pi-bridge`, `ht`, …), an
  // `HH:MM:SS` timestamp from the entry's `at` field, and the
  // message body. Click anywhere on a row copies the underlying
  // `[HH:MM:SS] [source] [level] message` line to the clipboard so
  // a remote user can paste a snippet into a bug report. Up to 10
  // rows are rendered for perf even though the store retains 200;
  // the header shows `Logs (count) (showing 10)` so the cap is
  // explicit.

  // W2-WEB-LOGS — `render()` fires whenever `state.sidebar` changes, which
  // happens on every setStatus/progress tick (a fresh sidebar object, same
  // logs array). The store mints a NEW logs array only on the `log` and
  // clear-logs actions, so a reference compare skips the innerHTML rebuild on
  // every unrelated tick (native already does this — only setLogs calls it).
  let lastRenderedLogs: AppState["sidebar"]["logs"] | null = null;
  function renderLogs(state: AppState) {
    const logs = state.sidebar.logs;
    if (logs === lastRenderedLogs) return;
    lastRenderedLogs = logs;
    if (logs.length === 0) {
      logZoneEl.innerHTML = "";
      return;
    }
    const visible = logs.slice(-10).reverse();
    const showingNote =
      logs.length > visible.length ? ` (showing ${visible.length})` : "";
    let html =
      '<div class="sb-section"><div class="sb-section-title">Logs (' +
      logs.length +
      ")" +
      showingNote +
      '<button class="sb-section-clear" data-action="clear-logs">' +
      ICONS.close +
      "</button></div>";
    for (const l of visible) {
      const level =
        l.level === "error" ||
        l.level === "warning" ||
        l.level === "success" ||
        l.level === "info"
          ? l.level
          : "info";
      const ts = formatLogTimestamp(l.at);
      const source = l.source ? l.source : "";
      const copyPayload = `[${ts}]${source ? ` [${source}]` : ""} [${level}] ${l.message}`;
      html +=
        `<button class="sb-log ${level}" data-action="copy-log" ` +
        `data-copy="${escapeHtml(copyPayload)}" title="Click to copy">` +
        `<span class="sb-log-badge sb-log-badge-${level}" aria-label="${level}"></span>` +
        `<span class="sb-log-time tau-mono">${escapeHtml(ts)}</span>` +
        (source
          ? `<span class="sb-log-source">${escapeHtml(source)}</span>`
          : "") +
        `<span class="sb-log-msg">${escapeHtml(l.message)}</span>` +
        "</button>";
    }
    html += "</div>";
    logZoneEl.innerHTML = html;
  }

  /** `HH:MM:SS` formatter — `Date.toLocaleTimeString` gives 12-hour
   *  on en-US locales which is the wrong density for a debug log.
   *  Pad each component to 2 digits and pin to the user's local
   *  timezone (no UTC drift while debugging). */
  function formatLogTimestamp(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "--:--:--";
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  /** Copy text to the clipboard. Prefers the modern async API,
   *  falls back to a hidden textarea + `execCommand("copy")` on
   *  non-secure origins (the web mirror commonly runs over plain
   *  `http://` on a LAN, which disables `navigator.clipboard`). */
  async function copyTextToClipboard(text: string): Promise<void> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      /* fall through to legacy path */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch {
      /* every browser path failed — silently no-op so we don't
       * crash the click handler. */
    }
  }

  return {
    applyVisibility,
    updateWorkspaceSelect,
    render,
    setPlans: (plans) => planPanel.setPlans(plans),
    setAutoContinueAudit: (audit) => planPanel.setAudit(audit),
    setAutoContinueAuditVisible: (visible) =>
      planPanel.setAutoContinueAuditVisible(visible),
  };
}
