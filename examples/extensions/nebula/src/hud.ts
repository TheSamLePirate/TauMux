// ============================================================================
// hud.ts — the glassmorphism HUD overlaid on the 3D scene.
//
// A Postman-style HTTP client in plain DOM (no framework):
//   • top command bar  — method select + URL input + glowing Send button
//   • left rail         — Servers / History / Saved tabs (collapsible)
//   • request editor    — headers (Key: Value lines) + body textarea
//   • response panel    — status pill, timing/size, headers, pretty body viewer
//   • toast area        — auto-dismissing accent-colored toasts
//
// The HUD is dumb about transport: it takes callbacks (onSend, onDiscover, …)
// and exposes setters (setEndpoints, setHistory, setCollection, showResponse,
// setLoading, toast). main.ts wires it to the SDK + scene.
// ============================================================================

import type {
  Endpoint,
  HistoryEntry,
  HttpResult,
  ReqSpec,
  SavedRequest,
} from "./protocol";

const METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
type Method = (typeof METHODS)[number];

// Method → accent color (matches the CSS palette).
const METHOD_COLOR: Record<string, string> = {
  GET: "#5fe9ff",
  POST: "#4fe39b",
  PUT: "#ffc24b",
  PATCH: "#b06bff",
  DELETE: "#ff5b6e",
  HEAD: "#9aa6cf",
  OPTIONS: "#ff6bd6",
};

export interface HudCallbacks {
  onSend: (req: ReqSpec) => void;
  onDiscover: () => void;
  onOpenBrowser: (url: string) => void;
  onCurl: (req: ReqSpec) => void;
  onSave: (req: SavedRequest) => void;
  onDelete: (id: string) => void;
  onSelectEndpoint: (ep: Endpoint) => void;
}

export interface Hud {
  setEndpoints(items: Endpoint[]): void;
  setHistory(items: HistoryEntry[]): void;
  setCollection(items: SavedRequest[]): void;
  showResponse(res: HttpResult): void;
  setLoading(loading: boolean): void;
  /** Reflect the URL bar (e.g. from a 3D node click). */
  setUrl(url: string): void;
  toast(level: "info" | "success" | "error", message: string): void;
  el: HTMLElement;
}

// -- tiny DOM helper ---------------------------------------------------------
type Attrs = Record<string, string | number | boolean | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function createHud(container: HTMLElement, cb: HudCallbacks): Hud {
  // --- state -------------------------------------------------------------
  let endpoints: Endpoint[] = [];
  let history: HistoryEntry[] = [];
  let collection: SavedRequest[] = [];
  // The request spec that produced the currently-shown response, so the
  // response panel's "Open in browser" / "curl" / "Save" act on the right URL.
  let lastReqForResponse: ReqSpec | null = null;

  // =====================================================================
  // TOP COMMAND BAR
  // =====================================================================
  const methodSelect = h("select", {
    class: "method-select",
    "aria-label": "HTTP method",
  }) as HTMLSelectElement;
  for (const m of METHODS) {
    methodSelect.appendChild(h("option", { value: m, text: m }));
  }
  const paintMethod = () => {
    const c = METHOD_COLOR[methodSelect.value] ?? "#5fe9ff";
    methodSelect.style.color = c;
    methodWrap.style.color = c;
    syncBodyVisibility();
  };
  methodSelect.addEventListener("change", paintMethod);
  const methodWrap = h("div", { class: "method-wrap" }, [methodSelect]);

  const urlInput = h("input", {
    class: "url-input",
    type: "text",
    spellcheck: "false",
    autocomplete: "off",
    autocapitalize: "off",
    placeholder: "https://httpbin.org/get",
    "aria-label": "Request URL",
  }) as HTMLInputElement;
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fire();
    }
  });

  const sendLabel = h("span", { class: "label", text: "Send" });
  const sendBtn = h("button", { class: "send-btn", type: "button" }, [
    sendLabel,
  ]) as HTMLButtonElement;
  sendBtn.addEventListener("click", () => fire());

  const brand = h("div", { class: "brand" }, [
    h("div", { class: "glyph" }),
    h("div", {}, [
      h("div", { class: "name", text: "NEBULA" }),
      h("div", { class: "sub", text: "API Explorer" }),
    ]),
  ]);

  const topbar = h("div", { class: "topbar glass" }, [
    brand,
    methodWrap,
    urlInput,
    sendBtn,
  ]);

  // =====================================================================
  // LEFT RAIL
  // =====================================================================
  let activeRailTab: "servers" | "history" | "saved" = "servers";

  const railTitle = h("div", { class: "rail-title", text: "Mission Control" });
  const collapseBtn = h("button", {
    class: "rail-collapse",
    type: "button",
    title: "Collapse panel",
    text: "⟨",
  });
  const railHead = h("div", { class: "rail-head" }, [collapseBtn, railTitle]);

  const tabServersCount = h("span", { class: "count", text: "0" });
  const tabHistoryCount = h("span", { class: "count", text: "0" });
  const tabSavedCount = h("span", { class: "count", text: "0" });

  const mkTab = (
    id: "servers" | "history" | "saved",
    label: string,
    countEl: HTMLElement,
  ) => {
    const tab = h(
      "button",
      { class: "rail-tab", type: "button", "data-tab": id },
      [document.createTextNode(label), countEl],
    );
    tab.addEventListener("click", () => selectRailTab(id));
    return tab;
  };
  const tabServers = mkTab("servers", "Servers", tabServersCount);
  const tabHistory = mkTab("history", "History", tabHistoryCount);
  const tabSaved = mkTab("saved", "Saved", tabSavedCount);
  const railTabs = h("div", { class: "rail-tabs" }, [
    tabServers,
    tabHistory,
    tabSaved,
  ]);

  const paneServers = h("div", { class: "rail-pane", "data-pane": "servers" });
  const paneHistory = h("div", { class: "rail-pane", "data-pane": "history" });
  const paneSaved = h("div", { class: "rail-pane", "data-pane": "saved" });
  const railBody = h("div", { class: "rail-body" }, [
    paneServers,
    paneHistory,
    paneSaved,
  ]);

  const rail = h("div", { class: "rail glass" }, [
    railHead,
    railTabs,
    railBody,
  ]);

  collapseBtn.addEventListener("click", () => {
    const collapsed = rail.classList.toggle("collapsed");
    collapseBtn.textContent = collapsed ? "⟩" : "⟨";
    collapseBtn.title = collapsed ? "Expand panel" : "Collapse panel";
  });

  function selectRailTab(id: "servers" | "history" | "saved") {
    activeRailTab = id;
    for (const [tab, pane, key] of [
      [tabServers, paneServers, "servers"],
      [tabHistory, paneHistory, "history"],
      [tabSaved, paneSaved, "saved"],
    ] as const) {
      const on = key === id;
      tab.classList.toggle("active", on);
      pane.classList.toggle("active", on);
    }
  }
  selectRailTab("servers");

  // =====================================================================
  // REQUEST EDITOR PANEL
  // =====================================================================
  let activeEditorTab: "headers" | "body" = "headers";

  const headersArea = h("textarea", {
    class: "editor",
    spellcheck: "false",
    placeholder: "Content-Type: application/json\nAuthorization: Bearer …",
  }) as HTMLTextAreaElement;
  const headersBadge = h("span", { class: "badge", text: "0" });
  const headersSection = h("div", { class: "editor-section active" }, [
    h("div", { class: "field-label", text: "One Key: Value per line" }),
    headersArea,
  ]);
  headersArea.addEventListener("input", updateBadges);

  const bodyArea = h("textarea", {
    class: "editor",
    spellcheck: "false",
    placeholder: '{\n  "hello": "world"\n}',
  }) as HTMLTextAreaElement;
  const bodyBadge = h("span", { class: "badge", text: "—" });
  const bodyHint = h("div", {
    class: "editor-hint",
    text: "Sent for non-GET/HEAD requests",
  });
  const bodySection = h("div", { class: "editor-section" }, [
    h("div", { class: "field-label", text: "Request body" }),
    bodyArea,
    bodyHint,
  ]);
  bodyArea.addEventListener("input", updateBadges);

  const mkSubtab = (
    id: "headers" | "body",
    label: string,
    badge: HTMLElement,
  ) => {
    const t = h("button", { class: "subtab", type: "button" }, [
      document.createTextNode(label),
      badge,
    ]);
    t.addEventListener("click", () => selectEditorTab(id));
    return t;
  };
  const subHeaders = mkSubtab("headers", "Headers", headersBadge);
  const subBody = mkSubtab("body", "Body", bodyBadge);
  const subtabs = h("div", { class: "subtabs" }, [subHeaders, subBody]);

  function selectEditorTab(id: "headers" | "body") {
    activeEditorTab = id;
    subHeaders.classList.toggle("active", id === "headers");
    subBody.classList.toggle("active", id === "body");
    headersSection.classList.toggle("active", id === "headers");
    bodySection.classList.toggle("active", id === "body");
  }
  selectEditorTab("headers");

  const saveReqBtn = h(
    "button",
    { class: "ghost-btn violet", type: "button" },
    [document.createTextNode("✦ Save")],
  );
  saveReqBtn.addEventListener("click", saveCurrent);
  const curlReqBtn = h(
    "button",
    { class: "ghost-btn accent", type: "button" },
    [document.createTextNode("Send as curl →")],
  );
  curlReqBtn.addEventListener("click", () => cb.onCurl(buildReqSpec()));
  const reqActions = h("div", { class: "btn-row" }, [saveReqBtn, curlReqBtn]);

  const reqPanelBody = h("div", { class: "panel-body" }, [
    headersSection,
    bodySection,
    reqActions,
  ]);
  const reqPanel = h("div", { class: "panel glass" }, [
    h("div", { class: "panel-head" }, [
      h("span", { class: "title", text: "Request" }),
      h("span", { class: "spacer" }),
      subtabs,
    ]),
    reqPanelBody,
  ]);

  // =====================================================================
  // RESPONSE PANEL
  // The body is rebuilt fresh on each response/loading state via
  // respPanelBody.replaceChildren(...) — so only the container + the idle
  // placeholder are constructed up front here.
  // =====================================================================
  const respPlaceholder = h("div", { class: "resp-placeholder idle" }, [
    h("div", { class: "ring" }),
    h("div", {
      class: "msg",
      text: "Fire a request — watch it travel.",
    }),
  ]);

  const respPanelBody = h("div", { class: "panel-body" }, [respPlaceholder]);
  const respPanel = h("div", { class: "panel glass" }, [
    h("div", { class: "panel-head" }, [
      h("span", { class: "title", text: "Response" }),
    ]),
    respPanelBody,
  ]);

  const body = h("div", { class: "body" }, [reqPanel, respPanel]);

  // =====================================================================
  // TOASTS + OFFLINE BANNER
  // =====================================================================
  const toastArea = h("div", { class: "toast-area" });
  const offlineBanner = h("div", { class: "offline" }, [
    h("span", { class: "o-dot" }),
    h("span", { text: "Backend offline — reconnecting…" }),
  ]);

  // Assemble HUD.
  const hudEl = h("div", { class: "hud" }, [rail, topbar, body]);
  const vignette = h("div", { class: "nebula-vignette" });
  container.appendChild(vignette);
  container.appendChild(hudEl);
  container.appendChild(toastArea);
  container.appendChild(offlineBanner);

  updateBadges();

  // =====================================================================
  // BEHAVIOR
  // =====================================================================

  /** Parse the headers textarea ("Key: Value" lines) into a record. */
  function parseHeaders(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of headersArea.value.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf(":");
      if (i <= 0) continue;
      const key = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim();
      if (key) out[key] = val;
    }
    return out;
  }

  function currentMethod(): Method {
    return (methodSelect.value as Method) || "GET";
  }

  function methodHasBody(m: string): boolean {
    return m !== "GET" && m !== "HEAD";
  }

  function buildReqSpec(): ReqSpec {
    const method = currentMethod();
    const headers = parseHeaders();
    const spec: ReqSpec = { method, url: urlInput.value.trim(), headers };
    if (methodHasBody(method) && bodyArea.value.trim()) {
      spec.body = bodyArea.value;
    }
    return spec;
  }

  function syncBodyVisibility() {
    const enabled = methodHasBody(currentMethod());
    bodyArea.disabled = !enabled;
    bodyArea.style.opacity = enabled ? "1" : "0.45";
    bodyHint.textContent = enabled
      ? "Sent with the request"
      : `${currentMethod()} requests have no body`;
  }

  function updateBadges() {
    const hCount = Object.keys(parseHeaders()).length;
    headersBadge.textContent = String(hCount);
    const bLen = bodyArea.value.length;
    bodyBadge.textContent = bLen ? `${bLen}` : "—";
  }

  function fire() {
    const url = urlInput.value.trim();
    if (!url) {
      toast("error", "Enter a URL first");
      urlInput.focus();
      return;
    }
    cb.onSend(buildReqSpec());
  }

  function saveCurrent() {
    const url = urlInput.value.trim();
    if (!url) {
      toast("error", "Nothing to save — enter a URL");
      return;
    }
    const name = window.prompt("Name this request:", suggestName(url));
    if (name === null) return; // cancelled
    const trimmed = name.trim();
    if (!trimmed) return;
    const req: SavedRequest = {
      id: crypto.randomUUID(),
      name: trimmed,
      method: currentMethod(),
      url,
      headers: parseHeaders(),
    };
    const b = bodyArea.value;
    if (methodHasBody(req.method) && b.trim()) req.body = b;
    cb.onSave(req);
  }

  function suggestName(url: string): string {
    try {
      const u = new URL(url);
      return `${currentMethod()} ${u.pathname === "/" ? u.host : u.pathname}`;
    } catch {
      return `${currentMethod()} request`;
    }
  }

  /** Load a saved/history/endpoint selection into the editor. */
  function loadInto(opts: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }) {
    if (opts.method && METHODS.includes(opts.method as Method)) {
      methodSelect.value = opts.method;
    }
    urlInput.value = opts.url;
    if (opts.headers) {
      headersArea.value = Object.entries(opts.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    }
    if (opts.body !== undefined) bodyArea.value = opts.body;
    paintMethod();
    updateBadges();
  }

  // -- rail renderers -----------------------------------------------------

  function verbChip(method: string): HTMLElement {
    const chip = h("span", { class: "verb", text: method });
    chip.style.color = METHOD_COLOR[method] ?? "#9aa6cf";
    return chip;
  }

  function emptyState(icon: string, msg: string, hint?: string): HTMLElement {
    const kids: (Node | string)[] = [
      h("div", { class: "icon", text: icon }),
      h("div", { class: "msg", text: msg }),
    ];
    if (hint) kids.push(h("div", { class: "hint", text: hint }));
    return h("div", { class: "empty" }, kids);
  }

  function renderServers() {
    paneServers.replaceChildren();
    tabServersCount.textContent = String(endpoints.length);
    if (!endpoints.length) {
      paneServers.appendChild(
        emptyState(
          "🛰",
          "No live servers found.",
          "Start a dev server in any τ-mux pane, then hit ↻ to rescan.",
        ),
      );
      // Still offer a rescan affordance.
      const rescan = h("button", {
        class: "ghost-btn accent",
        type: "button",
        style: "align-self:center;margin-top:4px",
      });
      rescan.append("↻ Rescan");
      rescan.addEventListener("click", () => cb.onDiscover());
      paneServers.appendChild(rescan);
      return;
    }
    for (const ep of endpoints) {
      const cmd = (ep.command || ep.label || `port ${ep.port}`).trim();
      const row = h("div", { class: "row", title: ep.cwd || ep.url }, [
        h("div", { class: "row-top" }, [
          h("span", { class: "dot" }),
          h("span", { class: "row-cmd", text: cmd }),
        ]),
        h("span", { class: "row-url", text: ep.url }),
        h("div", { class: "row-meta" }, [
          h("span", { text: `port ${ep.port}` }),
        ]),
      ]);
      row.addEventListener("click", () => {
        loadInto({ url: ep.url });
        cb.onSelectEndpoint(ep);
      });
      // Re-run discovery from a per-row affordance.
      const action = h("button", {
        class: "row-action",
        type: "button",
        title: "Rescan servers",
        text: "↻",
      });
      action.addEventListener("click", (e) => {
        e.stopPropagation();
        cb.onDiscover();
      });
      row.appendChild(action);
      paneServers.appendChild(row);
    }
  }

  function renderHistory() {
    paneHistory.replaceChildren();
    tabHistoryCount.textContent = String(history.length);
    if (!history.length) {
      paneHistory.appendChild(
        emptyState("🕘", "No requests yet.", "Sent requests appear here."),
      );
      return;
    }
    for (const it of history) {
      const ok = it.ok;
      const statusTxt = it.status === 0 ? "ERR" : String(it.status);
      const row = h("div", { class: "row", title: it.url }, [
        h("div", { class: "row-top" }, [
          verbChip(it.method),
          h("span", { class: "row-url", text: it.url }),
        ]),
        h("div", { class: "row-meta" }, [
          h("span", {
            text: statusTxt,
            style: `color:${ok ? "#4fe39b" : "#ff5b6e"}`,
          }),
          h("span", { text: `${it.timeMs}ms` }),
          h("span", { text: timeAgo(it.at) }),
        ]),
      ]);
      row.addEventListener("click", () =>
        loadInto({ method: it.method, url: it.url }),
      );
      paneHistory.appendChild(row);
    }
  }

  function renderCollection() {
    paneSaved.replaceChildren();
    tabSavedCount.textContent = String(collection.length);
    if (!collection.length) {
      paneSaved.appendChild(
        emptyState(
          "✦",
          "No saved requests.",
          "Build a request, then ✦ Save it to your collection.",
        ),
      );
      return;
    }
    for (const sr of collection) {
      const row = h("div", { class: "row", title: sr.url }, [
        h("div", { class: "row-top" }, [
          verbChip(sr.method),
          h("span", { class: "row-cmd", text: sr.name }),
        ]),
        h("span", { class: "row-url", text: sr.url }),
      ]);
      row.addEventListener("click", () =>
        loadInto({
          method: sr.method,
          url: sr.url,
          headers: sr.headers,
          body: sr.body,
        }),
      );
      const del = h("button", {
        class: "row-action danger",
        type: "button",
        title: "Delete",
        text: "✕",
      });
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        cb.onDelete(sr.id);
      });
      row.appendChild(del);
      paneSaved.appendChild(row);
    }
  }

  // -- response renderer --------------------------------------------------

  function statusClass(res: HttpResult): string {
    if (res.error || res.status === 0) return "status-err";
    const s = res.status;
    if (s >= 100 && s < 200) return "status-info";
    if (s >= 200 && s < 300) return "status-2xx";
    if (s >= 300 && s < 400) return "status-3xx";
    if (s >= 400 && s < 500) return "status-4xx";
    return "status-5xx";
  }

  function showResponse(res: HttpResult) {
    respPanelBody.replaceChildren();

    // Status pill.
    const statusText = res.error
      ? "TRANSPORT ERROR"
      : `${res.status} ${res.statusText}`.trim();
    const pill = h("span", { class: `status-pill ${statusClass(res)}` }, [
      h("span", { class: "pill-dot" }),
      document.createTextNode(statusText),
    ]);

    const timing = h("span", { class: "meta-pill" });
    timing.innerHTML = `⏱ <b>${res.timeMs}ms</b>`;
    const size = h("span", { class: "meta-pill" });
    size.innerHTML = `⤓ <b>${formatBytes(res.size)}</b>`;

    const metaRow = h(
      "div",
      { class: "btn-row", style: "align-items:center" },
      [pill, timing, size],
    );
    respPanelBody.appendChild(metaRow);

    // Transport error message.
    if (res.error) {
      respPanelBody.appendChild(
        h("div", {
          class: "editor-hint",
          style: "color:#ff8a96",
          text: res.error,
        }),
      );
    }

    // Response headers (collapsible).
    const headerKeys = Object.keys(res.headers || {});
    if (headerKeys.length) {
      const table = h("div", { class: "headers-table" });
      for (const k of headerKeys) {
        table.appendChild(h("span", { class: "hk", text: k }));
        table.appendChild(h("span", { class: "hv", text: res.headers[k] }));
      }
      const det = h("details", { class: "collapse" }, [
        h("summary", {}, [
          document.createTextNode("Headers"),
          h("span", { class: "count", text: `${headerKeys.length}` }),
        ]),
        table,
      ]);
      respPanelBody.appendChild(det);
    }

    // Body viewer — pretty JSON if possible, else raw text.
    const viewer = h("div", { class: "body-viewer" });
    renderBody(viewer, res);
    respPanelBody.appendChild(viewer);

    // Actions.
    const url = lastReqForResponse?.url || urlInput.value.trim();
    const openBtn = h("button", { class: "ghost-btn accent", type: "button" }, [
      document.createTextNode("⤴ Open in browser"),
    ]);
    openBtn.addEventListener("click", () => url && cb.onOpenBrowser(url));
    const curlBtn = h("button", { class: "ghost-btn", type: "button" }, [
      document.createTextNode("Send as curl →"),
    ]);
    curlBtn.addEventListener("click", () =>
      cb.onCurl(lastReqForResponse ?? buildReqSpec()),
    );
    const saveBtn = h("button", { class: "ghost-btn violet", type: "button" }, [
      document.createTextNode("✦ Save"),
    ]);
    saveBtn.addEventListener("click", saveCurrent);
    respPanelBody.appendChild(
      h("div", { class: "btn-row" }, [openBtn, curlBtn, saveBtn]),
    );
  }

  /** Pretty-print JSON when the content-type says so or the body parses as
   *  JSON; otherwise show raw text. Guarded against huge bodies. */
  function renderBody(viewer: HTMLElement, res: HttpResult) {
    const ctype = (
      res.headers?.["content-type"] ||
      res.headers?.["Content-Type"] ||
      ""
    ).toLowerCase();
    const body = res.body ?? "";
    if (!body) {
      viewer.classList.add("wrap");
      viewer.textContent = "(empty body)";
      viewer.style.color = "#5e6890";
      return;
    }
    const looksJson =
      ctype.includes("json") ||
      ((body[0] === "{" || body[0] === "[") && body.length < 2_000_000);
    if (looksJson) {
      try {
        const parsed = JSON.parse(body);
        viewer.innerHTML = highlightJson(JSON.stringify(parsed, null, 2));
        return;
      } catch {
        /* fall through to raw */
      }
    }
    // Raw text (wrapped). Cap rendered length to keep the DOM light.
    viewer.classList.add("wrap");
    const MAX = 200_000;
    viewer.textContent =
      body.length > MAX ? body.slice(0, MAX) + "\n…(truncated)" : body;
  }

  // =====================================================================
  // PUBLIC SETTERS
  // =====================================================================
  function setEndpoints(items: Endpoint[]) {
    endpoints = items;
    renderServers();
  }
  function setHistory(items: HistoryEntry[]) {
    history = items;
    renderHistory();
  }
  function setCollection(items: SavedRequest[]) {
    collection = items;
    renderCollection();
  }
  function setLoading(loading: boolean) {
    sendBtn.classList.toggle("loading", loading);
    sendBtn.disabled = loading;
    sendLabel.textContent = loading ? "Sending" : "Send";
    if (loading) {
      // Snapshot the request that produced the in-flight response.
      lastReqForResponse = buildReqSpec();
      respPanelBody.replaceChildren(
        h("div", { class: "resp-placeholder" }, [
          h("div", { class: "ring" }),
          h("div", { class: "msg", text: "Awaiting response…" }),
        ]),
      );
    }
  }
  function setUrl(url: string) {
    urlInput.value = url;
  }

  // -- toasts (auto-dismiss) ----------------------------------------------
  function toast(level: "info" | "success" | "error", message: string) {
    const el = h("div", { class: `toast ${level}` }, [
      h("span", { class: "t-dot" }),
      h("span", { class: "t-msg", text: message }),
    ]);
    toastArea.appendChild(el);
    const ttl = level === "error" ? 5200 : 3200;
    window.setTimeout(() => {
      el.classList.add("leaving");
      window.setTimeout(() => el.remove(), 320);
    }, ttl);
    // Keep at most 4 visible.
    while (toastArea.children.length > 4) toastArea.firstChild?.remove();
  }

  // Expose the offline banner toggle via a custom hook on the element so
  // main.ts can flip it on lifecycle "exited" without extra API surface.
  (hudEl as unknown as { _setOffline?: (v: boolean) => void })._setOffline = (
    v: boolean,
  ) => offlineBanner.classList.toggle("show", v);

  paintMethod();

  return {
    el: hudEl,
    setEndpoints,
    setHistory,
    setCollection,
    showResponse,
    setLoading,
    setUrl,
    toast,
  };
}

// ===========================================================================
// pure helpers
// ===========================================================================

/** Escape + colorize a JSON string (already 2-space indented) into HTML. */
function highlightJson(json: string): string {
  const esc = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Token regex: strings (incl. keys), numbers, booleans, null.
  return esc.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "tk-num";
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "tk-key" : "tk-str";
      } else if (/true|false/.test(match)) {
        cls = "tk-bool";
      } else if (/null/.test(match)) {
        cls = "tk-null";
      }
      // Keep the trailing colon outside the colored key span for readability.
      if (cls === "tk-key") {
        const m = match.replace(/:$/, "");
        return `<span class="tk-key">${m}</span><span class="tk-punct">:</span>`;
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  const v = n / Math.pow(1024, i);
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

function timeAgo(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const hrs = Math.floor(m / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
