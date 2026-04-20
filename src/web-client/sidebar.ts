// Web-mirror sidebar renderer.
//
// Split into three independent zones so the notification subtree stays
// stable across re-renders (which keeps the glow CSS animation running
// instead of snapping back to frame zero every time workspaces change):
//
//   sb-notif-zone   — notifications. Incremental per-id DOM; rows are
//                     reused across renders. Matches the native
//                     sidebar's actionable-notification UX: click body
//                     to focus the emitter, hover-revealed `×` dismiss,
//                     purple/cyan glow until acknowledged.
//   sb-main-zone    — workspaces. innerHTML rebuild on each render.
//   sb-log-zone     — logs. innerHTML rebuild on each render.
//
// Zone order puts notifications at the top, mirroring the native
// sidebar in doc/system-webview-ui.md §4.

import type { AppState, Store } from "./store";
import { ICONS } from "./icons";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
}

export function createSidebarView(deps: SidebarDeps): SidebarView {
  const { store, sendMsg, sidebarEl, sidebarToggleBtn, workspaceSelectEl } =
    deps;

  // ── Zones ────────────────────────────────────────────────────────
  // Three persistent siblings inside #sidebar. Notifications live in
  // their own zone so the main / log rebuilds don't wipe them out.
  sidebarEl.innerHTML = "";
  const notifZoneEl = document.createElement("div");
  notifZoneEl.className = "sb-notif-zone";
  const mainZoneEl = document.createElement("div");
  mainZoneEl.className = "sb-main-zone";
  const logZoneEl = document.createElement("div");
  logZoneEl.className = "sb-log-zone";
  sidebarEl.appendChild(notifZoneEl);
  sidebarEl.appendChild(mainZoneEl);
  sidebarEl.appendChild(logZoneEl);

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

  // ── Main (workspaces) ─── string-concat; cheap, tiny subtree ─────

  function renderMain(state: AppState) {
    const { workspaces, activeWorkspaceId, sidebar } = state;
    let html = "";
    html +=
      '<div class="sb-section"><div class="sb-section-title">Workspaces</div>';
    if (workspaces.length === 0) {
      html += '<div class="sb-empty">No workspaces</div>';
    } else {
      workspaces.forEach((ws, i) => {
        const active = ws.id === activeWorkspaceId;
        const color = ws.color || "#89b4fa";
        html +=
          '<div class="sb-ws' +
          (active ? " active" : "") +
          '" data-action="select-workspace" data-workspace-id="' +
          escapeHtml(ws.id) +
          '">';
        html +=
          '<div class="sb-ws-name"><span class="sb-ws-dot" style="background:' +
          color +
          '"></span>' +
          escapeHtml(ws.name || "Workspace " + (i + 1)) +
          "</div>";
        const count = ws.surfaceIds?.length ?? 0;
        html +=
          '<div class="sb-ws-meta">' +
          (active ? "Active" : "Standby") +
          " \u00b7 " +
          count +
          " pane" +
          (count !== 1 ? "s" : "") +
          "</div>";
        const st = sidebar.status[ws.id];
        if (st) {
          html += '<div class="sb-ws-pills">';
          for (const k in st)
            html +=
              '<span class="sb-pill">' +
              escapeHtml(k) +
              ": " +
              escapeHtml(st[k]!.value) +
              "</span>";
          html += "</div>";
        }
        const pr = sidebar.progress[ws.id];
        if (pr) {
          html +=
            '<div class="sb-progress"><div class="sb-progress-bar" style="width:' +
            Math.min(100, Math.max(0, pr.value)) +
            '%"></div></div>';
        }
        html += "</div>";
      });
    }
    html += "</div>";
    mainZoneEl.innerHTML = html;
  }

  // ── Logs ─── string-concat; clear button still routes via data-action

  function renderLogs(state: AppState) {
    const logs = state.sidebar.logs;
    if (logs.length === 0) {
      logZoneEl.innerHTML = "";
      return;
    }
    let html =
      '<div class="sb-section"><div class="sb-section-title">Logs (' +
      logs.length +
      ')<button class="sb-section-clear" data-action="clear-logs">' +
      ICONS.close +
      "</button></div>";
    const visible = logs.slice(-10).reverse();
    for (const l of visible) {
      const cls =
        l.level === "error" || l.level === "warning" || l.level === "success"
          ? " " + l.level
          : "";
      html +=
        '<div class="sb-log' + cls + '">' + escapeHtml(l.message) + "</div>";
    }
    html += "</div>";
    logZoneEl.innerHTML = html;
  }

  return { applyVisibility, updateWorkspaceSelect, render };
}
