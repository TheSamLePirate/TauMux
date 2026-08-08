/**
 * Settings → Layout, extracted from `settings-panel.ts`.
 *
 * Three blocks that all answer "what does the chrome show": the τ-mux §9
 * layout variant picker (with inline SVG miniatures), the bottom
 * status-bar key picker + reorder, and the sidebar workspace-card
 * density / section toggles. Plus the live "discovered ht keys" list,
 * which is the only part fed by runtime state rather than settings.
 *
 * It renders through a `SettingsSectionHost` rather than owning field
 * builders of its own, so a row here is byte-identical to a row in any
 * other section — same classes, same per-field reset affordance, same
 * clamp feedback. The host is the panel; this module is only the layout
 * section's content.
 */

import type { AppSettings } from "../../shared/settings";
import {
  STATUS_KEY_GROUPS,
  getStatusKeyMeta,
  type StatusKeyMeta,
} from "./status-keys";

/**
 * The subset of `SettingsPanel` a section renderer needs. Passing this
 * instead of the panel itself keeps the dependency one-way: sections
 * can draw, they cannot reach into panel internals (visibility, nav
 * state, the diagnostics cache).
 */
export interface SettingsSectionHost {
  sectionTitle(c: HTMLElement, text: string): void;
  sectionDesc(c: HTMLElement, text: string): void;
  infoNote(c: HTMLElement, text: string): void;
  toggleField(
    c: HTMLElement,
    label: string,
    value: boolean,
    key: keyof AppSettings,
    opts?: { note?: string },
  ): void;
  numberField(
    c: HTMLElement,
    label: string,
    value: number,
    key: keyof AppSettings,
    opts: { min: number; max: number; step: number; note?: string },
  ): void;
  segmentedField(
    c: HTMLElement,
    label: string,
    value: string,
    key: keyof AppSettings,
    options: { value: string; label: string }[],
    note?: string,
  ): void;
  /** Dispatch a settings change through the panel's normal pipeline. */
  emit(partial: Partial<AppSettings>): void;
  /** Re-run the active section's renderer (after a change that alters
   *  which controls exist, e.g. toggling a status key on). */
  rerender(): void;
  /** `ht set-status` keys seen since boot, pushed in by bun. */
  htKeysSeen(): readonly string[];
}

export function renderLayoutSection(
  c: HTMLElement,
  s: AppSettings,
  host: SettingsSectionHost,
): void {
  host.sectionTitle(c, "Layout");
  host.sectionDesc(
    c,
    "Pick a layout variant. The choice persists across sessions.",
  );

  const variants: {
    id: AppSettings["layoutVariant"];
    name: string;
    blurb: string;
    preview: () => SVGSVGElement;
  }[] = [
    {
      id: "bridge",
      name: "Bridge",
      blurb:
        "Refined default. 240 px sidebar, 3-pane split, Codex/Week/$ status meters.",
      preview: renderBridgeMiniature,
    },
    {
      id: "cockpit",
      name: "Cockpit",
      blurb:
        "Dense. 52 px icon rail, per-pane HUD (model · state · tok/s · $), up to 4 panes.",
      preview: renderCockpitMiniature,
    },
    {
      id: "atlas",
      name: "Atlas",
      blurb:
        "Radical. Workspace graph sidebar with per-node CPU, configurable status keys.",
      preview: renderAtlasMiniature,
    },
  ];

  const wrap = document.createElement("div");
  wrap.className = "layout-cards";
  for (const v of variants) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `layout-card${v.id === s.layoutVariant ? " active" : ""}`;
    const preview = document.createElement("div");
    preview.className = "layout-card-preview";
    preview.appendChild(v.preview());
    card.appendChild(preview);
    const label = document.createElement("div");
    label.className = "layout-card-label";
    label.textContent = v.name;
    card.appendChild(label);
    const blurb = document.createElement("div");
    blurb.className = "layout-card-blurb";
    blurb.textContent = v.blurb;
    card.appendChild(blurb);
    card.addEventListener("click", () => {
      host.emit({ layoutVariant: v.id });
      setTimeout(() => host.rerender(), 20);
    });
    wrap.appendChild(card);
  }
  c.appendChild(wrap);

  // ── Status bar keys picker ──
  // The bottom status bar is key-driven (src/views/terminal/status-keys.ts).
  // Users pick which keys show and in what order. Current order is
  // preserved when toggling; disabled keys are appended at the
  // bottom of the pool so enabling them re-adds them at the end.
  host.sectionTitle(c, "Status bar keys");
  host.sectionDesc(
    c,
    "Pick which status keys appear in the bottom bar. Reorder by toggling; active keys render left-to-right in the order below. Keys that have no data to show at the moment are silently skipped.",
  );

  const activeKeys = s.statusBarKeys ?? [];
  const allMeta = getStatusKeyMeta();
  const grouped: Record<string, StatusKeyMeta[]> = {};
  for (const g of STATUS_KEY_GROUPS) grouped[g] = [];
  for (const meta of allMeta) grouped[meta.group]!.push(meta);

  const grid = document.createElement("div");
  grid.className = "status-key-grid";
  for (const group of STATUS_KEY_GROUPS) {
    const header = document.createElement("div");
    header.className = "status-key-group";
    header.textContent = group;
    grid.appendChild(header);
    const groupWrap = document.createElement("div");
    groupWrap.className = "status-key-group-items";
    for (const meta of grouped[group]!) {
      const row = document.createElement("button");
      row.type = "button";
      const active = activeKeys.includes(meta.id);
      row.className = `status-key-row${active ? " active" : ""}`;
      row.title = meta.description;
      const check = document.createElement("span");
      check.className = "status-key-check";
      check.textContent = active ? "●" : "○";
      row.appendChild(check);
      const label = document.createElement("span");
      label.className = "status-key-label";
      label.textContent = meta.label;
      row.appendChild(label);
      const id = document.createElement("span");
      id.className = "status-key-id tau-mono";
      id.textContent = meta.id;
      row.appendChild(id);
      row.addEventListener("click", () => {
        const next = active
          ? activeKeys.filter((k) => k !== meta.id)
          : [...activeKeys, meta.id];
        host.emit({ statusBarKeys: next });
        setTimeout(() => host.rerender(), 20);
      });
      groupWrap.appendChild(row);
    }
    grid.appendChild(groupWrap);
  }
  c.appendChild(grid);

  // Reorder controls — per-key ↑/↓ shuffle the active list.
  if (activeKeys.length > 1) {
    host.sectionDesc(
      c,
      `Order (${activeKeys.length} active). The leftmost entry renders nearest the workspace-colour dot.`,
    );
    const orderList = document.createElement("div");
    orderList.className = "status-key-order";
    activeKeys.forEach((id, i) => {
      const meta = allMeta.find((m) => m.id === id);
      if (!meta) return;
      const row = document.createElement("div");
      row.className = "status-key-order-row";
      const label = document.createElement("span");
      label.className = "status-key-order-label";
      label.textContent = meta.label;
      const idSpan = document.createElement("span");
      idSpan.className = "status-key-id tau-mono";
      idSpan.textContent = meta.id;
      const up = document.createElement("button");
      up.type = "button";
      up.className = "status-key-order-btn";
      up.textContent = "↑";
      up.disabled = i === 0;
      up.addEventListener("click", () => {
        if (i === 0) return;
        const next = activeKeys.slice();
        [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
        host.emit({ statusBarKeys: next });
        setTimeout(() => host.rerender(), 20);
      });
      const down = document.createElement("button");
      down.type = "button";
      down.className = "status-key-order-btn";
      down.textContent = "↓";
      down.disabled = i === activeKeys.length - 1;
      down.addEventListener("click", () => {
        if (i === activeKeys.length - 1) return;
        const next = activeKeys.slice();
        [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
        host.emit({ statusBarKeys: next });
        setTimeout(() => host.rerender(), 20);
      });
      row.append(label, idSpan, up, down);
      orderList.appendChild(row);
    });
    c.appendChild(orderList);
  }

  // ── Discovered ht keys ──
  // Live list of every `ht set-status <key>` the running session has
  // seen. Lets users hide noisy keys or reorder them without
  // touching the registry. Empty until at least one script publishes
  // a key — render a hint in that case so the section isn't silently
  // missing.
  renderDiscoveredHtKeys(c, s, host);

  // Plan #06 — workspace-card density + per-section toggles.
  renderWorkspaceCardBlock(c, s, host);
}

function renderWorkspaceCardBlock(
  c: HTMLElement,
  s: AppSettings,
  host: SettingsSectionHost,
): void {
  host.sectionTitle(c, "Workspace card");
  host.sectionDesc(
    c,
    "Density + which sections render in each sidebar workspace card. The header (name + pin + close) is always visible.",
  );

  host.segmentedField(
    c,
    "Density",
    s.workspaceCardDensity,
    "workspaceCardDensity",
    [
      { value: "compact", label: "Compact" },
      { value: "comfortable", label: "Comfortable" },
      { value: "spacious", label: "Spacious" },
    ],
  );

  host.toggleField(
    c,
    "Show meta row",
    s.workspaceCardShowMeta,
    "workspaceCardShowMeta",
    { note: "Foreground command + listening port chips." },
  );
  host.toggleField(
    c,
    "Show stats row",
    s.workspaceCardShowStats,
    "workspaceCardShowStats",
    { note: "Aggregate CPU bar + memory chip across the workspace's panes." },
  );
  host.toggleField(
    c,
    "Show panes list",
    s.workspaceCardShowPanes,
    "workspaceCardShowPanes",
    { note: "Collapsible per-pane list (only when >1 panes)." },
  );
  host.toggleField(
    c,
    "Show manifests",
    s.workspaceCardShowManifests,
    "workspaceCardShowManifests",
    {
      note: "package.json + Cargo.toml cards with quick-launch script chips.",
    },
  );
  host.toggleField(
    c,
    "Show CWD file explorer",
    s.workspaceCardShowFileExplorer,
    "workspaceCardShowFileExplorer",
    {
      note: "Native sidebar-only collapsible explorer rooted at the selected CWD.",
    },
  );
  host.toggleField(
    c,
    "Explorer shows hidden files",
    s.workspaceFileExplorerShowHidden,
    "workspaceFileExplorerShowHidden",
    {
      note: "Dotfiles are hidden by default; heavy folders like .git and node_modules stay excluded.",
    },
  );
  host.numberField(
    c,
    "Explorer max entries",
    s.workspaceFileExplorerMaxEntries,
    "workspaceFileExplorerMaxEntries",
    {
      min: 20,
      max: 1000,
      step: 10,
      note: "Per-directory cap to keep huge folders responsive.",
    },
  );
  host.toggleField(
    c,
    "Show ht status pills",
    s.workspaceCardShowStatusPills,
    "workspaceCardShowStatusPills",
    { note: "`ht set-status` entries displayed in the workspace card." },
  );
  host.toggleField(
    c,
    "Show progress bar",
    s.workspaceCardShowProgress,
    "workspaceCardShowProgress",
    {
      note: "Workspace progress bar driven by `ht set-progress` and OSC 9;4.",
    },
  );
}

function renderDiscoveredHtKeys(
  c: HTMLElement,
  s: AppSettings,
  host: SettingsSectionHost,
): void {
  host.sectionTitle(c, "Discovered ht keys");
  host.sectionDesc(
    c,
    "Every `ht set-status` key seen since this session started. Toggle visibility, reorder. New keys default to visible at the end.",
  );

  const seen = host.htKeysSeen();
  if (seen.length === 0) {
    host.infoNote(
      c,
      "No keys yet. Run `ht set-status <key> <value>` from any pane and the key will appear here.",
    );
    return;
  }

  const hidden = new Set(s.htStatusKeyHidden ?? []);
  const orderRaw = (s.htStatusKeyOrder ?? []).slice();
  // Compose the rendered list: known order first, then any
  // newly-seen keys appended (matches the runtime resolver in
  // `applyHtStatusKeySettings`). Keys in `htStatusKeyOrder` that
  // aren't in `htKeysSeen` are listed last and dimmed so the user
  // sees their stale customisation.
  const seenSet = new Set(seen);
  const visited = new Set<string>();
  const composed: { key: string; stale: boolean }[] = [];
  for (const k of orderRaw) {
    if (visited.has(k)) continue;
    visited.add(k);
    composed.push({ key: k, stale: !seenSet.has(k) });
  }
  for (const k of seen) {
    if (visited.has(k)) continue;
    visited.add(k);
    composed.push({ key: k, stale: false });
  }

  const list = document.createElement("div");
  list.className = "status-key-order";
  composed.forEach(({ key, stale }, i) => {
    const row = document.createElement("div");
    row.className = `status-key-order-row ht-key${stale ? " stale" : ""}`;

    const check = document.createElement("button");
    check.type = "button";
    check.className = "status-key-order-btn";
    const isVisible = !hidden.has(key);
    check.textContent = isVisible ? "●" : "○";
    check.title = isVisible ? "Hide this key" : "Show this key";
    check.addEventListener("click", () => {
      const next = isVisible
        ? [...new Set([...(s.htStatusKeyHidden ?? []), key])]
        : (s.htStatusKeyHidden ?? []).filter((k) => k !== key);
      host.emit({ htStatusKeyHidden: next });
      setTimeout(() => host.rerender(), 20);
    });

    const label = document.createElement("span");
    label.className = "status-key-order-label";
    label.textContent = stale ? `${key} (not seen this session)` : key;

    const up = document.createElement("button");
    up.type = "button";
    up.className = "status-key-order-btn";
    up.textContent = "↑";
    up.disabled = i === 0;
    up.addEventListener("click", () => {
      if (i === 0) return;
      const ordered = composed.map((entry) => entry.key);
      [ordered[i - 1], ordered[i]] = [ordered[i]!, ordered[i - 1]!];
      host.emit({ htStatusKeyOrder: ordered });
      setTimeout(() => host.rerender(), 20);
    });

    const down = document.createElement("button");
    down.type = "button";
    down.className = "status-key-order-btn";
    down.textContent = "↓";
    down.disabled = i === composed.length - 1;
    down.addEventListener("click", () => {
      if (i === composed.length - 1) return;
      const ordered = composed.map((entry) => entry.key);
      [ordered[i], ordered[i + 1]] = [ordered[i + 1]!, ordered[i]!];
      host.emit({ htStatusKeyOrder: ordered });
      setTimeout(() => host.rerender(), 20);
    });

    row.append(check, label, up, down);
    list.appendChild(row);
  });
  c.appendChild(list);
}

// ─────────────────────────────────────────────────────────────
// τ-mux §9 layout miniatures — inline SVG thumbnails for the
// Settings > Layout picker. Keeps the bundle free of raster
// assets and lets the previews inherit the --tau-* tokens so
// they automatically match the active theme.
// ─────────────────────────────────────────────────────────────
const NS_SVG_LAYOUT = "http://www.w3.org/2000/svg";

function mkRect(
  svg: SVGSVGElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
): SVGRectElement {
  const r = document.createElementNS(NS_SVG_LAYOUT, "rect");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(y));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("fill", fill);
  if (stroke) {
    r.setAttribute("stroke", stroke);
    r.setAttribute("stroke-width", "0.5");
  }
  svg.appendChild(r);
  return r;
}

function baseSvg(): SVGSVGElement {
  const svg = document.createElementNS(NS_SVG_LAYOUT, "svg");
  svg.setAttribute("viewBox", "0 0 160 96");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "auto");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // Outer window (12 px radius mirrored at 160×96 scale).
  const outer = document.createElementNS(NS_SVG_LAYOUT, "rect");
  outer.setAttribute("x", "1");
  outer.setAttribute("y", "1");
  outer.setAttribute("width", "158");
  outer.setAttribute("height", "94");
  outer.setAttribute("rx", "4");
  outer.setAttribute("fill", "var(--tau-bg)");
  outer.setAttribute("stroke", "var(--tau-edge)");
  outer.setAttribute("stroke-width", "0.5");
  svg.appendChild(outer);
  // Titlebar strip.
  mkRect(svg, 1, 1, 158, 8, "var(--tau-panel)");
  const tau = document.createElementNS(NS_SVG_LAYOUT, "circle");
  tau.setAttribute("cx", "6");
  tau.setAttribute("cy", "5");
  tau.setAttribute("r", "1.2");
  tau.setAttribute("fill", "var(--tau-cyan)");
  svg.appendChild(tau);
  return svg;
}

function renderBridgeMiniature(): SVGSVGElement {
  const svg = baseSvg();
  // 240 px sidebar ≈ 28 px slot here.
  mkRect(svg, 1, 9, 28, 80, "var(--tau-panel)");
  // Three pane split: top-left utility, top-right terminal, wide bottom.
  mkRect(svg, 30, 11, 60, 40, "var(--tau-void)", "var(--tau-edge)");
  mkRect(svg, 92, 11, 66, 40, "var(--tau-void)", "var(--tau-cyan)");
  mkRect(svg, 30, 53, 128, 34, "var(--tau-void)", "var(--tau-edge)");
  // Status bar.
  mkRect(svg, 1, 90, 158, 5, "var(--tau-panel)");
  return svg;
}

function renderCockpitMiniature(): SVGSVGElement {
  const svg = baseSvg();
  // 52 px icon rail ≈ 10 px slot.
  mkRect(svg, 1, 9, 10, 80, "var(--tau-void)", "var(--tau-edge)");
  // 2x2 pane grid with HUD strip (2 px band inside each).
  const panes: [number, number][] = [
    [12, 11],
    [86, 11],
    [12, 50],
    [86, 50],
  ];
  for (const [px, py] of panes) {
    mkRect(svg, px, py, 72, 37, "var(--tau-void)", "var(--tau-edge)");
    // Header
    mkRect(svg, px, py, 72, 4, "var(--tau-panel)");
    // HUD (22 px / 96 ≈ 2 px here)
    mkRect(svg, px, py + 4, 72, 2, "var(--tau-panel-hi)");
  }
  // Status bar.
  mkRect(svg, 1, 90, 158, 5, "var(--tau-panel)");
  return svg;
}

function renderAtlasMiniature(): SVGSVGElement {
  const svg = baseSvg();
  // 220 px graph column ≈ 26 px slot + 4 px tab rail.
  mkRect(svg, 1, 9, 26, 74, "var(--tau-void)", "var(--tau-edge)");
  mkRect(svg, 27, 9, 5, 74, "var(--tau-void)", "var(--tau-edge)");
  // Graph nodes.
  const nodes: [number, number, string][] = [
    [10, 18, "var(--tau-cyan)"],
    [10, 34, "var(--tau-text)"],
    [10, 48, "var(--tau-agent)"],
    [10, 62, "var(--tau-text-dim)"],
  ];
  for (const [cx, cy, fill] of nodes) {
    const c = document.createElementNS(NS_SVG_LAYOUT, "circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", "1.5");
    c.setAttribute("fill", fill);
    svg.appendChild(c);
  }
  // Dashed active edge to the agent node.
  const edge = document.createElementNS(NS_SVG_LAYOUT, "path");
  edge.setAttribute("d", "M 10 18 L 10 48");
  edge.setAttribute("stroke", "var(--tau-cyan)");
  edge.setAttribute("stroke-width", "0.6");
  edge.setAttribute("stroke-dasharray", "1.5 1.5");
  edge.setAttribute("fill", "none");
  svg.appendChild(edge);
  // Pane area.
  mkRect(svg, 33, 11, 125, 72, "var(--tau-void)", "var(--tau-edge)");
  // Ticker strip (32 px instead of 26; ≈ 6 px here).
  mkRect(svg, 1, 89, 158, 6, "var(--tau-void)", "var(--tau-edge)");
  const brand = document.createElementNS(NS_SVG_LAYOUT, "circle");
  brand.setAttribute("cx", "6");
  brand.setAttribute("cy", "92");
  brand.setAttribute("r", "1.2");
  brand.setAttribute("fill", "var(--tau-cyan)");
  svg.appendChild(brand);
  return svg;
}
