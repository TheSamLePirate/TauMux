// τ-mux web mirror — read-only Process Manager overlay.
//
// Renders the same per-surface process info the native Process Manager
// shows (⌘⌥P), but with no kill action — the mirror is a viewer.
// Toggled from the toolbar; subscribes to the store and re-renders on
// any change to surface metadata.
//
// All the heavy lifting (collection / sort / totals / filter / format)
// lives in process-aggregator.ts, which is hermetically tested.

import {
  aggregateProcesses,
  filterRows,
  formatCpu,
  formatRss,
  totalsForRows,
  type ProcessRow,
} from "./process-aggregator";
import type { Store } from "./store";
import { ICONS } from "./icons";
import { escapeHtml } from "./sidebar";

export interface ProcessManagerView {
  /** Toggle visibility — wired to the toolbar button. */
  toggle(): void;
  /** Force-close the overlay. */
  close(): void;
  /** True when the overlay is currently visible. */
  isOpen(): boolean;
}

export interface ProcessManagerDeps {
  store: Store;
  /** Element to anchor the overlay into (typically document.body). */
  hostEl: HTMLElement;
  /** Toggle button — we update its `.active` class to mirror open state. */
  toggleBtn: HTMLElement;
}

const FILTER_KEY = "ht:procmgr-filter";

export function createProcessManagerView(
  deps: ProcessManagerDeps,
): ProcessManagerView {
  const { store, hostEl, toggleBtn } = deps;
  let open = false;
  let unsubscribe: (() => void) | null = null;
  let overlayEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let totalsEl: HTMLElement | null = null;
  let filterInputEl: HTMLInputElement | null = null;
  let lastFilter = "";
  try {
    lastFilter = localStorage.getItem(FILTER_KEY) ?? "";
  } catch {
    /* private mode — no persisted filter */
  }

  function build(): HTMLElement {
    const root = document.createElement("div");
    root.className = "wm-procmgr";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Process manager (read-only mirror)");
    const card = document.createElement("div");
    card.className = "wm-procmgr-card";

    const header = document.createElement("div");
    header.className = "wm-procmgr-header";
    const title = document.createElement("div");
    title.className = "wm-procmgr-title";
    title.textContent = "Processes";
    const badge = document.createElement("span");
    badge.className = "wm-procmgr-badge";
    badge.textContent = "read-only mirror";
    title.appendChild(badge);
    header.appendChild(title);

    totalsEl = document.createElement("div");
    totalsEl.className = "wm-procmgr-totals";
    header.appendChild(totalsEl);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "wm-procmgr-close";
    closeBtn.setAttribute("aria-label", "Close process manager");
    closeBtn.title = "Close (Esc)";
    closeBtn.innerHTML = ICONS.close;
    closeBtn.addEventListener("click", () => close());
    header.appendChild(closeBtn);

    card.appendChild(header);

    const filterBar = document.createElement("div");
    filterBar.className = "wm-procmgr-filter";
    const fInput = document.createElement("input");
    fInput.type = "search";
    fInput.placeholder = "Filter by command, surface, or pid…";
    fInput.value = lastFilter;
    fInput.spellcheck = false;
    fInput.autocapitalize = "off";
    fInput.autocomplete = "off";
    fInput.addEventListener("input", () => {
      lastFilter = fInput.value;
      try {
        localStorage.setItem(FILTER_KEY, lastFilter);
      } catch {
        /* private mode — silently skip */
      }
      paint();
    });
    filterInputEl = fInput;
    filterBar.appendChild(fInput);
    card.appendChild(filterBar);

    const scroller = document.createElement("div");
    scroller.className = "wm-procmgr-scroll";
    listEl = document.createElement("table");
    listEl.className = "wm-procmgr-list";
    scroller.appendChild(listEl);
    card.appendChild(scroller);

    const footer = document.createElement("div");
    footer.className = "wm-procmgr-footer";
    footer.textContent =
      "Click a row to focus the owning pane. CPU / memory polled at 1 Hz.";
    card.appendChild(footer);

    root.appendChild(card);

    // Backdrop click closes; clicking inside the card does not.
    root.addEventListener("click", (e) => {
      if (e.target === root) close();
    });
    return root;
  }

  function paint() {
    if (!open || !listEl || !totalsEl) return;
    const state = store.getState();
    const rows = aggregateProcesses({ surfaces: state.surfaces });
    const filtered = filterRows(rows, lastFilter);
    const totals = totalsForRows(filtered);

    totalsEl.textContent = `${totals.count} proc · ${formatCpu(totals.cpu)}% CPU · ${formatRss(totals.rssKb)}`;

    // Body table — header row + body rows. Re-build wholesale; rows are
    // small (<2 kB), refresh rate is 1 Hz, no animation to preserve.
    const head = `<thead><tr>
      <th class="wm-col-pid">PID</th>
      <th class="wm-col-cpu">CPU%</th>
      <th class="wm-col-mem">MEM</th>
      <th class="wm-col-cmd">Command</th>
      <th class="wm-col-surface">Surface</th>
    </tr></thead>`;
    const body = filtered.map(renderRow).join("");
    listEl.innerHTML = head + `<tbody>${body || emptyRow()}</tbody>`;
  }

  function renderRow(r: ProcessRow): string {
    const flags: string[] = [];
    if (r.isShell) flags.push("shell");
    if (r.isForeground) flags.push("fg");
    const flagBadges = flags
      .map((f) => `<span class="wm-flag wm-flag-${f}">${f}</span>`)
      .join("");
    return `<tr class="wm-row" data-action="focus-surface" data-surface="${escapeHtml(
      r.surfaceId,
    )}">
      <td class="wm-col-pid">${r.pid}</td>
      <td class="wm-col-cpu">${formatCpu(r.cpu)}</td>
      <td class="wm-col-mem">${formatRss(r.rssKb)}</td>
      <td class="wm-col-cmd">${flagBadges}<span class="wm-cmd">${escapeHtml(
        r.command,
      )}</span></td>
      <td class="wm-col-surface">${escapeHtml(r.surfaceTitle)}</td>
    </tr>`;
  }

  function emptyRow(): string {
    return `<tr><td colspan="5" class="wm-empty">No processes match this filter.</td></tr>`;
  }

  function open_() {
    if (open) return;
    open = true;
    overlayEl = build();
    hostEl.appendChild(overlayEl);
    overlayEl.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest(
        "[data-action]",
      ) as HTMLElement | null;
      if (!target) return;
      const action = target.getAttribute("data-action");
      if (action === "focus-surface") {
        const sid = target.getAttribute("data-surface");
        if (sid) {
          store.dispatch({ kind: "focus/set", surfaceId: sid });
          // Don't auto-close — the user may want to keep the overlay
          // up to compare CPU across multiple surfaces.
        }
      }
    });
    document.addEventListener("keydown", onKeydown, true);
    unsubscribe = store.subscribe(paint);
    toggleBtn.classList.add("active");
    paint();
    requestAnimationFrame(() => filterInputEl?.focus());
  }

  function close() {
    if (!open) return;
    open = false;
    if (overlayEl && overlayEl.parentNode)
      overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
    listEl = null;
    totalsEl = null;
    filterInputEl = null;
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
