/**
 * Settings → Integrations.
 *
 * Everything `ht` could configure and the app could not. Three groups,
 * each mapping one-to-one onto a CLI verb the user previously had to
 * remember:
 *
 *   Claude Code bridge   ← `ht claude install|uninstall|doctor`
 *   Shell integration    ← `ht shell-integration install|uninstall|status`
 *   Extensions           ← `ht extension enable|disable|remove`
 *
 * Plus a mirror of the two `claude auto-approve` knobs, which do live in
 * `AppSettings` but belong next to the bridge that feeds them — an
 * approval hook that is not installed makes the auto-approve toggle a
 * no-op, and that relationship is invisible when the two sit in
 * different sections.
 *
 * The state is not `AppSettings`: it is read from disk by bun and pushed
 * on `integrationsStatus`. Until the first push lands, the section
 * renders a "reading…" placeholder rather than a wrong answer.
 */

import type { AppSettings } from "../../shared/settings";
import {
  CLAUDE_BRIDGE_FEATURES,
  type ClaudeBridgeFeature,
  type ClaudeBridgeFeatureStatus,
  type IntegrationsStatus,
} from "../../shared/integrations";
import type { SettingsSectionHost } from "./settings-layout-section";

/** One installed extension, as pushed by bun on `extensionList`. */
export interface IntegrationExtension {
  id: string;
  name: string;
  path: string;
  enabled?: boolean;
}

export interface IntegrationsActions {
  /** Refresh the status from disk (`ht claude doctor` equivalent). */
  refresh(): void;
  installClaude(features: ClaudeBridgeFeature[]): void;
  uninstallClaude(): void;
  setShellIntegration(install: boolean): void;
  setExtensionEnabled(id: string, enabled: boolean): void;
}

export interface IntegrationsView {
  status: IntegrationsStatus | null;
  extensions: readonly IntegrationExtension[];
  /** Features ticked in the UI but not yet submitted. Owned by the
   *  panel so a re-render (status push, settings echo) doesn't discard
   *  a selection the user is still assembling. */
  selectedFeatures: Set<ClaudeBridgeFeature>;
}

const FEATURE_COPY: Record<
  ClaudeBridgeFeature,
  { label: string; note: string }
> = {
  lifecycle: {
    label: "Lifecycle hooks",
    note: "Session start/end, prompt/stop, subagents, compaction, cwd changes, idle + permission notifications. This is what drives the status pills and the sidebar ticker.",
  },
  tasks: {
    label: "Task hooks",
    note: "TaskCreated / TaskCompleted — mirrors Claude Code's task list into the sidebar plan panel.",
  },
  approvals: {
    label: "Permission approvals",
    note: "Routes PermissionRequest to a τ-mux modal (and Telegram, if forwarding is on) instead of leaving the prompt in the pane. Opt-in.",
  },
  statusline: {
    label: "Status line",
    note: "Installs `ht claude statusline` so cost, context use, and rate-limit data reach the sidebar. A statusline you defined yourself is never overwritten.",
  },
};

export function renderIntegrationsSection(
  c: HTMLElement,
  s: AppSettings,
  view: IntegrationsView,
  actions: IntegrationsActions,
  host: SettingsSectionHost,
): void {
  host.sectionTitle(c, "Claude Code bridge");
  host.sectionDesc(
    c,
    "Hooks and status line in ~/.claude/settings.json. Same operation as `ht claude install` — additive, backed up before every write, and it never touches entries it did not create.",
  );

  const status = view.status;
  if (!status) {
    host.infoNote(c, "Reading ~/.claude/settings.json…");
  } else {
    renderClaudeBridge(c, status, view, actions);
  }

  // Auto-approve lives in AppSettings but reads as part of this story.
  host.sectionTitle(c, "Permission auto-approve");
  host.sectionDesc(
    c,
    "Answer the permission prompt Claude Code shows in a TERMINAL pane by pressing Enter for you. Never fires for the τ-mux approval modal or the native Claude pane, pauses itself on a burst, and writes every approval to that pane's log.",
  );
  host.toggleField(
    c,
    "Auto-approve terminal prompts",
    s.claudeAutoApprove,
    "claudeAutoApprove",
    {
      note: "Grants unattended consent for commands the agent asks to run. Equivalent to `ht claude auto-approve on`.",
    },
  );
  host.numberField(
    c,
    "Auto-approve delay (ms)",
    s.claudeAutoApproveDelayMs,
    "claudeAutoApproveDelayMs",
    {
      min: 0,
      max: 10000,
      step: 100,
      note: "Pause before the keystroke so the prompt finishes rendering and you can see what was approved. `ht claude auto-approve --delay`.",
    },
  );

  host.sectionTitle(c, "Shell integration");
  host.sectionDesc(
    c,
    "Optional OSC 133 marks in your shell rc so `ht blocks` knows where each command started, ended, and what it returned. No-op outside τ-mux — installing it cannot change how your shell behaves elsewhere.",
  );
  if (!status) {
    host.infoNote(c, "Reading shell rc…");
  } else {
    renderShellIntegration(c, status, actions);
  }

  host.sectionTitle(c, "Extensions");
  host.sectionDesc(
    c,
    "Installed extension apps. Disabling stops a running backend immediately, it doesn't just skip it next launch — same as `ht extension disable`.",
  );
  renderExtensions(c, view.extensions, actions, host);
}

function renderClaudeBridge(
  c: HTMLElement,
  status: IntegrationsStatus,
  view: IntegrationsView,
  actions: IntegrationsActions,
): void {
  const claude = status.claude;

  if (claude.settingsError) {
    renderBanner(
      c,
      "err",
      `${claude.settingsError} — τ-mux will not rewrite a file it cannot parse.`,
    );
  } else if (!claude.bridgePresent) {
    renderBanner(
      c,
      "warn",
      `Bridge not found at ${claude.bridgeDir}. Run claude-integration/install.sh from the τ-mux repo, then re-check.`,
    );
  }
  if (status.lastAction && status.lastAction.kind.startsWith("claude-")) {
    renderBanner(
      c,
      status.lastAction.ok ? "ok" : "err",
      status.lastAction.message,
    );
  }

  const byFeature = new Map<ClaudeBridgeFeature, ClaudeBridgeFeatureStatus>(
    claude.features.map((f) => [f.feature, f]),
  );

  for (const feature of CLAUDE_BRIDGE_FEATURES) {
    const st = byFeature.get(feature);
    const copy = FEATURE_COPY[feature];
    const row = fieldRow(c, copy.label, copy.note);

    const state = document.createElement("span");
    state.className = `integration-state integration-state-${st?.state ?? "missing"}`;
    state.textContent = describeFeature(st);
    row.appendChild(state);

    const toggle = document.createElement("label");
    toggle.className = "settings-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = view.selectedFeatures.has(feature);
    input.setAttribute("aria-label", `Install ${copy.label}`);
    input.addEventListener("change", () => {
      if (input.checked) view.selectedFeatures.add(feature);
      else view.selectedFeatures.delete(feature);
    });
    const slider = document.createElement("span");
    slider.className = "settings-toggle-slider";
    toggle.append(input, slider);
    row.appendChild(toggle);
  }

  const actionsRow = document.createElement("div");
  actionsRow.className = "settings-field settings-actions-row";

  const installBtn = document.createElement("button");
  installBtn.type = "button";
  installBtn.className = "settings-action-btn";
  installBtn.textContent = "Install selected";
  installBtn.disabled = !!claude.settingsError || !claude.bridgePresent;
  installBtn.title = installBtn.disabled
    ? "Fix the problem above first."
    : "Merge the ticked features into ~/.claude/settings.json.";
  installBtn.addEventListener("click", () => {
    actions.installClaude([...view.selectedFeatures]);
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "settings-action-btn";
  removeBtn.textContent = "Remove all";
  removeBtn.disabled = !!claude.settingsError;
  removeBtn.title = "Remove every τ-mux-managed hook + status line entry.";
  removeBtn.addEventListener("click", () => {
    actions.uninstallClaude();
  });

  const recheckBtn = document.createElement("button");
  recheckBtn.type = "button";
  recheckBtn.className = "settings-action-btn";
  recheckBtn.textContent = "Re-check";
  recheckBtn.title = "Re-read the files from disk (`ht claude doctor`).";
  recheckBtn.addEventListener("click", () => {
    actions.refresh();
  });

  actionsRow.append(installBtn, removeBtn, recheckBtn);
  c.appendChild(actionsRow);

  const paths = document.createElement("div");
  paths.className = "settings-field-note integration-paths";
  paths.textContent = `${claude.settingsPath} · bridge ${claude.bridgeDir}`;
  paths.title = `${claude.wiredEvents.length} of ${
    claude.wiredEvents.length + claude.missingEvents.length
  } hook events wired`;
  c.appendChild(paths);
}

function describeFeature(st: ClaudeBridgeFeatureStatus | undefined): string {
  if (!st) return "unknown";
  if (st.feature === "statusline") {
    return st.state === "installed" ? "installed" : "not installed";
  }
  if (st.state === "installed") return `installed (${st.total})`;
  if (st.state === "partial") return `partial (${st.wired}/${st.total})`;
  return "not installed";
}

function renderShellIntegration(
  c: HTMLElement,
  status: IntegrationsStatus,
  actions: IntegrationsActions,
): void {
  const shell = status.shell;
  if (status.lastAction && status.lastAction.kind.startsWith("shell-")) {
    renderBanner(
      c,
      status.lastAction.ok ? "ok" : "err",
      status.lastAction.message,
    );
  }

  const row = fieldRow(
    c,
    `${shell.shell} rc file`,
    "Shells that are already open keep their old behaviour until they re-read this file.",
  );
  const state = document.createElement("span");
  state.className = `integration-state integration-state-${shell.installed ? "installed" : "missing"}`;
  state.textContent = shell.installed ? "installed" : "not installed";
  row.appendChild(state);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "settings-action-btn";
  btn.textContent = shell.installed ? "Remove" : "Install";
  btn.addEventListener("click", () => {
    actions.setShellIntegration(!shell.installed);
  });
  row.appendChild(btn);

  const path = document.createElement("div");
  path.className = "settings-field-note integration-paths";
  path.textContent = shell.rcPath;
  c.appendChild(path);
}

function renderExtensions(
  c: HTMLElement,
  extensions: readonly IntegrationExtension[],
  actions: IntegrationsActions,
  host: SettingsSectionHost,
): void {
  if (extensions.length === 0) {
    host.infoNote(
      c,
      "No extensions installed. Scaffold one from the command palette (⌘⇧P → “New Extension…”) or install a folder with `ht extension install <path>`.",
    );
    return;
  }

  for (const ext of extensions) {
    const enabled = ext.enabled !== false;
    const row = fieldRow(c, ext.name, ext.id);

    const state = document.createElement("span");
    state.className = `integration-state integration-state-${enabled ? "installed" : "missing"}`;
    state.textContent = enabled ? "enabled" : "disabled";
    row.appendChild(state);

    const toggle = document.createElement("label");
    toggle.className = "settings-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = enabled;
    input.setAttribute("aria-label", `Enable extension ${ext.name}`);
    input.addEventListener("change", () => {
      actions.setExtensionEnabled(ext.id, input.checked);
    });
    const slider = document.createElement("span");
    slider.className = "settings-toggle-slider";
    toggle.append(input, slider);
    row.appendChild(toggle);
  }
}

/** Local field row. Deliberately NOT the panel's `fieldRow`: these rows
 *  carry no `AppSettings` key, so the per-field reset affordance that
 *  helper adds would be meaningless (there is no default to reset an
 *  external file to). Same classes, so the rows line up with the rest. */
function fieldRow(
  c: HTMLElement,
  label: string,
  note?: string,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "settings-field";

  const labelWrap = document.createElement("div");
  labelWrap.className = "settings-field-label-wrap";

  const labelEl = document.createElement("label");
  labelEl.className = "settings-field-label";
  labelEl.textContent = label;
  labelWrap.appendChild(labelEl);

  if (note) {
    const noteEl = document.createElement("span");
    noteEl.className = "settings-field-note";
    noteEl.textContent = note;
    labelWrap.appendChild(noteEl);
  }

  row.appendChild(labelWrap);
  c.appendChild(row);
  return row;
}

function renderBanner(
  c: HTMLElement,
  level: "ok" | "warn" | "err",
  message: string,
): void {
  const el = document.createElement("p");
  el.className = `settings-info-note integration-banner integration-banner-${level}`;
  el.setAttribute("role", level === "err" ? "alert" : "status");
  el.textContent = message;
  c.appendChild(el);
}
