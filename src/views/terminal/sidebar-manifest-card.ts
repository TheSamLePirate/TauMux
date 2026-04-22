// Shared renderer for the sidebar workspace "manifest" card. Used by
// both the package.json (npm) path and the Cargo.toml (rust) path —
// the sidebar builds a `ManifestCardProps` from whichever manifest
// family the workspace's selected cwd resolves to and calls
// `renderManifestCard(props)`. Keeps the 130-line card implementation
// in one place so every non-generic bit (icons, dot states, script
// running pill, run-button event wiring) lives here, not twice in
// sidebar.ts.

import { createIcon } from "./icons";

/** Visible state for a single action button (script / cargo subcommand). */
export type ManifestActionState = "idle" | "running" | "error";

export interface ManifestAction {
  /** Unique, stable key used by scriptErrors + running detection. */
  key: string;
  /** Short label displayed as the primary button text ("build", "run"). */
  label: string;
  /** Full shell command line typed into a fresh surface when clicked
   *  ("bun run build", "cargo run --bin server --release"). */
  command: string;
  state: ManifestActionState;
}

export interface ManifestCardProps {
  /** Identifies which manifest family drives this card. Used only for
   *  tooltip / aria text — dot colours and layout are identical. */
  kind: "npm" | "cargo";
  workspaceId: string;
  /** cwd fed back to `ht-run-script` so the spawned surface inherits
   *  the right working directory. */
  directory: string;
  name?: string;
  version?: string;
  /** Secondary chip displayed next to the version — "module"/"commonjs"
   *  for npm, "2021"/"2024" for cargo. Free-form string, rendered as-is. */
  subLabel?: string;
  description?: string;
  /** Optional chip row shown before the action list. npm's `bin` field
   *  and cargo's `[[bin]]` targets both feed this. */
  binaries?: string[];
  actions: ManifestAction[];
  expanded: boolean;
  onToggle: () => void;
}

export function renderManifestCard(props: ManifestCardProps): HTMLElement {
  const card = document.createElement("div");
  card.className = `workspace-package workspace-manifest-${props.kind}${props.expanded ? " expanded" : ""}`;

  card.appendChild(buildHeader(props));
  if (!props.expanded) return card;

  const body = document.createElement("div");
  body.className = "workspace-package-body";
  card.appendChild(body);

  if (props.description) {
    body.appendChild(buildDescription(props.description));
  }
  if (props.binaries && props.binaries.length > 0) {
    body.appendChild(buildBinChips(props.binaries, props.name));
  }
  if (props.actions.length > 0) {
    body.appendChild(buildActions(props));
  }

  return card;
}

function buildHeader(props: ManifestCardProps): HTMLElement {
  const header = document.createElement("button");
  header.type = "button";
  header.className = "workspace-package-header";
  header.setAttribute("aria-expanded", String(props.expanded));
  header.title = props.expanded
    ? `Collapse ${manifestFilename(props.kind)}`
    : `Expand ${manifestFilename(props.kind)}`;
  header.addEventListener("click", (e) => {
    e.stopPropagation();
    props.onToggle();
  });

  const icon = document.createElement("span");
  icon.className = "workspace-package-icon";
  // Distinct glyph per manifest family so the eye can tell the cargo
  // card from the npm card instantly. Colour is still driven by CSS
  // (`.workspace-manifest-cargo .workspace-package-icon`).
  icon.append(
    createIcon(props.kind === "cargo" ? "rocket" : "package", "", 11),
  );
  header.appendChild(icon);

  const nameEl = document.createElement("span");
  nameEl.className = "workspace-package-name";
  nameEl.textContent = props.name || manifestFilename(props.kind);
  header.appendChild(nameEl);

  if (props.version) {
    const versionEl = document.createElement("span");
    versionEl.className = "workspace-package-version";
    versionEl.textContent = "v" + props.version;
    header.appendChild(versionEl);
  }

  if (props.subLabel) {
    const subEl = document.createElement("span");
    subEl.className = "workspace-package-type";
    subEl.textContent = props.subLabel;
    header.appendChild(subEl);
  }

  const caret = document.createElement("span");
  caret.className = "workspace-package-caret";
  caret.append(
    createIcon(props.expanded ? "chevronDown" : "chevronRight", "", 10),
  );
  header.appendChild(caret);

  return header;
}

function buildDescription(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "workspace-package-desc";
  el.textContent = text;
  el.title = text;
  return el;
}

function buildBinChips(names: string[], fallback?: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "workspace-package-bin";
  const label = document.createElement("span");
  label.className = "workspace-package-bin-label";
  label.textContent = "bin";
  wrap.appendChild(label);
  const display = names.length > 0 ? names : fallback ? [fallback] : [];
  for (const name of display) {
    const chip = document.createElement("span");
    chip.className = "workspace-package-bin-chip";
    chip.textContent = name;
    wrap.appendChild(chip);
  }
  return wrap;
}

function buildActions(props: ManifestCardProps): HTMLElement {
  const list = document.createElement("div");
  list.className = "workspace-package-scripts";

  for (const action of props.actions) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "workspace-script-btn";
    row.title = action.command + "\n\nClick to run";
    row.dataset["state"] = action.state;

    const dot = document.createElement("span");
    dot.className = `workspace-script-dot ${action.state}`;
    row.appendChild(dot);

    const nameEl = document.createElement("span");
    nameEl.className = "workspace-script-name";
    nameEl.textContent = action.label;
    row.appendChild(nameEl);

    const cmdEl = document.createElement("span");
    cmdEl.className = "workspace-script-cmd";
    cmdEl.textContent = action.command;
    row.appendChild(cmdEl);

    const run = document.createElement("span");
    run.className = "workspace-script-run";
    if (action.state === "running") {
      run.textContent = "running";
    } else if (action.state === "error") {
      run.textContent = "retry";
    } else {
      run.textContent = "run";
      run.append(createIcon("chevronRight", "", 9));
    }
    row.appendChild(run);

    row.addEventListener("click", (e) => {
      e.stopPropagation();
      // The sidebar listens to `ht-run-script` (existing contract); the
      // host decides how to spawn. `scriptKey` is namespaced so npm
      // "build" and cargo "build" coexist in scriptErrors without
      // colliding.
      window.dispatchEvent(
        new CustomEvent("ht-run-script", {
          detail: {
            workspaceId: props.workspaceId,
            cwd: props.directory,
            scriptKey: action.key,
            command: action.command,
          },
        }),
      );
    });

    list.appendChild(row);
  }
  return list;
}

function manifestFilename(kind: ManifestCardProps["kind"]): string {
  return kind === "cargo" ? "Cargo.toml" : "package.json";
}
