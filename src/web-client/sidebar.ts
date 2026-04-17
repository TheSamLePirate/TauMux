// Web-mirror sidebar renderer.
//
// Pure-ish: given the store + DOM handles, renders workspaces,
// notifications and logs into the sidebar element. Also wires the
// sidebar-toggle button and the sidebar click delegation for
// "clear notifications" / "clear logs" actions.
//
// The only reason renderSidebar isn't pure is that it owns innerHTML
// of the sidebar element. HTML is built by string concat with
// escapeHtml on user-provided fields.

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
    } else if (action === "clear-logs") {
      // Client-side only — logs are local state pushed from the server.
      // Clearing just hides what's buffered; next server log re-populates.
      store.dispatch({
        kind: "sidebar/action",
        action: "__clearLogs",
        payload: {},
      });
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
        html += '<div class="sb-ws' + (active ? " active" : "") + '">';
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

    if (sidebar.notifications.length > 0) {
      html +=
        '<div class="sb-section"><div class="sb-section-title">Notifications (' +
        sidebar.notifications.length +
        ')<button class="sb-section-clear" data-action="clear-notifs">' +
        ICONS.close +
        "</button></div>";
      const notifs = sidebar.notifications.slice(-5).reverse();
      for (const n of notifs) {
        html += '<div class="sb-notif">';
        html += '<div class="sb-notif-title">' + escapeHtml(n.title) + "</div>";
        if (n.body)
          html += '<div class="sb-notif-body">' + escapeHtml(n.body) + "</div>";
        html += "</div>";
      }
      html += "</div>";
    }
    if (sidebar.logs.length > 0) {
      html +=
        '<div class="sb-section"><div class="sb-section-title">Logs (' +
        sidebar.logs.length +
        ')<button class="sb-section-clear" data-action="clear-logs">' +
        ICONS.close +
        "</button></div>";
      const logs = sidebar.logs.slice(-10).reverse();
      for (const l of logs) {
        const cls =
          l.level === "error" || l.level === "warning" || l.level === "success"
            ? " " + l.level
            : "";
        html +=
          '<div class="sb-log' + cls + '">' + escapeHtml(l.message) + "</div>";
      }
      html += "</div>";
    }
    sidebarEl.innerHTML = html;
  }

  return { applyVisibility, updateWorkspaceSelect, render };
}
