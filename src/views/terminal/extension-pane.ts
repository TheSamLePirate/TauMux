// Extension pane — hosts an extension app's Vite frontend in an <iframe> and
// bridges postMessage traffic between that iframe and the τ-mux host.
//
// This is the one explicit full-privilege trust boundary for extensions
// (CLAUDE.md): the iframe runs with `allow-scripts allow-same-origin` so the
// frontend SDK can talk to the host. Extensions are fully trusted (no sandbox)
// — the strict-CSP `sideband-sandbox.ts` path is for display-only content and
// would block the SDK's scripts. See doc/design_extension_platform.md §3.

import {
  EXT_BRIDGE_TAG,
  type ExtensionFrontendPayload,
  type ExtensionHostPayload,
  type ExtensionSurfaceHandle,
} from "../../shared/extension-types";
import { createIcon, type IconName } from "./icons";

export interface ExtensionPaneCallbacks {
  onFocus: (surfaceId: string) => void;
  onClose: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => void;
  /** A bridge payload the iframe's SDK posted to the host. */
  onFrontendMessage: (
    surfaceId: string,
    payload: ExtensionFrontendPayload,
  ) => void;
}

export interface ExtensionPaneViewRef {
  id: string;
  surfaceType: "extension";
  extensionId: string;
  container: HTMLDivElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
  iframe: HTMLIFrameElement;
  url: string;
  statusEl: HTMLSpanElement;
  callbacks: ExtensionPaneCallbacks;
  /** Forward a host→frontend payload into the iframe, peeking lifecycle to
   *  drive the status pill. Called by the SurfaceManager when an
   *  `extensionBackendMessage` arrives from bun. */
  handleHostPayload: (payload: ExtensionHostPayload) => void;
  _cleanup: (() => void)[];
}

function makeActionBtn(
  label: string,
  icon: IconName,
  action: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "surface-bar-action";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.append(createIcon(icon, "", 13));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    action();
  });
  return btn;
}

function setStatus(
  view: ExtensionPaneViewRef,
  state: "starting" | "ready" | "offline",
): void {
  view.statusEl.className = `surface-chip extension-status ${state}`;
  view.statusEl.textContent =
    state === "ready"
      ? "running"
      : state === "starting"
        ? "starting…"
        : "offline";
}

export function createExtensionPaneView(
  surfaceId: string,
  handle: ExtensionSurfaceHandle,
  callbacks: ExtensionPaneCallbacks,
): ExtensionPaneViewRef {
  const container = document.createElement("div");
  container.className = "surface-container surface-extension";
  container.dataset["surfaceId"] = surfaceId;
  container.dataset["surfaceType"] = "extension";
  container.style.display = "none";

  const bar = document.createElement("div");
  bar.className = "surface-bar";
  const titleWrap = document.createElement("div");
  titleWrap.className = "surface-bar-title-wrap";
  const iconEl = document.createElement("span");
  iconEl.className = "surface-bar-icon extension-icon";
  // The manifest icon is author-chosen runtime data (often an emoji glyph);
  // render it as text. When absent, fall back to the tokenised SVG icon set
  // (design guideline §0: no emoji literals in source).
  if (handle.icon) iconEl.textContent = handle.icon;
  else iconEl.appendChild(createIcon("package", "", 12));
  titleWrap.appendChild(iconEl);
  const titleEl = document.createElement("span");
  titleEl.className = "surface-bar-title";
  titleEl.textContent = handle.title;
  titleEl.title = handle.title;
  titleWrap.appendChild(titleEl);
  bar.appendChild(titleWrap);

  const chipsEl = document.createElement("div");
  chipsEl.className = "surface-bar-chips extension-chips";
  const statusEl = document.createElement("span");
  statusEl.className = "surface-chip extension-status starting";
  statusEl.textContent = "starting…";
  chipsEl.appendChild(statusEl);
  const modeChip = document.createElement("span");
  modeChip.className = "surface-chip extension-mode-chip";
  modeChip.textContent = handle.devUrl ? "dev · HMR" : "built";
  chipsEl.appendChild(modeChip);
  bar.appendChild(chipsEl);

  const actions = document.createElement("div");
  actions.className = "surface-bar-actions";
  const reloadBtn = makeActionBtn("Reload extension", "reload", () => {
    // Reassign src to force a fresh load (picks up a rebuilt bundle).
    view.iframe.src = view.url;
  });
  actions.append(
    reloadBtn,
    makeActionBtn("Split Right", "splitHorizontal", () =>
      callbacks.onSplit(surfaceId, "horizontal"),
    ),
    makeActionBtn("Split Down", "splitVertical", () =>
      callbacks.onSplit(surfaceId, "vertical"),
    ),
    makeActionBtn("Close", "close", () => callbacks.onClose(surfaceId)),
  );
  bar.appendChild(actions);
  container.appendChild(bar);

  const body = document.createElement("div");
  body.className = "extension-body";
  const iframe = document.createElement("iframe");
  iframe.className = "extension-iframe";
  // Trusted boundary — scripts + same-origin so the SDK bridge works.
  iframe.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-popups",
  );
  iframe.setAttribute("title", `${handle.title} extension`);
  const url = handle.devUrl ?? handle.bundleUrl ?? "about:blank";
  iframe.src = url;
  body.appendChild(iframe);
  container.appendChild(body);

  const view: ExtensionPaneViewRef = {
    id: surfaceId,
    surfaceType: "extension",
    extensionId: handle.extensionId,
    container,
    titleEl,
    chipsEl,
    title: handle.title,
    iframe,
    url,
    statusEl,
    callbacks,
    handleHostPayload: (payload) => {
      if (payload.kind === "lifecycle") {
        setStatus(
          view,
          payload.state === "exited"
            ? "offline"
            : payload.state === "ready"
              ? "ready"
              : "starting",
        );
      }
      postToFrontend(view, payload);
    },
    _cleanup: [],
  };

  // Focus routing — clicking anywhere in the pane focuses it.
  const onMouseDown = () => callbacks.onFocus(surfaceId);
  container.addEventListener("mousedown", onMouseDown);
  view._cleanup.push(() =>
    container.removeEventListener("mousedown", onMouseDown),
  );

  // Frontend → host: the SDK posts `{ source: EXT_BRIDGE_TAG, payload }` to
  // its parent. Filter to THIS iframe so panes don't cross-talk.
  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    const data = e.data as { source?: string; payload?: unknown } | null;
    if (!data || data.source !== EXT_BRIDGE_TAG) return;
    callbacks.onFrontendMessage(
      surfaceId,
      data.payload as ExtensionFrontendPayload,
    );
  };
  window.addEventListener("message", onMessage);
  view._cleanup.push(() => window.removeEventListener("message", onMessage));

  // Notify the frontend of size changes (cheap; it may relayout a canvas).
  let lastW = 0;
  let lastH = 0;
  const ro = new ResizeObserver((entries) => {
    const r = entries[0]?.contentRect;
    if (!r) return;
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    postToFrontend(view, { kind: "resize", width: w, height: h });
  });
  ro.observe(body);
  view._cleanup.push(() => ro.disconnect());

  return view;
}

function postToFrontend(
  view: ExtensionPaneViewRef,
  payload: ExtensionHostPayload,
): void {
  try {
    view.iframe.contentWindow?.postMessage(
      { source: EXT_BRIDGE_TAG, payload },
      "*",
    );
  } catch {
    /* iframe torn down */
  }
}

export function destroyExtensionPaneView(view: ExtensionPaneViewRef): void {
  for (const dispose of view._cleanup) dispose();
  try {
    view.iframe.src = "about:blank";
  } catch {
    /* ignore */
  }
}
