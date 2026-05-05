// Web-mirror manifest card builder.
//
// Converts a `WorkspaceInfo` slice into one or two
// `ManifestCardProps` (npm + cargo) and hands them to the shared
// `renderManifestCard` from `src/shared/sidebar-manifest-card.ts`.
// Mirrors the native `renderPackageManifestCard` /
// `renderCargoManifestCard` adapters that live alongside the native
// sidebar; the only diff is the icon shim — the web client doesn't
// ship the full native icon set, so we provide inline SVGs for the
// four glyphs the manifest card needs.
//
// `runScript` action is deferred for the web mirror v1: the shared
// card still dispatches the `ht-run-script` window CustomEvent on
// click; `src/web-client/main.ts` listens and fires a transient
// "skip in mirror" toast instead of spawning a surface.

import type { PackageInfo, CargoInfo } from "../../shared/types";
import {
  renderManifestCard,
  type ManifestAction,
  type ManifestActionState,
  type ManifestCardDeps,
  type ManifestIconName,
} from "../../shared/sidebar-manifest-card";
import type { WorkspaceInfo } from "../../shared/sidebar-state";
import {
  getWorkspaceManifestExpanded,
  setWorkspaceManifestExpanded,
} from "./local-ui-state";

/** Web-mirror icon shim for the manifest card. Native ships ~80
 *  glyphs; the manifest module asks for four. Each is inlined here
 *  so the web bundle doesn't drag in the full native icon set. */
const ICON_SVGS: Record<ManifestIconName, string> = {
  package:
    '<path d="M2 4l5-2 5 2v6l-5 2-5-2V4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 4l5 2 5-2M7 6v6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  rocket:
    '<path d="M9 2l2 1 1 2-2 6-2 1-2-1-2-6 1-2 2-1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 9l-2 2 1 1 2-2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="5" r="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  chevronDown:
    '<polyline points="3,5 7,9 11,5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronRight:
    '<polyline points="5,3 9,7 5,11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};

const ICON_DEPS: ManifestCardDeps = {
  createIcon(name, cls, size) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    if (cls) svg.setAttribute("class", cls);
    svg.innerHTML = ICON_SVGS[name];
    return svg;
  },
};

export interface ManifestSectionCallbacks {
  /** Re-render the sidebar after a header toggle so the open/closed
   *  state flips visually without waiting for the next store
   *  dispatch. */
  requestRerender(): void;
}

/** Build the manifest section element for a workspace card. Returns
 *  an empty div with `.empty` class when neither manifest is
 *  present so the workspace-card section signature still has a
 *  stable target to compare against. */
export function buildManifestsSection(
  ws: WorkspaceInfo,
  callbacks: ManifestSectionCallbacks,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-section workspace-manifests";
  if (!ws.packageJson && !ws.cargoToml) {
    el.classList.add("empty");
    return el;
  }
  if (ws.packageJson) {
    el.appendChild(buildNpmCard(ws, ws.packageJson, callbacks));
  }
  if (ws.cargoToml) {
    el.appendChild(buildCargoCard(ws, ws.cargoToml, callbacks));
  }
  return el;
}

function buildNpmCard(
  ws: WorkspaceInfo,
  pkg: PackageInfo,
  callbacks: ManifestSectionCallbacks,
): HTMLElement {
  const key = `${ws.id}:npm`;
  const expanded = getWorkspaceManifestExpanded(key);
  const scriptKeys = pkg.scripts ? Object.keys(pkg.scripts) : [];
  const actions: ManifestAction[] = scriptKeys.map((name) => ({
    key: `${ws.id}:${name}`,
    label: name,
    command: pkg.scripts![name] ?? name,
    state: actionState(name, ws.runningScripts, ws.erroredScripts),
  }));
  return renderManifestCard(
    {
      kind: "npm",
      workspaceId: ws.id,
      directory: pkg.directory,
      name: pkg.name,
      version: pkg.version,
      subLabel: pkg.type,
      description: pkg.description,
      binaries: pkgBinaryNames(pkg),
      actions,
      expanded,
      onToggle: () => {
        setWorkspaceManifestExpanded(key, !expanded);
        callbacks.requestRerender();
      },
    },
    ICON_DEPS,
  );
}

function buildCargoCard(
  ws: WorkspaceInfo,
  cargo: CargoInfo,
  callbacks: ManifestSectionCallbacks,
): HTMLElement {
  const key = `${ws.id}:cargo`;
  const expanded = getWorkspaceManifestExpanded(key);

  const defaults: Array<[string, string]> = cargo.isWorkspace
    ? [
        ["build", "cargo build --workspace"],
        ["test", "cargo test --workspace"],
        ["check", "cargo check --workspace"],
        ["clippy", "cargo clippy --workspace --all-targets"],
        ["fmt", "cargo fmt --all"],
      ]
    : [
        ["build", "cargo build"],
        ["run", "cargo run"],
        ["test", "cargo test"],
        ["check", "cargo check"],
        ["clippy", "cargo clippy --all-targets"],
        ["fmt", "cargo fmt"],
      ];

  const actions: ManifestAction[] = defaults.map(([sub, command]) => ({
    key: `${ws.id}:cargo:${sub}`,
    label: sub,
    command,
    state: actionState(sub, ws.runningCargoActions, ws.erroredCargoActions),
  }));

  if (!cargo.isWorkspace && cargo.binaries.length > 1) {
    for (const bin of cargo.binaries) {
      actions.push({
        key: `${ws.id}:cargo:run-bin-${bin}`,
        label: `run ${bin}`,
        command: `cargo run --bin ${bin}`,
        state: "idle",
      });
    }
  }

  return renderManifestCard(
    {
      kind: "cargo",
      workspaceId: ws.id,
      directory: cargo.directory,
      name: cargo.name,
      version: cargo.version,
      subLabel: cargo.edition ? `edition ${cargo.edition}` : undefined,
      description: cargo.description,
      binaries: cargo.binaries,
      actions,
      expanded,
      onToggle: () => {
        setWorkspaceManifestExpanded(key, !expanded);
        callbacks.requestRerender();
      },
    },
    ICON_DEPS,
  );
}

function actionState(
  name: string,
  running: readonly string[],
  errored: readonly string[],
): ManifestActionState {
  if (running.includes(name)) return "running";
  if (errored.includes(name)) return "error";
  return "idle";
}

function pkgBinaryNames(pkg: PackageInfo): string[] | undefined {
  if (!pkg.bin) return undefined;
  if (typeof pkg.bin === "string") return pkg.name ? [pkg.name] : ["(bin)"];
  const keys = Object.keys(pkg.bin);
  return keys.length > 0 ? keys : undefined;
}
