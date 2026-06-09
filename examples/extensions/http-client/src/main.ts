// HTTP Client — frontend (runs inside the Vite iframe).
//
// This is a vanilla-DOM, framework-free Postman-style request builder. It never
// performs the HTTP request itself: doing so from the iframe would be subject to
// the browser's CORS policy. Instead it ships the request description down to the
// extension's own Bun backend (`sdk.sendToBackend`), which runs `fetch` in a
// privileged, CORS-free environment and streams the response back
// (`sdk.onBackendMessage`). The same backend persists request history.

import { createFrontendSdk } from "@tau-mux/sdk/frontend";

// ---- Wire types shared (by convention) with src/index.ts -------------------

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/** Frontend → backend: "please run this request". */
interface RequestMessage {
  type: "request";
  id: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Frontend → backend: "send me the saved history". */
interface HistoryRequestMessage {
  type: "history";
}

/** Backend → frontend: result of a request (or an error). */
interface ResponseMessage {
  type: "response";
  id: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  timeMs?: number;
  error?: string;
}

/** A single persisted history entry. */
interface HistoryEntry {
  method: HttpMethod;
  url: string;
  status: number | null;
  at: number;
}

/** Backend → frontend: the saved history list. */
interface HistoryReplyMessage {
  type: "history";
  items: HistoryEntry[];
}

type BackendMessage = ResponseMessage | HistoryReplyMessage;

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const DEFAULT_URL = "https://httpbin.org/get";

// ---- Small DOM helpers ------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) {
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

/** A method without a request body (the body editor is hidden for these). */
function methodHasBody(m: HttpMethod): boolean {
  return m !== "GET" && m !== "HEAD";
}

/** Parse a "Key: Value" per-line header block into an object. Blank lines and
 *  lines without a colon are ignored, so a half-typed editor never breaks send. */
function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Pretty-print a body: JSON gets 2-space indentation, everything else is raw. */
function formatBody(body: string, contentType: string | undefined): string {
  const looksJson =
    (contentType ?? "").toLowerCase().includes("json") || /^\s*[[{]/.test(body);
  if (looksJson) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* fall through to raw */
    }
  }
  return body;
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "warn";
  return "err";
}

// ---- Mount ------------------------------------------------------------------

function mount(): void {
  const sdk = createFrontendSdk();

  const root = document.getElementById("app");
  if (!root) return;

  // In-flight resolvers keyed by request id. When the backend replies with a
  // matching {type:"response", id}, we settle the promise.
  const pending = new Map<string, (res: ResponseMessage) => void>();
  let reqCounter = 0;

  // --- Request bar: method / url / send -------------------------------------
  const methodSelect = el("select", { className: "method" });
  for (const m of METHODS) {
    methodSelect.append(el("option", { value: m, textContent: m }));
  }
  const urlInput = el("input", {
    className: "url",
    type: "text",
    value: DEFAULT_URL,
    placeholder: "https://example.com/api",
    spellcheck: false,
  });
  const sendBtn = el("button", { className: "send", textContent: "Send" });

  const requestBar = el("div", { className: "request-bar" }, [
    methodSelect,
    urlInput,
    sendBtn,
  ]);

  // --- Editors: headers + body ----------------------------------------------
  const headersArea = el("textarea", {
    placeholder: "Content-Type: application/json\nAuthorization: Bearer …",
    spellcheck: false,
    value: "",
  });
  const headersEditor = el("div", { className: "editor" }, [
    el("label", { textContent: "Headers (one per line: Key: Value)" }),
    headersArea,
  ]);

  const bodyArea = el("textarea", {
    placeholder: '{\n  "hello": "world"\n}',
    spellcheck: false,
    value: "",
  });
  const bodyEditor = el("div", { className: "editor" }, [
    el("label", { textContent: "Request Body" }),
    bodyArea,
  ]);

  const editors = el("div", { className: "editors" }, [
    headersEditor,
    bodyEditor,
  ]);

  // --- Response viewer -------------------------------------------------------
  const statusPill = el("span", {
    className: "status-pill",
    textContent: "Ready",
  });
  const timingEl = el("span", { className: "timing" });
  const statusLine = el("div", { className: "status-line" }, [
    statusPill,
    timingEl,
  ]);
  const respHeaders = el("div", { className: "resp-headers muted" });
  const respBody = el("pre", { className: "resp-body" });
  const responsePanel = el("div", { className: "response" }, [
    statusLine,
    respHeaders,
    respBody,
  ]);

  const main = el("div", { className: "main" }, [
    requestBar,
    editors,
    responsePanel,
  ]);

  // --- History rail ----------------------------------------------------------
  const historyList = el("ul", { className: "history-list" });
  const historyPanel = el("div", { className: "history" }, [
    el("h2", { textContent: "History" }),
    historyList,
  ]);

  root.append(main, historyPanel);

  // --- View helpers ----------------------------------------------------------

  /** Show/hide the body editor depending on the selected method. */
  function syncBodyVisibility(): void {
    const method = methodSelect.value as HttpMethod;
    bodyEditor.classList.toggle("hidden", !methodHasBody(method));
  }

  function setStatus(text: string, cls: string): void {
    statusPill.textContent = text;
    statusPill.className = `status-pill ${cls}`;
  }

  function renderResponseHeaders(headers: Record<string, string>): void {
    respHeaders.replaceChildren();
    const keys = Object.keys(headers);
    if (keys.length === 0) {
      respHeaders.textContent = "(no headers)";
      return;
    }
    for (const k of keys) {
      respHeaders.append(
        el("div", {}, [
          el("span", { className: "hk", textContent: k }),
          `: ${headers[k]}`,
        ]),
      );
    }
  }

  function renderResponse(res: ResponseMessage): void {
    if (res.error) {
      setStatus("Error", "err");
      timingEl.textContent = "";
      respHeaders.replaceChildren();
      respHeaders.textContent = "";
      respBody.textContent = res.error;
      return;
    }
    const status = res.status ?? 0;
    setStatus(`${status} ${res.statusText ?? ""}`.trim(), statusClass(status));
    timingEl.textContent =
      res.timeMs != null ? `${res.timeMs.toFixed(1)} ms` : "";
    renderResponseHeaders(res.headers ?? {});
    const ct = (res.headers ?? {})["content-type"];
    respBody.textContent = formatBody(res.body ?? "", ct);
  }

  function renderHistory(items: HistoryEntry[]): void {
    historyList.replaceChildren();
    if (items.length === 0) {
      historyList.append(
        el("li", {
          className: "history-empty",
          textContent: "No requests yet.",
        }),
      );
      return;
    }
    // Newest first.
    for (const entry of [...items].reverse()) {
      const methodSpan = el("span", {
        className: "hmethod",
        textContent: entry.method,
      });
      methodSpan.style.color =
        entry.status && entry.status >= 400 ? "#f08a8a" : "#6ee7a0";
      const item = el("li", { className: "history-item" }, [
        methodSpan,
        el("span", {
          className: "hurl",
          textContent: entry.url,
          title: entry.url,
        }),
        el("span", {
          className: "hstatus",
          textContent:
            (entry.status != null ? `${entry.status} · ` : "") +
            new Date(entry.at).toLocaleTimeString(),
        }),
      ]);
      // Clicking a history entry refills the form with that request.
      item.addEventListener("click", () => {
        methodSelect.value = entry.method;
        urlInput.value = entry.url;
        syncBodyVisibility();
      });
      historyList.append(item);
    }
  }

  // --- Send flow -------------------------------------------------------------

  function send(): void {
    const method = methodSelect.value as HttpMethod;
    const url = urlInput.value.trim();
    if (!url) {
      setStatus("Enter a URL", "warn");
      return;
    }
    const id = `r${++reqCounter}-${Date.now()}`;
    const headers = parseHeaders(headersArea.value);
    const body = methodHasBody(method) ? bodyArea.value : "";

    // Loading state.
    sendBtn.disabled = true;
    setStatus("Sending…", "pending");
    timingEl.textContent = "";
    respHeaders.replaceChildren();
    respHeaders.textContent = "";
    respBody.textContent = "";

    // Resolve when the matching response arrives via onBackendMessage.
    pending.set(id, (res) => {
      sendBtn.disabled = false;
      renderResponse(res);
      // Ask the backend for the (now-updated) history so the rail refreshes.
      sdk.sendToBackend({ type: "history" } satisfies HistoryRequestMessage);
    });

    const msg: RequestMessage = {
      type: "request",
      id,
      method,
      url,
      headers,
      body,
    };
    sdk.sendToBackend(msg);

    // Mirror activity into the τ-mux sidebar (best-effort; ignore failures).
    void sdk.sidebar
      .setStatus({ key: "http", value: `${method} ${url}` })
      .catch(() => {});
  }

  // --- Wire events -----------------------------------------------------------
  methodSelect.addEventListener("change", syncBodyVisibility);
  sendBtn.addEventListener("click", send);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
  syncBodyVisibility();

  // --- Backend → frontend messages ------------------------------------------
  sdk.onBackendMessage((data) => {
    try {
      const msg = data as BackendMessage;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "response") {
        const resolver = pending.get(msg.id);
        if (resolver) {
          pending.delete(msg.id);
          resolver(msg);
        }
      } else if (msg.type === "history") {
        renderHistory(Array.isArray(msg.items) ? msg.items : []);
      }
    } catch {
      /* never throw out of a message handler */
    }
  });

  // --- Ask for saved history on load ----------------------------------------
  sdk.sendToBackend({ type: "history" } satisfies HistoryRequestMessage);
}

// Never throw on mount — a broken extension UI should fail soft.
try {
  mount();
} catch (err) {
  const root = document.getElementById("app");
  if (root) {
    root.textContent = `HTTP Client failed to start: ${String(err)}`;
  }
}
