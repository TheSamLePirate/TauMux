/**
 * Placeholder pane for native-only surface kinds (editor / agent /
 * extension / claude / browser).
 *
 * The mirror can't host these surfaces — they are native webview
 * features — but before this existed they rendered as an xterm bound
 * to no PTY: a silent hole in the mirrored layout. The placeholder
 * shows the pane kind and where the real thing lives.
 *
 * Extracted from main.ts (module-size ratchet).
 */

const KIND_LABELS: Record<string, string> = {
  editor: "File editor",
  extension: "Extension",
  agent: "Agent pane",
  claude: "Claude Code pane",
  browser: "Browser pane",
};

export interface PlaceholderPaneParts {
  el: HTMLElement;
  barTitle: HTMLElement;
  chipsEl: HTMLElement;
  /** Body element — registered as the ref's termEl for layout sizing. */
  body: HTMLElement;
}

export function buildPlaceholderPane(
  surfaceId: string,
  surfaceType: string,
  title: string,
): PlaceholderPaneParts {
  const kindLabel = KIND_LABELS[surfaceType] ?? `${surfaceType} pane`;

  const el = document.createElement("div");
  el.className = "pane pane-placeholder";
  el.setAttribute("data-surface", surfaceId);

  const bar = document.createElement("div");
  bar.className = "surface-bar";
  const barTitle = document.createElement("span");
  barTitle.className = "surface-bar-title";
  barTitle.textContent = title;
  bar.appendChild(barTitle);
  const chipsEl = document.createElement("div");
  chipsEl.className = "surface-bar-chips";
  bar.appendChild(chipsEl);
  el.appendChild(bar);

  const body = document.createElement("div");
  body.className = "pane-placeholder-body";
  const kindEl = document.createElement("span");
  kindEl.className = "pane-placeholder-kind";
  kindEl.textContent = kindLabel;
  const noteEl = document.createElement("span");
  noteEl.className = "pane-placeholder-note";
  noteEl.textContent = "Available in the desktop app";
  body.append(kindEl, noteEl);
  el.appendChild(body);

  return { el, barTitle, chipsEl, body };
}
