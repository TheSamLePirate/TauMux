// Native-only status-key renderers.
//
// These keys query DOM nodes the Electrobun webview owns
// (`.surface-container[data-surface-id=…]`, `.tau-pane-agent`, etc.)
// which the web mirror's pane chrome doesn't expose. Keeping them in
// a separate module lets the shared registry stay pure-data and
// safe to bundle into the browser. Importing this file as a
// side-effect at the top of `./status-keys.ts` ensures every native
// consumer of `STATUS_KEY_META` / `renderStatusKey` sees these
// registered before they read the registry.

import {
  registerStatusKey,
  type StatusKeyRenderer,
} from "../../shared/status-keys";

function kv(label: string, value: string, title?: string): HTMLSpanElement {
  // Same shape as the helper in status-keys.ts; copied here so the
  // private `kv` of that module doesn't need to be exported just for
  // these two consumers.
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv";
  wrap.dataset["key"] = label;
  wrap.dataset["value"] = value;
  if (title) wrap.title = title;
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(document.createTextNode(" "));
  const v = document.createElement("span");
  v.className = "tau-status-value";
  v.textContent = value;
  wrap.appendChild(v);
  return wrap;
}

const modelKey: StatusKeyRenderer = {
  id: "model",
  label: "Agent model",
  description: "Model name reported by the focused agent pane.",
  group: "focus",
  render: ({ focusedSurface }) => {
    if (!focusedSurface) return null;
    const el = document.querySelector<HTMLElement>(
      `.surface-container[data-surface-id="${focusedSurface.id}"]`,
    );
    if (!el?.classList.contains("tau-pane-agent")) return null;
    const modelText =
      el.querySelector<HTMLElement>(".agent-tb-model")?.textContent?.trim() ??
      "";
    return kv("model", modelText || "—");
  },
};

const surfaceKindKey: StatusKeyRenderer = {
  id: "kind",
  label: "Pane kind",
  description: "HUMAN or AGENT identity of the focused pane.",
  group: "focus",
  render: ({ focusedSurface }) => {
    if (!focusedSurface) return null;
    const el = document.querySelector<HTMLElement>(
      `.surface-container[data-surface-id="${focusedSurface.id}"]`,
    );
    const isAgent = !!el?.classList.contains("tau-pane-agent");
    const wrap = kv("kind", isAgent ? "AGENT" : "HUMAN");
    const v = wrap.querySelector<HTMLElement>(".tau-status-value");
    if (v) {
      v.style.color = isAgent ? "var(--tau-agent)" : "var(--tau-cyan)";
      v.style.fontWeight = "700";
      v.style.letterSpacing = "0.08em";
    }
    return wrap;
  },
};

registerStatusKey(modelKey);
registerStatusKey(surfaceKindKey);
