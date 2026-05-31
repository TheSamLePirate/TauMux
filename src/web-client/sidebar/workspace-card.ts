// Per-workspace sidebar card builder.
//
// Mirrors the native `populateWorkspaceCard` (src/views/terminal/sidebar.ts)
// but rendered against the web mirror's projected `WorkspaceInfo`.
// Each section caches its DOM by a stable signature so a 1 Hz
// metadata tick that doesn't actually change visible content reuses
// the existing nodes — no flicker, no re-layout.
//
// Sections:
//   - stripe       : 3 px coloured left rail
//   - header       : workspace name, dot, pane-count badge
//   - meta         : focused command + listening ports
//   - stats        : aggregated CPU + RAM + sparkline
//   - cwds         : pinned-cwd chip row
//   - panes        : collapsible pane list
//   - status       : ht set-status pill grid
//   - progress     : OSC 9;4 / ht set-progress bar
//   - manifests    : (deferred to M14 — placeholder rendered when
//                    package.json or Cargo.toml is present so the
//                    user sees the workspace surfaces a manifest)
//
// Manifest action buttons (run / build / dev / …) ship in M14.

import { renderStatusEntry } from "../../shared/status-render";
import { parseStatusKey } from "../../shared/status-key";
import type { WorkspaceInfo } from "../../shared/sidebar-state";
import { shortenCwd, formatRss } from "../../shared/sidebar-format";
import { buildCpuSparkline } from "./cpu-sparkline";
import { getWorkspaceUi, setWorkspaceUi } from "./local-ui-state";
import { buildManifestsSection } from "./card-manifests";

export interface WorkspaceCardCallbacks {
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectCwd: (workspaceId: string, cwd: string) => void;
  /** M14 — re-render the sidebar after a manifest expand/collapse so
   *  the open/closed flip lands on screen without waiting for the
   *  next 1 Hz tick. */
  onRequestRerender: () => void;
}

type SectionKey =
  | "stripe"
  | "header"
  | "meta"
  | "stats"
  | "cwds"
  | "panes"
  | "manifests"
  | "status"
  | "progress";

interface CardCache {
  el: HTMLElement;
  /** Per-section DOM + signature. Hit → reuse element, skip rebuild. */
  slots: Partial<Record<SectionKey, { el: HTMLElement; sig: string }>>;
}

/** Section signature builders — small functions that summarise the
 *  slice of `WorkspaceInfo` driving each section. Two consecutive
 *  ticks producing the same signature short-circuit the rebuild. */
const sigStripe = (ws: WorkspaceInfo) => `${ws.color ?? ""}|${ws.active}`;
const sigHeader = (ws: WorkspaceInfo) =>
  `${ws.id}|${ws.name}|${ws.color ?? ""}|${ws.active}|${ws.surfaceTitles.length}`;
const sigMeta = (ws: WorkspaceInfo) =>
  `${ws.focusedSurfaceCommand ?? ""}|${ws.listeningPorts.join(",")}`;
const sigStats = (ws: WorkspaceInfo) =>
  `${ws.cpuPercent.toFixed(1)}|${ws.memRssKb}|${ws.processCount}|${ws.cpuHistory.join(",")}`;
const sigCwds = (ws: WorkspaceInfo) =>
  `${ws.cwds.join("|")}|${ws.selectedCwd ?? ""}`;
const sigPanes = (ws: WorkspaceInfo) =>
  `${ws.surfaceTitles.join("|")}|${ws.focusedSurfaceTitle ?? ""}`;
// STRUCTURAL only (keys + layout). Value changes reconcile into the
// existing status grid (reconcileStatus) instead of rebuilding the whole
// section — so charts don't flicker on every `ht set-status` tick.
const sigStatus = (ws: WorkspaceInfo) =>
  ws.statusPills
    .map((p) => `${p.key}:${parseStatusKey(p.key).layout}`)
    .join(";");

const statusEntrySig = (p: WorkspaceInfo["statusPills"][number]) =>
  `${p.value}|${p.color ?? ""}|${p.icon ?? ""}`;
const sigProgress = (ws: WorkspaceInfo) =>
  ws.progress ? `${ws.progress.value}|${ws.progress.label ?? ""}` : "";
const sigManifests = (ws: WorkspaceInfo, expandedSig: string) =>
  [
    ws.packageJson?.path ?? "",
    ws.packageJson?.version ?? "",
    Object.keys(ws.packageJson?.scripts ?? {}).join(","),
    ws.runningScripts.join(","),
    ws.erroredScripts.join(","),
    ws.cargoToml?.path ?? "",
    ws.cargoToml?.version ?? "",
    ws.cargoToml?.isWorkspace ? "ws" : "crate",
    (ws.cargoToml?.binaries ?? []).join(","),
    ws.runningCargoActions.join(","),
    ws.erroredCargoActions.join(","),
    expandedSig,
  ].join("|");

export class WorkspaceCardBuilder {
  private caches = new Map<string, CardCache>();

  constructor(private callbacks: WorkspaceCardCallbacks) {}

  /** Render the full workspace list into `host`. Each card is a
   *  long-lived DOM node whose section children get rebuilt only on
   *  signature drift. New / removed workspaces are added / pruned as
   *  needed; the order matches the input array. */
  render(workspaces: readonly WorkspaceInfo[], host: HTMLElement): void {
    const seen = new Set<string>();
    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i]!;
      seen.add(ws.id);
      const card = this.ensureCard(ws);
      this.populateCard(card, ws);
      // Move the card into the right slot. `host.appendChild(existing)`
      // is a no-op if it's already in the right place.
      host.appendChild(card.el);
    }
    // Drop cards for workspaces no longer present.
    for (const [id, card] of this.caches) {
      if (!seen.has(id)) {
        card.el.remove();
        this.caches.delete(id);
      }
    }
  }

  private ensureCard(ws: WorkspaceInfo): CardCache {
    let card = this.caches.get(ws.id);
    if (card) return card;
    const el = document.createElement("div");
    el.className = "workspace-item";
    el.setAttribute("data-workspace-id", ws.id);
    el.setAttribute("data-action", "select-workspace");
    el.addEventListener("click", (e) => {
      // Inner controls (cwd chips, pane list toggle) stop their own
      // events; the bare card click selects the workspace.
      const target = e.target as HTMLElement;
      if (target.closest("[data-stop]") || target.closest("[data-action]"))
        return;
      this.callbacks.onSelectWorkspace(ws.id);
    });
    card = { el, slots: {} };
    this.caches.set(ws.id, card);
    return card;
  }

  private populateCard(card: CardCache, ws: WorkspaceInfo): void {
    card.el.classList.toggle("active", ws.active);
    card.el.style.setProperty(
      "--workspace-color",
      ws.color ?? "var(--ht-accent)",
    );

    this.section(card, "stripe", sigStripe(ws), () => buildStripe(ws));
    this.section(card, "header", sigHeader(ws), () => buildHeader(ws));
    this.section(card, "meta", sigMeta(ws), () => buildMeta(ws));
    if (ws.active) {
      this.section(card, "stats", sigStats(ws), () => buildStats(ws));
      this.section(card, "cwds", sigCwds(ws), () =>
        buildCwds(ws, this.callbacks.onSelectCwd),
      );
      this.section(card, "panes", sigPanes(ws), () => buildPanes(ws));
      // Manifest section signature factors in the per-key
      // expand/collapse state (read from local-ui-state) so a click
      // on the chevron rebuilds the right card without forcing a
      // full sidebar re-render.
      const expandedSig = manifestExpandedSignature(ws);
      this.section(card, "manifests", sigManifests(ws, expandedSig), () =>
        buildManifestsSection(ws, {
          requestRerender: this.callbacks.onRequestRerender,
        }),
      );
      this.statusSection(card, ws);
      this.section(card, "progress", sigProgress(ws), () => buildProgress(ws));
    } else {
      // Inactive cards collapse to stripe + header + meta only —
      // matches the native sidebar density.
      this.removeSlot(card, "stats");
      this.removeSlot(card, "cwds");
      this.removeSlot(card, "panes");
      this.removeSlot(card, "manifests");
      this.removeSlot(card, "status");
      this.removeSlot(card, "progress");
    }
  }

  private section(
    card: CardCache,
    key: SectionKey,
    sig: string,
    build: () => HTMLElement,
  ): void {
    const slot = card.slots[key];
    if (slot && slot.sig === sig) {
      // Already in DOM at the right place; nothing to do.
      card.el.appendChild(slot.el);
      return;
    }
    const el = build();
    el.setAttribute("data-section", key);
    if (slot) slot.el.replaceWith(el);
    else card.el.appendChild(el);
    card.slots[key] = { el, sig };
  }

  /** Status section is ALWAYS reconciled in place (never rebuilt while the
   *  card lives): value changes, key add/remove, and reorder all patch the
   *  existing grid, so an unchanged entry's chart SVG is never torn down.
   *  This is what removes the flicker on a `ht set-status` tick. */
  private statusSection(card: CardCache, ws: WorkspaceInfo): void {
    const slot = card.slots["status"];
    if (slot) {
      reconcileStatus(slot.el, ws);
      card.el.appendChild(slot.el); // keep DOM order
      return;
    }
    const el = buildStatus(ws);
    el.setAttribute("data-section", "status");
    card.el.appendChild(el);
    card.slots["status"] = { el, sig: sigStatus(ws) };
  }

  private removeSlot(card: CardCache, key: SectionKey): void {
    const slot = card.slots[key];
    if (!slot) return;
    slot.el.remove();
    delete card.slots[key];
  }
}

// ── Section builders ─────────────────────────────────────────────

function buildStripe(_ws: WorkspaceInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-stripe";
  return el;
}

function buildHeader(ws: WorkspaceInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-card-header";
  const dot = document.createElement("span");
  dot.className = "workspace-dot";
  dot.style.background = ws.color ?? "var(--ht-accent)";
  el.appendChild(dot);
  const name = document.createElement("span");
  name.className = "workspace-name";
  name.textContent = ws.name || ws.id;
  el.appendChild(name);
  const badge = document.createElement("span");
  badge.className = "workspace-pane-count";
  badge.textContent = `${ws.surfaceTitles.length} pane${
    ws.surfaceTitles.length !== 1 ? "s" : ""
  }`;
  el.appendChild(badge);
  return el;
}

function buildMeta(ws: WorkspaceInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-meta";
  if (ws.focusedSurfaceCommand) {
    const cmd = document.createElement("div");
    cmd.className = "workspace-focused-cmd tau-mono";
    cmd.title = ws.focusedSurfaceCommand;
    cmd.textContent = ws.focusedSurfaceCommand;
    el.appendChild(cmd);
  }
  if (ws.listeningPorts.length > 0) {
    const portsEl = document.createElement("div");
    portsEl.className = "workspace-ports";
    const visible = ws.listeningPorts.slice(0, 3);
    for (const p of visible) {
      const chip = document.createElement("a");
      chip.className = "workspace-port-chip";
      chip.textContent = `:${p}`;
      chip.href = `http://localhost:${p}`;
      chip.target = "_blank";
      chip.rel = "noreferrer noopener";
      chip.setAttribute("data-stop", "1");
      portsEl.appendChild(chip);
    }
    if (ws.listeningPorts.length > visible.length) {
      const more = document.createElement("span");
      more.className = "workspace-port-chip more";
      more.textContent = `+${ws.listeningPorts.length - visible.length}`;
      portsEl.appendChild(more);
    }
    el.appendChild(portsEl);
  }
  return el;
}

function buildStats(ws: WorkspaceInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-stats";

  const cpuRow = document.createElement("div");
  cpuRow.className = "workspace-cpu-row";
  const cpuLabel = document.createElement("span");
  cpuLabel.className = "workspace-cpu-label";
  cpuLabel.textContent = "cpu";
  cpuRow.appendChild(cpuLabel);
  const cpuValue = document.createElement("span");
  cpuValue.className = "workspace-cpu-value tau-mono";
  cpuValue.textContent = `${Math.round(ws.cpuPercent)}%`;
  cpuRow.appendChild(cpuValue);
  cpuRow.appendChild(buildCpuSparkline(ws.cpuHistory));
  el.appendChild(cpuRow);

  const chips = document.createElement("div");
  chips.className = "workspace-stat-chips";
  chips.appendChild(makeChip("ram", formatRss(ws.memRssKb)));
  chips.appendChild(makeChip("procs", String(ws.processCount)));
  el.appendChild(chips);
  return el;
}

function makeChip(label: string, value: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "workspace-stat-chip";
  const l = document.createElement("span");
  l.className = "chip-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "chip-value tau-mono";
  v.textContent = value;
  chip.append(l, v);
  return chip;
}

function buildCwds(
  ws: WorkspaceInfo,
  onSelectCwd: (workspaceId: string, cwd: string) => void,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-cwds";
  if (ws.cwds.length === 0) return el;
  for (const cwd of ws.cwds) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "workspace-cwd-chip";
    chip.setAttribute("data-stop", "1");
    if (ws.selectedCwd === cwd) chip.classList.add("active");
    chip.title = cwd;
    chip.textContent = shortenCwd(cwd);
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelectCwd(ws.id, cwd);
    });
    el.appendChild(chip);
  }
  return el;
}

function buildPanes(ws: WorkspaceInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-section workspace-panes";
  const open = !!getWorkspaceUi(ws.id, "panesOpen");
  el.classList.toggle("open", open);

  const header = document.createElement("button");
  header.type = "button";
  header.className = "workspace-section-header";
  header.setAttribute("data-stop", "1");
  header.textContent = `Panes (${ws.surfaceTitles.length})`;
  header.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = !el.classList.contains("open");
    el.classList.toggle("open", next);
    setWorkspaceUi(ws.id, "panesOpen", next);
  });
  el.appendChild(header);

  const list = document.createElement("div");
  list.className = "workspace-panes-list";
  for (const title of ws.surfaceTitles) {
    const row = document.createElement("div");
    row.className = "workspace-pane-row";
    if (title === ws.focusedSurfaceTitle) row.classList.add("focused");
    const t = document.createElement("span");
    t.className = "workspace-pane-title";
    t.textContent = title;
    row.appendChild(t);
    list.appendChild(row);
  }
  el.appendChild(list);
  return el;
}

/** M14 — signature contribution from the per-card manifest expand/
 *  collapse state. Each manifest key gets `npm` or `cargo` plus the
 *  `<wsId>:<kind>` boolean from local-ui-state, so a click that
 *  flips one expansion bumps the signature and rebuilds only the
 *  right card. */
function manifestExpandedSignature(ws: WorkspaceInfo): string {
  const parts: string[] = [];
  if (ws.packageJson)
    parts.push(`npm:${getWorkspaceUi(ws.id, "manifestsOpen") ? 1 : 0}`);
  // Per-manifest open state lives under `manifestsExpanded` in
  // local-ui-state — keyed by the same `<wsId>:npm` / `<wsId>:cargo`
  // strings the `card-manifests` builder uses. We don't import the
  // getter here to avoid circular module loads; instead read the raw
  // localStorage entry the same way the builder does.
  parts.push(readManifestExpandedRaw(`${ws.id}:npm`));
  parts.push(readManifestExpandedRaw(`${ws.id}:cargo`));
  return parts.join(",");
}

function readManifestExpandedRaw(key: string): string {
  try {
    const raw = localStorage.getItem("tau-mux.sidebar.ui-state");
    if (!raw) return "0";
    const parsed = JSON.parse(raw) as {
      manifestsExpanded?: Record<string, boolean>;
    };
    return parsed.manifestsExpanded?.[key] ? "1" : "0";
  } catch {
    return "0";
  }
}

function makeStatusNode(
  pill: WorkspaceInfo["statusPills"][number],
): HTMLElement {
  const parsed = parseStatusKey(pill.key);
  const node = renderStatusEntry({
    parsed,
    value: pill.value,
    color: pill.color,
    icon: pill.icon,
    context: "card",
  });
  node.title = `ht ${pill.key}: ${pill.value}`;
  node.dataset["key"] = pill.key;
  node.dataset["layout"] = parsed.layout;
  node.dataset["sig"] = statusEntrySig(pill);
  return node;
}

function buildStatus(ws: WorkspaceInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-section workspace-status";
  if (ws.statusPills.length === 0) {
    el.classList.add("empty");
    return el;
  }
  for (const pill of ws.statusPills) el.appendChild(makeStatusNode(pill));
  return el;
}

/** In-place reconcile of a `.workspace-status` grid: reuse unchanged
 *  nodes (no chart teardown), re-render changed ones, add/drop, reorder.
 *  Mirrors the native sidebar's `reconcileStatusGrid`. */
function reconcileStatus(el: HTMLElement, ws: WorkspaceInfo): void {
  el.classList.toggle("empty", ws.statusPills.length === 0);
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(el.children)) {
    const k = (child as HTMLElement).dataset["key"];
    if (k) existing.set(k, child as HTMLElement);
  }
  const seen = new Set<string>();
  const ordered: HTMLElement[] = [];
  for (const pill of ws.statusPills) {
    seen.add(pill.key);
    const prev = existing.get(pill.key);
    const parsed = parseStatusKey(pill.key);
    ordered.push(
      prev &&
        prev.dataset["layout"] === parsed.layout &&
        prev.dataset["sig"] === statusEntrySig(pill)
        ? prev
        : makeStatusNode(pill),
    );
  }
  for (const [k, n] of existing) if (!seen.has(k)) n.remove();
  el.replaceChildren(...ordered);
}

function buildProgress(ws: WorkspaceInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-progress";
  if (!ws.progress) {
    el.classList.add("empty");
    return el;
  }
  const pct = Math.min(100, Math.max(0, ws.progress.value));
  el.innerHTML = `<div class="workspace-progress-track"><div class="workspace-progress-fill" style="width:${pct}%"></div></div>`;
  if (ws.progress.label) {
    const lbl = document.createElement("div");
    lbl.className = "workspace-progress-label";
    lbl.textContent = ws.progress.label;
    el.appendChild(lbl);
  }
  return el;
}
