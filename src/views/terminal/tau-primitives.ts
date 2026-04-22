/**
 * τ-mux shared primitives.
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §8.
 *
 * All primitives are pure DOM factories. No framework. Callers mount
 * the returned element and own event wiring + teardown. Identity
 * (human / agent / mixed) is passed in — primitives do NOT inspect
 * global state.
 *
 * These primitives are used by:
 *   • new Phase-6+ variant code (Bridge / Cockpit / Atlas)
 *   • retrofit helpers applied to existing surface-manager / sidebar DOM
 *
 * The class names defined here are the ONLY legal chrome styling vector.
 * Inline styles on chrome are forbidden by §11.
 */
import { tauIcon, type TauIconName } from "./tau-icons";
import type { TauIdentity } from "./tau-tokens";

const NS_SVG = "http://www.w3.org/2000/svg";

// ─────────────────────────────────────────────────────────────
// IdentityDot (§7, §8.1)
// 7 px circle. Cyan (human) / amber (agent) / text (mixed).
// Pulses when `running`. Glows only when its pane is focused —
// driven by the `.is-focused` class on the ancestor pane.
// ─────────────────────────────────────────────────────────────
export interface IdentityDotOptions {
  kind: TauIdentity;
  running?: boolean;
  className?: string;
}
export function IdentityDot(opts: IdentityDotOptions): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `tau-identity-dot tau-identity-${opts.kind}${opts.running ? " is-running" : ""}${opts.className ? " " + opts.className : ""}`;
  el.setAttribute("role", "img");
  el.setAttribute(
    "aria-label",
    opts.kind === "agent" ? "agent" : opts.kind === "human" ? "human" : "mixed",
  );
  return el;
}

// ─────────────────────────────────────────────────────────────
// TabBadge (§8.1) — 9.5 px Mono, 0.5 px border, 3 px radius.
// Kind determines the border colour; `status` uses the pane's
// identity colour (applied via inherited class).
// ─────────────────────────────────────────────────────────────
export type TabBadgeKind = "branch" | "model" | "status";
export interface TabBadgeOptions {
  kind: TabBadgeKind;
  text: string;
  title?: string;
}
export function TabBadge(opts: TabBadgeOptions): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `tau-badge tau-badge-${opts.kind}`;
  el.textContent = opts.text;
  if (opts.title) el.title = opts.title;
  return el;
}

// ─────────────────────────────────────────────────────────────
// BranchChip (§8.5) — specialisation of TabBadge. Mono 600 / 9.5
// with the cyan-dim fill + border. Used on sidebar workspace rows
// and in tab badges.
// ─────────────────────────────────────────────────────────────
export function BranchChip(name: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "tau-branch-chip tau-mono";
  el.textContent = name;
  el.title = name;
  return el;
}

// ─────────────────────────────────────────────────────────────
// Tab (§8.1)
// Active: panelHi bg + 600 weight.
// ─────────────────────────────────────────────────────────────
export interface TabOptions {
  label: string;
  active?: boolean;
  badge?: TabBadgeOptions | null;
  onClick?: (e: MouseEvent) => void;
}
export function Tab(opts: TabOptions): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `tau-tab${opts.active ? " is-active" : ""}`;
  const labelEl = document.createElement("span");
  labelEl.className = "tau-tab-label";
  labelEl.textContent = opts.label;
  el.appendChild(labelEl);
  if (opts.badge) el.appendChild(TabBadge(opts.badge));
  if (opts.onClick) el.addEventListener("click", opts.onClick);
  return el;
}

// ─────────────────────────────────────────────────────────────
// Meter (§8.4) — 4 px tall, 50 px wide default.
// Fill colour semantic: ok / warn / err. Label-paired (never solo).
// ─────────────────────────────────────────────────────────────
export type MeterSemantic = "ok" | "warn" | "err";
export interface MeterOptions {
  value: number;
  max: number;
  semantic?: MeterSemantic;
  width?: number;
  label?: string;
  valueText?: string;
}
export function Meter(opts: MeterOptions): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "tau-meter-wrap";
  if (opts.label) {
    const l = document.createElement("span");
    l.className = "tau-meter-label tau-mono";
    l.textContent = opts.label;
    wrap.appendChild(l);
  }
  const bar = document.createElement("div");
  bar.className = `tau-meter tau-meter-${opts.semantic ?? "ok"}`;
  bar.style.width = `${opts.width ?? 50}px`;
  const fill = document.createElement("div");
  fill.className = "tau-meter-fill";
  const pct = Math.max(
    0,
    Math.min(1, opts.max > 0 ? opts.value / opts.max : 0),
  );
  fill.style.width = `${(pct * 100).toFixed(1)}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);
  if (opts.valueText !== undefined) {
    const v = document.createElement("span");
    v.className = "tau-meter-value tau-mono";
    v.textContent = opts.valueText;
    wrap.appendChild(v);
  }
  return wrap;
}

// ─────────────────────────────────────────────────────────────
// CommandBar (§8.2)
// 26 px tall, max 520 px wide, centred or left-aligned per variant.
// Single `<input>` surrounded by kbd hint (left) + τ glyph (right).
// ─────────────────────────────────────────────────────────────
export interface CommandBarOptions {
  placeholder?: string;
  onInvoke?: (value: string) => void;
  onOpen?: () => void;
}
export function CommandBar(opts: CommandBarOptions = {}): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "tau-command-bar";
  const kbd = document.createElement("span");
  kbd.className = "tau-command-bar-kbd tau-mono";
  kbd.textContent = "⌘K";
  el.appendChild(kbd);
  const input = document.createElement("input");
  input.className = "tau-command-bar-input";
  input.placeholder =
    opts.placeholder ?? "Run command, switch pane, attach agent…";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && opts.onInvoke) opts.onInvoke(input.value);
  });
  if (opts.onOpen) input.addEventListener("focus", opts.onOpen);
  el.appendChild(input);
  const brand = document.createElement("span");
  brand.className = "tau-command-bar-brand";
  brand.appendChild(tauIcon("tau", { size: 10 }));
  el.appendChild(brand);
  return el;
}

// ─────────────────────────────────────────────────────────────
// StatusBar (§8.3)
// 26 px tall. Zones: identity · usage meters · (flex) · cost / model.
// Returns an API that lets callers mutate each zone without rebuilding.
// ─────────────────────────────────────────────────────────────
export interface StatusBarHandle {
  readonly root: HTMLDivElement;
  setIdentity(nodes: Node[]): void;
  setMeters(nodes: Node[]): void;
  setCost(nodes: Node[]): void;
}
export function StatusBar(mount: HTMLDivElement): StatusBarHandle {
  mount.classList.add("tau-status-bar", "tau-mono");
  mount.replaceChildren();
  const identity = document.createElement("div");
  identity.className = "tau-status-zone";
  identity.dataset["zone"] = "identity";
  const meters = document.createElement("div");
  meters.className = "tau-status-zone";
  meters.dataset["zone"] = "meters";
  const spacer = document.createElement("div");
  spacer.className = "tau-status-spacer";
  const cost = document.createElement("div");
  cost.className = "tau-status-zone";
  cost.dataset["zone"] = "cost";
  mount.append(identity, meters, spacer, cost);
  const setChildren = (target: HTMLElement, nodes: Node[]) => {
    target.replaceChildren(...nodes);
  };
  return {
    root: mount,
    setIdentity: (n) => setChildren(identity, n),
    setMeters: (n) => setChildren(meters, n),
    setCost: (n) => setChildren(cost, n),
  };
}

// ─────────────────────────────────────────────────────────────
// Pane (§8.1) — 28 px header, 10 px h-padding, 8 px gap, 7 px dot.
// The `body` slot is any element (typically the xterm viewport) —
// primitives do NOT redraw terminal content (§0).
// ─────────────────────────────────────────────────────────────
export interface PaneOptions {
  identity: TauIdentity;
  focused?: boolean;
  title: string;
  tabs?: TabOptions[];
  badges?: TabBadgeOptions[];
  actions?: { icon: TauIconName; title?: string; onClick: () => void }[];
  body: HTMLElement;
  running?: boolean;
}
export interface PaneHandle {
  readonly root: HTMLDivElement;
  readonly header: HTMLDivElement;
  readonly body: HTMLElement;
  setFocused(v: boolean): void;
  setRunning(v: boolean): void;
  setIdentity(k: TauIdentity): void;
}
export function Pane(opts: PaneOptions): PaneHandle {
  const root = document.createElement("div");
  root.className = `tau-pane tau-pane-${opts.identity}${opts.focused ? " is-focused" : ""}`;
  const header = document.createElement("div");
  header.className = "tau-pane-header";
  const dot = IdentityDot({ kind: opts.identity, running: opts.running });
  header.appendChild(dot);
  const title = document.createElement("span");
  title.className = "tau-pane-title";
  title.textContent = opts.title;
  header.appendChild(title);
  if (opts.tabs) for (const t of opts.tabs) header.appendChild(Tab(t));
  if (opts.badges) for (const b of opts.badges) header.appendChild(TabBadge(b));
  if (opts.actions) {
    const actions = document.createElement("div");
    actions.className = "tau-pane-actions";
    for (const a of opts.actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tau-pane-action";
      btn.title = a.title ?? a.icon;
      btn.setAttribute("aria-label", a.title ?? a.icon);
      btn.appendChild(tauIcon(a.icon, { size: 11 }));
      btn.addEventListener("click", a.onClick);
      actions.appendChild(btn);
    }
    header.appendChild(actions);
  }
  root.appendChild(header);
  opts.body.classList.add("tau-pane-body");
  root.appendChild(opts.body);
  return {
    root,
    header,
    body: opts.body,
    setFocused(v) {
      root.classList.toggle("is-focused", v);
    },
    setRunning(v) {
      dot.classList.toggle("is-running", v);
    },
    setIdentity(k) {
      root.classList.remove(
        "tau-pane-human",
        "tau-pane-agent",
        "tau-pane-mixed",
      );
      root.classList.add(`tau-pane-${k}`);
      dot.className = `tau-identity-dot tau-identity-${k}${dot.classList.contains("is-running") ? " is-running" : ""}`;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// WorkspaceCard (§8.6)
// Sidebar row with box-drawing tree glyphs. 8–10 px padding, 8 px
// radius, `panelHi` bg when active. Permits tree glyphs per §11 "Do".
// ─────────────────────────────────────────────────────────────
export interface WorkspaceCardSession {
  name: string;
  identity?: TauIdentity;
  running?: boolean;
  isLast?: boolean;
}
export interface WorkspaceCardOptions {
  name: string;
  identity?: TauIdentity;
  module?: string;
  version?: string;
  active?: boolean;
  sessions?: WorkspaceCardSession[];
  onClick?: () => void;
}
export function WorkspaceCard(opts: WorkspaceCardOptions): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `tau-workspace-card${opts.active ? " is-active" : ""}`;
  if (opts.onClick) {
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.addEventListener("click", opts.onClick);
    el.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && opts.onClick) {
        e.preventDefault();
        opts.onClick();
      }
    });
  }
  // Header row: identity dot + workspace name (Mono 12.5 / 600) +
  // optional module label pushed right.
  const headerRow = document.createElement("div");
  headerRow.className = "tau-workspace-header";
  headerRow.appendChild(IdentityDot({ kind: opts.identity ?? "mixed" }));
  const nameEl = document.createElement("span");
  nameEl.className = "tau-workspace-name tau-mono";
  nameEl.textContent = opts.name;
  headerRow.appendChild(nameEl);
  if (opts.module) {
    const mod = document.createElement("span");
    mod.className = "tau-workspace-module tau-mono";
    mod.textContent = `[${opts.module}]`;
    headerRow.appendChild(mod);
  }
  el.appendChild(headerRow);

  // Session list using box-drawing characters per §8.6.
  if (opts.sessions && opts.sessions.length > 0) {
    const list = document.createElement("div");
    list.className = "tau-workspace-sessions";
    const last = opts.sessions.length - 1;
    opts.sessions.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "tau-workspace-session";
      const tree = document.createElement("span");
      tree.className = "tau-workspace-tree tau-mono";
      tree.textContent = i === last ? "└" : "├";
      row.appendChild(tree);
      row.appendChild(
        IdentityDot({ kind: s.identity ?? "human", running: s.running }),
      );
      const label = document.createElement("span");
      label.className = "tau-workspace-session-name tau-mono";
      label.textContent = s.name;
      row.appendChild(label);
      list.appendChild(row);
    });
    el.appendChild(list);
  }

  if (opts.module || opts.version) {
    const foot = document.createElement("div");
    foot.className = "tau-workspace-foot tau-mono";
    foot.textContent = [opts.module, opts.version].filter(Boolean).join(" ");
    el.appendChild(foot);
  }

  return el;
}

// ─────────────────────────────────────────────────────────────
// Helpers for retrofit code: apply primitive classes to existing DOM
// without owning the element's lifecycle. Used by surface-manager +
// sidebar until they're fully migrated (see revamp plan Phase 10).
// ─────────────────────────────────────────────────────────────

/** Apply the τ-mux pane classes to an existing container DOM node. */
export function applyTauPaneClasses(
  container: HTMLElement,
  kind: TauIdentity,
  focused: boolean,
): void {
  container.classList.add("tau-pane", `tau-pane-${kind}`);
  container.classList.remove(
    ...Array.from(container.classList).filter(
      (c) =>
        c.startsWith("tau-pane-") &&
        c !== `tau-pane-${kind}` &&
        c !== "tau-pane-body",
    ),
  );
  container.classList.toggle("is-focused", focused);
}

export function isHtmlSvgElement(el: unknown): el is SVGSVGElement {
  return (
    typeof el === "object" &&
    el !== null &&
    (el as Element).namespaceURI === NS_SVG
  );
}
