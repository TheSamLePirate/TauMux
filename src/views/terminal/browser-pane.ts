/**
 * browser-pane.ts — DOM construction and event wiring for a single browser pane.
 *
 * Replaces what xterm.js + TerminalEffects + PanelManager do for terminal panes.
 * Each browser pane embeds an <electrobun-webview> OOPIF element with an address
 * bar, navigation buttons, and event forwarding.
 */

import { createIcon } from "./icons";

// ── Electrobun webview tag type (matches the runtime custom element) ──

interface WebviewTagElement extends HTMLElement {
  webviewId?: number;
  src: string | null;
  partition: string | null;
  sandbox: boolean;
  preload: string | null;
  transparent: boolean;
  passthroughEnabled: boolean;
  hidden: boolean;

  canGoBack(): Promise<boolean>;
  canGoForward(): Promise<boolean>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(url: string): void;
  loadHTML(html: string): void;
  syncDimensions(force?: boolean): void;
  setNavigationRules(rules: string[]): void;
  findInPage(
    searchText: string,
    options?: { forward?: boolean; matchCase?: boolean },
  ): void;
  stopFindInPage(): void;
  openDevTools(): void;
  closeDevTools(): void;
  toggleDevTools(): void;
  executeJavascript(js: string): void;
  toggleHidden(hidden?: boolean): void;
  togglePassthrough(enable?: boolean): void;

  on(event: string, listener: (event: CustomEvent) => void): void;
  off(event: string, listener: (event: CustomEvent) => void): void;
}

// ── URL helpers ──

const SEARCH_ENGINES: Record<string, string> = {
  google: "https://www.google.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  bing: "https://www.bing.com/search?q=",
  kagi: "https://kagi.com/search?q=",
};

export function isUrl(input: string): boolean {
  if (/^https?:\/\//i.test(input)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(input)) return true;
  if (/^127\.0\.0\.1(:\d+)?(\/|$)/.test(input)) return true;
  if (/^\[?::1\]?(:\d+)?(\/|$)/.test(input)) return true;
  // domain-like: at least one dot, no spaces
  if (/^[\w-]+(\.[\w-]+)+/.test(input) && !/\s/.test(input)) return true;
  return false;
}

export function normalizeUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (/^localhost/i.test(input) || /^127\./.test(input) || /^::1/.test(input)) {
    return `http://${input}`;
  }
  return `https://${input}`;
}

export function buildSearchUrl(
  query: string,
  engine: string = "google",
): string {
  const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES["google"];
  return base + encodeURIComponent(query);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ── Console capture preload script ──

const CONSOLE_CAPTURE_PRELOAD = `
(function() {
  var _orig = {};
  ["log","info","warn","error","debug"].forEach(function(l) {
    _orig[l] = console[l];
    console[l] = function() {
      _orig[l].apply(console, arguments);
      try {
        window.__electrobunSendToHost({
          type: "console", level: l,
          args: Array.prototype.slice.call(arguments).map(function(a) {
            try { return typeof a === "object" ? JSON.stringify(a) : String(a); }
            catch(e) { return String(a); }
          }),
          timestamp: Date.now()
        });
      } catch(e) {}
    };
  });
  window.addEventListener("error", function(e) {
    try {
      window.__electrobunSendToHost({
        type: "error", message: e.message,
        filename: e.filename, lineno: e.lineno, timestamp: Date.now()
      });
    } catch(ex) {}
  });
  window.addEventListener("unhandledrejection", function(e) {
    try {
      window.__electrobunSendToHost({
        type: "error",
        message: "Unhandled rejection: " + String(e.reason),
        timestamp: Date.now()
      });
    } catch(ex) {}
  });

  // Title change observer
  function reportTitle() {
    try {
      window.__electrobunSendToHost({ type: "title", title: document.title });
    } catch(e) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      reportTitle();
      try {
        var target = document.querySelector("title") || document.head;
        if (target) {
          new MutationObserver(reportTitle).observe(target,
            { childList: true, subtree: true, characterData: true });
        }
      } catch(e) {}
    });
  } else {
    reportTitle();
    try {
      var target = document.querySelector("title") || document.head;
      if (target) {
        new MutationObserver(reportTitle).observe(target,
          { childList: true, subtree: true, characterData: true });
      }
    } catch(e) {}
  }
})();
`;

// ── Browser pane view interface ──

export interface BrowserPaneView {
  id: string;
  surfaceType: "browser";
  container: HTMLDivElement;
  webviewEl: WebviewTagElement;
  addressBar: HTMLInputElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
  currentUrl: string;
  isLoading: boolean;
  backBtn: HTMLButtonElement;
  forwardBtn: HTMLButtonElement;
  reloadBtn: HTMLButtonElement;
  lockIcon: HTMLSpanElement;
  zoom: number;
  /** Find-in-page bar elements */
  findBarEl: HTMLDivElement | null;
  findInputEl: HTMLInputElement | null;
  findVisible: boolean;
  /** Intended hidden state — tracked so we can re-apply once the OOPIF
   *  finishes initializing. If the pane is created in an inactive
   *  workspace, the first toggleHidden/togglePassthrough calls no-op
   *  because webviewId is still null; a small retry loop reapplies. */
  desiredHidden: boolean;
  /** Cleanup callbacks run on destroy: detaches webviewEl.on() handlers
   *  and removes addEventListener bindings. Without this every closed
   *  browser pane leaks its callback closures (which hold surfaceId and
   *  callbacks refs). */
  _cleanup: (() => void)[];
}

export interface BrowserPaneCallbacks {
  onNavigated: (surfaceId: string, url: string, title: string) => void;
  onTitleChanged: (surfaceId: string, title: string) => void;
  onNewWindow: (surfaceId: string, url: string) => void;
  onFocus: (surfaceId: string) => void;
  onClose: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => void;
  onDomReady?: (surfaceId: string, url: string) => void;
  onEvalResult?: (
    surfaceId: string,
    reqId: string,
    result?: string,
    error?: string,
  ) => void;
  onConsoleLog?: (
    surfaceId: string,
    level: string,
    args: string[],
    timestamp: number,
  ) => void;
  onError?: (
    surfaceId: string,
    message: string,
    filename: string | undefined,
    lineno: number | undefined,
    timestamp: number,
  ) => void;
}

// ── Create browser pane ──

export function createBrowserPaneView(
  surfaceId: string,
  initialUrl: string,
  callbacks: BrowserPaneCallbacks,
  searchEngine: string = "google",
): BrowserPaneView {
  // Container
  const container = document.createElement("div");
  container.className = "surface-container surface-browser";
  container.dataset["surfaceId"] = surfaceId;
  container.dataset["surfaceType"] = "browser";
  container.style.display = "none";

  // ── Surface bar (matches terminal pane pattern) ──
  const bar = document.createElement("div");
  bar.className = "surface-bar";

  const barTitleWrap = document.createElement("div");
  barTitleWrap.className = "surface-bar-title-wrap";

  const barIcon = createIcon("globe", "surface-bar-icon", 12);
  barTitleWrap.appendChild(barIcon);

  const barTitle = document.createElement("span");
  barTitle.className = "surface-bar-title";
  barTitle.textContent = "New Tab";
  barTitleWrap.appendChild(barTitle);
  bar.appendChild(barTitleWrap);

  const chipsEl = document.createElement("div");
  chipsEl.className = "surface-bar-chips";
  bar.appendChild(chipsEl);

  const barActions = document.createElement("div");
  barActions.className = "surface-bar-actions";

  const infoBtn = document.createElement("button");
  infoBtn.className = "surface-bar-btn";
  infoBtn.title = "Pane Info";
  infoBtn.setAttribute("aria-label", "Pane info");
  infoBtn.append(createIcon("info"));
  infoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("ht-show-surface-info", { detail: { surfaceId } }),
    );
  });
  barActions.appendChild(infoBtn);

  const splitRightBtn = document.createElement("button");
  splitRightBtn.className = "surface-bar-btn";
  splitRightBtn.title = "Split Right";
  splitRightBtn.setAttribute("aria-label", "Split right");
  splitRightBtn.append(createIcon("splitHorizontal"));
  splitRightBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onSplit(surfaceId, "horizontal");
  });
  barActions.appendChild(splitRightBtn);

  const splitDownBtn = document.createElement("button");
  splitDownBtn.className = "surface-bar-btn";
  splitDownBtn.title = "Split Down";
  splitDownBtn.setAttribute("aria-label", "Split down");
  splitDownBtn.append(createIcon("splitVertical"));
  splitDownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onSplit(surfaceId, "vertical");
  });
  barActions.appendChild(splitDownBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "surface-bar-btn surface-bar-close";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close pane");
  closeBtn.append(createIcon("close"));
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onClose(surfaceId);
  });
  barActions.appendChild(closeBtn);

  bar.appendChild(barActions);
  container.appendChild(bar);

  // ── Address bar ──
  const addressBarRow = document.createElement("div");
  addressBarRow.className = "browser-address-bar";

  const backBtn = document.createElement("button");
  backBtn.className = "browser-nav-btn";
  backBtn.title = "Back (⌘[)";
  backBtn.setAttribute("aria-label", "Back");
  backBtn.disabled = true;
  backBtn.append(createIcon("chevronLeft", "", 14));
  addressBarRow.appendChild(backBtn);

  const forwardBtn = document.createElement("button");
  forwardBtn.className = "browser-nav-btn";
  forwardBtn.title = "Forward (⌘])";
  forwardBtn.setAttribute("aria-label", "Forward");
  forwardBtn.disabled = true;
  forwardBtn.append(createIcon("chevronRight", "", 14));
  addressBarRow.appendChild(forwardBtn);

  const reloadBtn = document.createElement("button");
  reloadBtn.className = "browser-nav-btn";
  reloadBtn.title = "Reload (⌘R)";
  reloadBtn.setAttribute("aria-label", "Reload");
  reloadBtn.append(createIcon("reload", "", 14));
  addressBarRow.appendChild(reloadBtn);

  const lockIcon = document.createElement("span");
  lockIcon.className = "browser-lock-icon";
  lockIcon.textContent = ""; // will be set by updateLockIcon
  addressBarRow.appendChild(lockIcon);

  const addressBar = document.createElement("input");
  addressBar.className = "browser-url-input";
  addressBar.type = "text";
  addressBar.placeholder = "Search or enter URL";
  addressBar.spellcheck = false;
  addressBar.autocomplete = "off";
  addressBar.setAttribute("autocapitalize", "off");
  addressBarRow.appendChild(addressBar);

  const devToolsBtn = document.createElement("button");
  devToolsBtn.className = "browser-nav-btn";
  devToolsBtn.title = "Developer Tools (⌥⌘I)";
  devToolsBtn.setAttribute("aria-label", "Developer tools");
  devToolsBtn.append(createIcon("code", "", 14));
  addressBarRow.appendChild(devToolsBtn);

  container.appendChild(addressBarRow);

  // ── Webview container ──
  const webviewContainer = document.createElement("div");
  webviewContainer.className = "browser-webview-container";

  const webviewEl = document.createElement(
    "electrobun-webview",
  ) as unknown as WebviewTagElement;
  webviewEl.setAttribute("src", initialUrl || "about:blank");
  webviewEl.setAttribute("partition", "persist:browser-shared");
  webviewEl.setAttribute("preload", CONSOLE_CAPTURE_PRELOAD);
  // Note: we don't set sandbox since we need preload's __electrobunSendToHost
  // for console capture and title reporting.
  webviewContainer.appendChild(webviewEl as unknown as HTMLElement);

  // Default navigation rules: allow everything but block known-dangerous schemes
  // Users can further restrict via settings (host whitelist).
  webviewEl.setNavigationRules([
    "^javascript:*", // block javascript: URLs
    "^data:text/html*", // block data: HTML (XSS vector)
  ]);
  container.appendChild(webviewContainer);

  // ── View object ──
  const view: BrowserPaneView = {
    id: surfaceId,
    surfaceType: "browser",
    container,
    webviewEl,
    addressBar,
    titleEl: barTitle,
    chipsEl,
    title: "New Tab",
    currentUrl: initialUrl || "about:blank",
    isLoading: false,
    backBtn,
    forwardBtn,
    reloadBtn,
    lockIcon,
    zoom: 1.0,
    findBarEl: null,
    findInputEl: null,
    findVisible: false,
    desiredHidden: false,
    _cleanup: [],
  };

  /** Register a webviewEl.on(event, listener) and stash an off() hook
   *  for destroy(). Thin helper so the rest of the wiring reads the
   *  same. */
  const onWV = (event: string, listener: (e: CustomEvent) => void) => {
    webviewEl.on(event, listener);
    view._cleanup.push(() => {
      try {
        webviewEl.off(event, listener);
      } catch {
        /* element may already be detached */
      }
    });
  };
  /** Same idea for standard addEventListener bindings. */
  const onDom = <T extends Event>(
    target: EventTarget,
    event: string,
    listener: (e: T) => void,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(event, listener as EventListener, options);
    view._cleanup.push(() => {
      try {
        target.removeEventListener(event, listener as EventListener, options);
      } catch {
        /* ignore */
      }
    });
  };

  // ── Event wiring ──

  function updateLockIcon(url: string) {
    if (url.startsWith("https://")) {
      lockIcon.textContent = "🔒";
      lockIcon.title = "Secure connection";
      lockIcon.className = "browser-lock-icon browser-lock-secure";
    } else if (url.startsWith("http://")) {
      lockIcon.textContent = "⚠";
      lockIcon.title = "Insecure connection";
      lockIcon.className = "browser-lock-icon browser-lock-insecure";
    } else {
      lockIcon.textContent = "";
      lockIcon.className = "browser-lock-icon";
    }
  }

  async function updateBackForwardState() {
    try {
      backBtn.disabled = !(await webviewEl.canGoBack());
      forwardBtn.disabled = !(await webviewEl.canGoForward());
    } catch {
      // canGoBack/canGoForward may fail if webview is not ready
    }
  }

  function navigateTo(input: string) {
    const url = isUrl(input)
      ? normalizeUrl(input)
      : buildSearchUrl(input, searchEngine);
    webviewEl.loadURL(url);
  }

  // Navigation events
  onWV("did-navigate", (e: CustomEvent) => {
    const url =
      typeof e.detail === "string" ? e.detail : ((e.detail as any)?.url ?? "");
    if (!url) return;
    view.currentUrl = url;
    view.isLoading = false;
    reloadBtn.classList.remove("browser-loading");
    addressBar.value = url;
    updateLockIcon(url);
    void updateBackForwardState();
    // Title extraction happens via the preload's MutationObserver
    callbacks.onNavigated(surfaceId, url, view.title);
    updateDomainChip();
  });

  onWV("did-navigate-in-page", (e: CustomEvent) => {
    const url =
      typeof e.detail === "string" ? e.detail : ((e.detail as any)?.url ?? "");
    if (url) {
      view.currentUrl = url;
      addressBar.value = url;
      void updateBackForwardState();
    }
  });

  onWV("will-navigate", () => {
    view.isLoading = true;
    reloadBtn.classList.add("browser-loading");
  });

  onWV("dom-ready", () => {
    view.isLoading = false;
    reloadBtn.classList.remove("browser-loading");
    void updateBackForwardState();
    callbacks.onDomReady?.(surfaceId, view.currentUrl);
  });

  // Apply dark mode on initial load if URL is set
  // (further dark mode injection happens in applyDarkMode below)

  onWV("host-message", (e: CustomEvent) => {
    const msg = e.detail as Record<string, unknown> | null;
    if (!msg) return;

    if (msg["type"] === "title") {
      const title = (msg["title"] as string) || view.currentUrl;
      view.title = title;
      barTitle.textContent = title;
      callbacks.onTitleChanged(surfaceId, title);
      updateDomainChip();
    }

    if (msg["type"] === "evalResult" && callbacks.onEvalResult) {
      callbacks.onEvalResult(
        surfaceId,
        msg["reqId"] as string,
        msg["result"] as string | undefined,
        msg["error"] as string | undefined,
      );
    }

    if (msg["type"] === "console" && callbacks.onConsoleLog) {
      callbacks.onConsoleLog(
        surfaceId,
        msg["level"] as string,
        msg["args"] as string[],
        msg["timestamp"] as number,
      );
    }

    if (msg["type"] === "error" && callbacks.onError) {
      callbacks.onError(
        surfaceId,
        msg["message"] as string,
        msg["filename"] as string | undefined,
        msg["lineno"] as number | undefined,
        msg["timestamp"] as number,
      );
    }
  });

  onWV("new-window-open", (e: CustomEvent) => {
    const url =
      typeof e.detail === "string" ? e.detail : ((e.detail as any)?.url ?? "");
    if (url) callbacks.onNewWindow(surfaceId, url);
  });

  // Address bar events
  onDom<KeyboardEvent>(addressBar, "keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const input = addressBar.value.trim();
      if (input) navigateTo(input);
      addressBar.blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      addressBar.value = view.currentUrl;
      addressBar.blur();
    }
    // Prevent global keyboard handler from capturing these
    e.stopPropagation();
  });

  onDom(addressBar, "focus", () => {
    addressBar.select();
  });

  // Navigation buttons
  onDom(backBtn, "click", () => webviewEl.goBack());
  onDom(forwardBtn, "click", () => webviewEl.goForward());
  onDom(reloadBtn, "click", () => {
    if (view.isLoading) {
      // Stop by navigating to current URL
      webviewEl.loadURL(view.currentUrl);
    } else {
      webviewEl.reload();
    }
  });

  onDom(devToolsBtn, "click", () => {
    webviewEl.toggleDevTools();
  });

  // Focus handling
  onDom(container, "mousedown", () => {
    callbacks.onFocus(surfaceId);
  });

  // Domain chip update
  function updateDomainChip() {
    chipsEl.innerHTML = "";
    const domain = extractDomain(view.currentUrl);
    if (domain) {
      const chip = document.createElement("span");
      chip.className = "surface-chip chip-domain";
      chip.textContent = domain;
      chipsEl.appendChild(chip);
    }
  }

  // Initial state
  addressBar.value = initialUrl || "";
  updateLockIcon(initialUrl);
  updateDomainChip();

  return view;
}

// ── Public helpers called from SurfaceManager ──

/** Release every listener registered against webviewEl and the address
 *  bar / nav buttons / container. Call before removing the pane from
 *  the DOM — otherwise the electrobun webview tag keeps our callbacks
 *  (and their surfaceId/callbacks closures) alive indefinitely. */
export function destroyBrowserPaneView(view: BrowserPaneView): void {
  for (const fn of view._cleanup) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  view._cleanup = [];
}

export function browserPaneNavigateTo(view: BrowserPaneView, url: string) {
  const resolved = isUrl(url) ? normalizeUrl(url) : url;
  view.webviewEl.loadURL(resolved);
}

export function browserPaneGoBack(view: BrowserPaneView) {
  view.webviewEl.goBack();
}

export function browserPaneGoForward(view: BrowserPaneView) {
  view.webviewEl.goForward();
}

export function browserPaneReload(view: BrowserPaneView) {
  view.webviewEl.reload();
}

export function browserPaneEvalJs(
  view: BrowserPaneView,
  script: string,
  reqId?: string,
) {
  if (reqId) {
    // Wrap to send result back via host-message
    const wrapped = `
      try {
        var __r = eval(${JSON.stringify(script)});
        window.__electrobunSendToHost({
          type: "evalResult",
          reqId: ${JSON.stringify(reqId)},
          result: typeof __r === "object" ? JSON.stringify(__r) : String(__r)
        });
      } catch(__e) {
        window.__electrobunSendToHost({
          type: "evalResult",
          reqId: ${JSON.stringify(reqId)},
          error: __e.message
        });
      }
    `;
    view.webviewEl.executeJavascript(wrapped);
  } else {
    view.webviewEl.executeJavascript(script);
  }
}

export function browserPaneFindInPage(view: BrowserPaneView, query: string) {
  if (!view.findBarEl) {
    // Create find bar
    const findBar = document.createElement("div");
    findBar.className = "browser-find-bar";

    const findInput = document.createElement("input");
    findInput.className = "browser-find-input";
    findInput.type = "text";
    findInput.placeholder = "Find in page…";
    findInput.setAttribute("aria-label", "Find in page");

    findInput.addEventListener("input", () => {
      const q = findInput.value;
      if (q) {
        view.webviewEl.findInPage(q);
      } else {
        view.webviewEl.stopFindInPage();
      }
    });

    findInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        if (findInput.value)
          view.webviewEl.findInPage(findInput.value, { forward: false });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (findInput.value) view.webviewEl.findInPage(findInput.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        browserPaneStopFind(view);
      }
      e.stopPropagation();
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "browser-find-close";
    closeBtn.title = "Close (Escape)";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => browserPaneStopFind(view));

    findBar.appendChild(findInput);
    findBar.appendChild(closeBtn);

    // Insert after address bar
    const addressBarRow = view.container.querySelector(".browser-address-bar");
    if (addressBarRow) {
      addressBarRow.insertAdjacentElement("afterend", findBar);
    } else {
      view.container.appendChild(findBar);
    }

    view.findBarEl = findBar;
    view.findInputEl = findInput;
  }

  view.findBarEl.classList.add("browser-find-bar-visible");
  view.findVisible = true;
  view.findInputEl!.value = query || "";
  view.findInputEl!.focus();
  view.findInputEl!.select();
  if (query) view.webviewEl.findInPage(query);
}

export function browserPaneStopFind(view: BrowserPaneView) {
  if (!view.findVisible) return;
  view.findVisible = false;
  view.findBarEl?.classList.remove("browser-find-bar-visible");
  view.webviewEl.stopFindInPage();
}

export function browserPaneToggleDevTools(view: BrowserPaneView) {
  view.webviewEl.toggleDevTools();
}

export function browserPaneSetZoom(view: BrowserPaneView, zoom: number) {
  view.zoom = Math.max(0.25, Math.min(5.0, zoom));
  // Page zoom is on the BrowserView API (bun-side), not the webview tag.
  // For now we use CSS transform as a workaround.
  const webviewContainer = view.container.querySelector(
    ".browser-webview-container",
  ) as HTMLElement | null;
  if (webviewContainer) {
    (
      webviewContainer.querySelector("electrobun-webview") as HTMLElement
    )?.style.setProperty("zoom", String(view.zoom));
  }
}

export function browserPaneFocusAddressBar(view: BrowserPaneView) {
  view.addressBar.focus();
  view.addressBar.select();
}

export function browserPaneSyncDimensions(view: BrowserPaneView) {
  try {
    view.webviewEl.syncDimensions(true);
  } catch {
    // May fail if webview is hidden or not attached
  }
}

export function browserPaneSetHidden(view: BrowserPaneView, hidden: boolean) {
  view.desiredHidden = hidden;
  applyHiddenState(view);
}

function applyHiddenState(view: BrowserPaneView): void {
  // `toggleHidden` / `togglePassthrough` silently no-op if the OOPIF
  // isn't initialized yet (webviewId === null). When a browser pane is
  // created in an inactive workspace the first hide call lands before
  // init completes; retry on a short poll until it sticks.
  const w = view.webviewEl as WebviewTagElement & { webviewId?: number | null };
  try {
    w.toggleHidden(view.desiredHidden);
    // `hidden` stops the OOPIF from rendering but does not always remove
    // it from native hit-testing. Since the OOPIF lives as a separate
    // NSView on top of the host window, stale positions can silently
    // absorb clicks in the active workspace. Passthrough forces the
    // native layer to pass mouse events through to the host regardless
    // of where the overlay sits.
    w.togglePassthrough(view.desiredHidden);
  } catch {
    /* ignore */
  }
  if (w.webviewId === null || w.webviewId === undefined) {
    setTimeout(() => applyHiddenState(view), 50);
  }
}

export function browserPaneInjectCookies(
  view: BrowserPaneView,
  cookies: Array<{
    name: string;
    value: string;
    path: string;
    expires: number;
    secure: boolean;
    sameSite: string;
  }>,
): void {
  if (cookies.length === 0) return;
  const statements = cookies.map((c) => {
    const parts = [
      `${encodeURIComponent(c.name)}=${encodeURIComponent(c.value)}`,
    ];
    if (c.path) parts.push(`path=${c.path}`);
    if (c.expires > 0) {
      parts.push(`expires=${new Date(c.expires * 1000).toUTCString()}`);
    }
    if (c.secure) parts.push("secure");
    if (c.sameSite) parts.push(`samesite=${c.sameSite}`);
    return `document.cookie = ${JSON.stringify(parts.join("; "))};`;
  });
  view.webviewEl.executeJavascript(statements.join("\n"));
}

export function browserPaneGetCookies(
  view: BrowserPaneView,
  reqId: string,
): void {
  const script = `
    (function() {
      var cookies = document.cookie.split('; ').filter(Boolean).map(function(c) {
        var eq = c.indexOf('=');
        return { name: c.substring(0, eq), value: c.substring(eq + 1) };
      });
      window.__electrobunSendToHost({
        type: "evalResult",
        reqId: ${JSON.stringify(reqId)},
        result: JSON.stringify({ url: window.location.href, cookies: cookies })
      });
    })()
  `;
  view.webviewEl.executeJavascript(script);
}

const DARK_MODE_CSS = `
  html { color-scheme: dark !important; }
  @media (prefers-color-scheme: light) {
    html {
      filter: invert(1) hue-rotate(180deg) !important;
    }
    img, video, canvas, svg, picture {
      filter: invert(1) hue-rotate(180deg) !important;
    }
  }
`;

export function browserPaneApplyDarkMode(
  view: BrowserPaneView,
  enabled: boolean,
) {
  if (enabled) {
    view.webviewEl.executeJavascript(`
      if (!document.getElementById("__ht_dark_mode")) {
        var s = document.createElement("style");
        s.id = "__ht_dark_mode";
        s.textContent = ${JSON.stringify(DARK_MODE_CSS)};
        document.head.appendChild(s);
      }
    `);
  } else {
    view.webviewEl.executeJavascript(`
      var el = document.getElementById("__ht_dark_mode");
      if (el) el.remove();
    `);
  }
}
