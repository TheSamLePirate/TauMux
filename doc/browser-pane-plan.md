# Browser Pane — Full Implementation Plan

> Add built-in browser panes to HyperTerm Canvas, with the same level of integration as cmux's WKWebView browser: split alongside terminals, address bar, navigation, history, scriptable API, and CLI control.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. ✅ [Phase 1 — Shared Types & Data Model](#2-phase-1--shared-types--data-model)
3. ✅ [Phase 2 — Bun-Side Browser Surface Manager](#3-phase-2--bun-side-browser-surface-manager)
4. ✅ [Phase 3 — Webview-Side Browser Pane Renderer](#4-phase-3--webview-side-browser-pane-renderer)
5. ✅ [Phase 4 — Keyboard & Focus Architecture](#5-phase-4--keyboard--focus-architecture)
6. ✅ [Phase 5 — Address Bar & Navigation UI](#6-phase-5--address-bar--navigation-ui)
7. ✅ [Phase 6 — RPC Bridge (Bun ↔ Webview)](#7-phase-6--rpc-bridge-bun--webview)
8. ✅ [Phase 7 — History, Search & Autocomplete](#8-phase-7--history-search--autocomplete)
9. ✅ [Phase 8 — Layout Persistence & Restore](#9-phase-8--layout-persistence--restore)
10. ✅ [Phase 9 — Sidebar & Chip Integration](#10-phase-9--sidebar--chip-integration)
11. ✅ [Phase 10 — Settings Integration](#11-phase-10--settings-integration)
12. ✅ [Phase 11 — Socket API & `ht` CLI](#12-phase-11--socket-api--ht-cli)
13. ✅ [Phase 12 — Security & Navigation Rules](#13-phase-12--security--navigation-rules)
14. ✅ [Phase 13 — Scriptable API (Agent Automation)](#14-phase-13--scriptable-api-agent-automation)
15. ✅ [Phase 14 — Web Mirror Integration](#15-phase-14--web-mirror-integration)
16. ✅ [Phase 15 — Polish & Edge Cases](#16-phase-15--polish--edge-cases)

---

## Implementation Status

**All 15 phases complete.** ✅

| Metric | Value |
|---|---|
| Tests | **220 pass, 0 fail** (was 161 before, +59 new) |
| New test files | 4 (browser-surface-manager, browser-history, url-helpers, rpc-handler-browser) |
| Typecheck | Clean (`tsc --noEmit` = 0 errors) |
| App launch | Verified via `bun start` — terminal works, no crashes |

### Phase 2 Additions (cmux-parity browser automation)

Added full cmux-style browser automation API:

| Category | Commands Added |
|---|---|
| **DOM Interaction** | click, dblclick, hover, focus, check, uncheck, scroll-into-view, type, fill, press, select, scroll, highlight |
| **Waiting** | wait (--selector, --text, --url-contains, --load-state, --function, --timeout-ms) |
| **Inspection** | get (title, url, text, html, value, attr, count, box, styles), is (visible, enabled, checked) |
| **Script/Style Injection** | addscript, addstyle |
| **Console & Errors** | console list/clear, errors list/clear (captured via preload) |
| **Unified CLI** | `ht browser [surface] <subcommand>` (cmux-compatible syntax) |
| **Identify** | browser identify (surface metadata) |
| **Snapshot** | Accessibility tree snapshot with element refs |
17. [File Change Matrix](#17-file-change-matrix)
18. [Risk Register](#18-risk-register)
19. [Testing Plan](#19-testing-plan)

---

## 1. Architecture Overview

### How cmux does it

cmux is native Swift/AppKit. Each browser pane is a real `WKWebView` instance managed directly by Swift code. It has unfettered access to WebKit internals: `WKProcessPool` for cookie sharing, `WKWebViewConfiguration` for content appearance (dark mode), `WKUIDelegate` for dialog handling, the accessibility tree API for agent snapshots.

### How HyperTerm Canvas will do it

HyperTerm Canvas runs inside an Electrobun `BrowserWindow`. The terminal UI is itself a webview (`views://terminal/index.html`). Browser panes will use **Electrobun's `<electrobun-webview>` custom element** — an OOPIF (Out-Of-Process IFrame) that:

- Runs in a fully isolated process (crash isolation, memory isolation)
- Supports loading any URL (http, https, local files)
- Provides navigation APIs (`loadURL`, `goBack`, `goForward`, `reload`)
- Emits events (`did-navigate`, `will-navigate`, `dom-ready`, `new-window-open`, `host-message`)
- Supports `executeJavascript()` for JS injection
- Supports `findInPage()` / `stopFindInPage()`
- Supports `openDevTools()` / `toggleDevTools()`
- Supports `setNavigationRules()` for URL allow/block lists
- Supports `preload` scripts for hooking console, intercepting events
- Supports `sandbox` mode for untrusted content
- Supports `partition` for shared/isolated cookie sessions
- Emits download events (`download-started`, `download-progress`, `download-completed`)
- Communicates back to the host via `host-message` + `__electrobunSendToHost()`

### Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│  Electrobun BrowserWindow (main app window)         │
│  ┌───────────────────────────────────────────────┐  │
│  │  Webview: views://terminal/index.html         │  │
│  │  ┌─────────────────┐ ┌─────────────────────┐ │  │
│  │  │ Terminal Pane    │ │ Browser Pane         │ │  │
│  │  │ ┌─────────────┐ │ │ ┌─────────────────┐ │ │  │
│  │  │ │ xterm.js    │ │ │ │ Address Bar      │ │ │  │
│  │  │ │             │ │ │ ├─────────────────┤ │ │  │
│  │  │ │             │ │ │ │<electrobun-     │ │ │  │
│  │  │ │             │ │ │ │ webview>        │ │ │  │
│  │  │ │             │ │ │ │ (OOPIF process) │ │ │  │
│  │  │ └─────────────┘ │ │ └─────────────────┘ │ │  │
│  │  └─────────────────┘ └─────────────────────┘ │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Bun Main Process                                   │
│  ├── SessionManager (terminal PTYs)                 │
│  ├── BrowserSurfaceManager (browser state, no PTY)  │
│  ├── BrowserHistoryStore (JSON persistence)         │
│  ├── RPC Handler (browser.* methods)                │
│  └── Socket Server (ht CLI bridge)                  │
└─────────────────────────────────────────────────────┘
```

### Key design decision: surface type branching

Currently every `PaneLeaf` is implicitly a terminal. We introduce an optional `surfaceType` field on `PaneLeaf`:

```typescript
export interface PaneLeaf {
  type: "leaf";
  surfaceId: string;
  surfaceType?: "terminal" | "browser";  // default: "terminal"
}
```

The `SurfaceManager` on the webview side will branch on `surfaceType` in `createSurfaceView()` to build either a terminal container (xterm.js) or a browser container (`<electrobun-webview>` + address bar).

The bun-side `SessionManager` continues to manage only terminal surfaces. A new `BrowserSurfaceManager` handles browser-only state (current URL, title, navigation history, zoom level). Browser surfaces have **no PTY, no sideband channels, no process tree**.

---

## 2. Phase 1 — Shared Types & Data Model

### File: `src/shared/types.ts`

#### 2.1 Extend `PaneLeaf`

```typescript
export interface PaneLeaf {
  type: "leaf";
  surfaceId: string;
  /** Surface kind. Omitted or "terminal" = terminal PTY pane.
   *  "browser" = embedded web browser pane. */
  surfaceType?: "terminal" | "browser";
}
```

#### 2.2 Add `BrowserSurfaceState`

```typescript
/** Bun-side state for a browser surface (no PTY). */
export interface BrowserSurfaceState {
  id: string;
  url: string;
  title: string;
  /** Page zoom level (1.0 = 100%). */
  zoom: number;
  /** Whether the webview is in sandbox mode. */
  sandboxed: boolean;
  /** Partition name for cookie/session isolation. */
  partition: string;
}
```

#### 2.3 Add browser RPC messages

Add to `HyperTermRPC.bun.messages` (webview → bun):

```typescript
// Browser surface lifecycle
createBrowserSurface: { url?: string };
splitBrowserSurface: {
  direction: "horizontal" | "vertical";
  url?: string;
};
closeBrowserSurface: { surfaceId: string };

// Browser navigation (webview → bun for state tracking)
browserNavigated: { surfaceId: string; url: string; title: string };
browserTitleChanged: { surfaceId: string; title: string };

// Browser requests (webview → bun for features needing bun-side API)
browserSetZoom: { surfaceId: string; zoom: number };
```

Add to `HyperTermRPC.webview.messages` (bun → webview):

```typescript
// Browser surface lifecycle
browserSurfaceCreated: {
  surfaceId: string;
  url: string;
  splitFrom?: string;
  direction?: "horizontal" | "vertical";
};

// Browser commands (bun → webview, triggered by socket API / CLI)
browserNavigateTo: { surfaceId: string; url: string };
browserGoBack: { surfaceId: string };
browserGoForward: { surfaceId: string };
browserReload: { surfaceId: string };
browserEvalJs: { surfaceId: string; script: string; reqId?: string };
browserFindInPage: { surfaceId: string; query: string; forward?: boolean };
browserStopFind: { surfaceId: string };
browserToggleDevTools: { surfaceId: string };

// Browser state pushed from bun → webview (e.g. after CLI sets zoom)
browserSetZoomLevel: { surfaceId: string; zoom: number };
```

#### 2.4 Extend `PersistedWorkspace`

```typescript
export interface PersistedWorkspace {
  // ... existing fields ...
  /** Persisted URL per browser surface id for restore. */
  surfaceUrls?: Record<string, string>;
  /** Persisted surface type per surface id (only stored for "browser"). */
  surfaceTypes?: Record<string, "terminal" | "browser">;
}
```

#### 2.5 Extend `WorkspaceSnapshot` (in rpc-handler.ts)

```typescript
export interface WorkspaceSnapshot {
  // ... existing fields ...
  surfaceUrls?: Record<string, string>;
  surfaceTypes?: Record<string, "terminal" | "browser">;
}
```

---

## 3. Phase 2 — Bun-Side Browser Surface Manager

### New file: `src/bun/browser-surface-manager.ts`

A lightweight manager for browser-type surfaces. **No PTY, no sideband, no process tree.** It only tracks:

- Surface ID
- Current URL
- Page title
- Zoom level
- Partition
- Navigation history (back/forward stacks of URLs)

```typescript
export interface BrowserSurface {
  id: string;
  url: string;
  title: string;
  zoom: number;
  partition: string;
  backHistory: string[];
  forwardHistory: string[];
}

export class BrowserSurfaceManager {
  private surfaces = new Map<string, BrowserSurface>();
  private counter = 0;

  createSurface(url?: string, partition?: string): string {
    const id = `browser:${++this.counter}`;
    this.surfaces.set(id, {
      id,
      url: url || "about:blank",
      title: "New Tab",
      zoom: 1.0,
      partition: partition || "persist:browser-shared",
      backHistory: [],
      forwardHistory: [],
    });
    return id;
  }

  updateNavigation(id: string, url: string, title: string): void { ... }
  setZoom(id: string, zoom: number): void { ... }
  getSurface(id: string): BrowserSurface | undefined { ... }
  getAllSurfaces(): BrowserSurface[] { ... }
  closeSurface(id: string): void { ... }
  get surfaceCount(): number { ... }
  destroy(): void { ... }
}
```

### Integration in `src/bun/index.ts`

- Import and instantiate `BrowserSurfaceManager` alongside `SessionManager`
- The combined surface count drives the "close last window" logic:
  ```typescript
  if (sessions.surfaceCount + browserSurfaces.surfaceCount === 0) {
    mainWindow.close();
  }
  ```
- Wire `browserSurfaces.onClosed` callback to emit `surfaceClosed` RPC message (same as terminal)
- Register all new RPC message handlers for browser surface lifecycle

### Modify `src/bun/index.ts` — new handlers

```typescript
// In rpc message handlers:
createBrowserSurface: (payload) => {
  createBrowserWorkspaceSurface(payload.url);
},
splitBrowserSurface: (payload) => {
  splitBrowserSurface(payload.direction, payload.url);
},
closeBrowserSurface: (payload) => {
  browserSurfaces.closeSurface(payload.surfaceId);
  // emit surfaceClosed for the webview
},
browserNavigated: (payload) => {
  browserSurfaces.updateNavigation(
    payload.surfaceId, payload.url, payload.title
  );
  // Update web mirror
},
browserTitleChanged: (payload) => {
  browserSurfaces.getSurface(payload.surfaceId)!.title = payload.title;
},
browserSetZoom: (payload) => {
  browserSurfaces.setZoom(payload.surfaceId, payload.zoom);
},
```

### New helper functions

```typescript
function createBrowserWorkspaceSurface(url?: string): void {
  const surfaceId = browserSurfaces.createSurface(url);
  focusedSurfaceId = surfaceId;
  rpc.send("browserSurfaceCreated", { surfaceId, url: url || "about:blank" });
}

function splitBrowserSurface(
  direction: "horizontal" | "vertical",
  url?: string,
): void {
  if (!focusedSurfaceId) {
    createBrowserWorkspaceSurface(url);
    return;
  }
  const surfaceId = browserSurfaces.createSurface(url);
  focusedSurfaceId = surfaceId;
  rpc.send("browserSurfaceCreated", {
    surfaceId,
    url: url || "about:blank",
    splitFrom: focusedSurfaceId,
    direction,
  });
}
```

---

## 4. Phase 3 — Webview-Side Browser Pane Renderer

### New file: `src/views/terminal/browser-pane.ts`

This file contains the DOM construction and event wiring for a single browser pane. It replaces what xterm.js + TerminalEffects + PanelManager do for terminal panes.

```typescript
export interface BrowserPaneView {
  id: string;
  surfaceType: "browser";
  container: HTMLDivElement;
  webviewEl: WebviewTagElement;   // <electrobun-webview>
  addressBar: HTMLInputElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
  currentUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  backBtn: HTMLButtonElement;
  forwardBtn: HTMLButtonElement;
  reloadBtn: HTMLButtonElement;
  lockIcon: HTMLSpanElement;
}

export function createBrowserPaneView(
  surfaceId: string,
  initialUrl: string,
  callbacks: {
    onNavigated: (surfaceId: string, url: string, title: string) => void;
    onTitleChanged: (surfaceId: string, title: string) => void;
    onNewWindow: (surfaceId: string, url: string) => void;
    onFocus: (surfaceId: string) => void;
    onClose: (surfaceId: string) => void;
    onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => void;
  },
): BrowserPaneView { ... }
```

#### DOM Structure

```html
<div class="surface-container surface-browser" data-surface-id="browser:1">
  <!-- Shared surface bar (same pattern as terminal) -->
  <div class="surface-bar">
    <div class="surface-bar-title-wrap">
      <span class="surface-bar-icon">🌐</span>
      <span class="surface-bar-title">New Tab</span>
    </div>
    <div class="surface-bar-chips"></div>
    <div class="surface-bar-actions">
      <!-- info, split-right, split-down, close buttons -->
    </div>
  </div>

  <!-- Browser-specific: address bar -->
  <div class="browser-address-bar">
    <button class="browser-nav-btn browser-back-btn" disabled>◀</button>
    <button class="browser-nav-btn browser-forward-btn" disabled>▶</button>
    <button class="browser-nav-btn browser-reload-btn">↻</button>
    <span class="browser-lock-icon">🔒</span>
    <input class="browser-url-input"
           type="text"
           placeholder="Search or enter URL"
           spellcheck="false"
           autocomplete="off" />
    <button class="browser-nav-btn browser-devtools-btn" title="DevTools (⌥⌘I)">
      🛠
    </button>
  </div>

  <!-- The actual embedded browser -->
  <div class="browser-webview-container">
    <electrobun-webview
      src="about:blank"
      partition="persist:browser-shared"
      sandbox
    ></electrobun-webview>
  </div>
</div>
```

#### Event Wiring (inside `createBrowserPaneView`)

```typescript
// Navigation events from the embedded webview
webviewEl.on("did-navigate", (e) => {
  const url = typeof e.detail === "string" ? e.detail : e.detail?.url ?? "";
  view.currentUrl = url;
  addressBar.value = url;
  updateLockIcon(url);
  updateBackForwardState();
  // Extract title via JS injection after page loads
  webviewEl.executeJavascript(`
    window.__electrobunSendToHost({
      type: "title",
      title: document.title
    });
  `);
  callbacks.onNavigated(surfaceId, url, view.title);
});

webviewEl.on("dom-ready", () => {
  // Inject preload for title tracking and console capture
  webviewEl.executeJavascript(`
    new MutationObserver(() => {
      window.__electrobunSendToHost({
        type: "title",
        title: document.title
      });
    }).observe(
      document.querySelector('title') || document.head,
      { childList: true, subtree: true, characterData: true }
    );
  `);
});

webviewEl.on("host-message", (e) => {
  const msg = e.detail;
  if (msg?.type === "title") {
    view.title = msg.title || view.currentUrl;
    titleEl.textContent = view.title;
    callbacks.onTitleChanged(surfaceId, view.title);
  }
  if (msg?.type === "console") {
    // Future: forward to a console panel or sidebar log
  }
});

webviewEl.on("new-window-open", (e) => {
  const url = typeof e.detail === "string"
    ? e.detail
    : e.detail?.url ?? "";
  callbacks.onNewWindow(surfaceId, url);
});

// Address bar: Enter to navigate
addressBar.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const input = addressBar.value.trim();
    if (input) navigateTo(input);
  }
  if (e.key === "Escape") {
    e.preventDefault();
    addressBar.value = view.currentUrl;
    addressBar.blur();
  }
});

// Navigation buttons
backBtn.addEventListener("click", () => webviewEl.goBack());
forwardBtn.addEventListener("click", () => webviewEl.goForward());
reloadBtn.addEventListener("click", () => webviewEl.reload());

function navigateTo(input: string) {
  const url = isUrl(input) ? normalizeUrl(input) : buildSearchUrl(input);
  webviewEl.loadURL(url);
}
```

#### URL helpers (in same file or a shared util)

```typescript
function isUrl(input: string): boolean {
  if (/^https?:\/\//i.test(input)) return true;
  if (/^localhost(:\d+)?/.test(input)) return true;
  if (/^[\w-]+(\.[\w-]+)+/.test(input)) return true; // domain-like
  return false;
}

function normalizeUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

function buildSearchUrl(query: string, engine = "google"): string {
  const engines: Record<string, string> = {
    google: "https://www.google.com/search?q=",
    duckduckgo: "https://duckduckgo.com/?q=",
    bing: "https://www.bing.com/search?q=",
    kagi: "https://kagi.com/search?q=",
  };
  return (engines[engine] || engines.google) + encodeURIComponent(query);
}
```

---

## 5. Phase 4 — Keyboard & Focus Architecture

### The problem

The project constraint says: *"Keyboard never goes to panels or chips. All keystrokes go to xterm.js → stdin."*

A browser pane **must** receive keyboard input for typing in web forms, scrolling, etc. This requires a clear exception to the rule.

### The solution: surface-type-aware focus

#### 5.1 Focus state tracking in `SurfaceManager`

```typescript
interface SurfaceView {
  id: string;
  surfaceType: "terminal" | "browser";
  // terminal-specific fields (optional)
  term?: Terminal;
  fitAddon?: FitAddon;
  // browser-specific fields (optional)
  browserView?: BrowserPaneView;
  // shared fields
  container: HTMLDivElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
}
```

When `focusSurface(id)` is called:
- If the surface is a **terminal** → `view.term.focus()` (existing behavior)
- If the surface is a **browser** → `view.browserView.webviewEl.focus()` + `view.browserView.webviewEl.togglePassthrough(false)` to let it receive input

#### 5.2 Keyboard handler changes in `src/views/terminal/index.ts`

The global `document.addEventListener("keydown", ...)` handler needs to know the focused surface type:

```typescript
document.addEventListener("keydown", (e) => {
  const activeSurfaceType = surfaceManager.getActiveSurfaceType();

  // Global shortcuts (work regardless of surface type)
  if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "p") { ... } // palette
  if (e.metaKey && e.key === ",") { ... }                             // settings
  if (e.metaKey && e.key === "b") { ... }                             // sidebar
  if (e.metaKey && e.key === "n") { ... }                             // new workspace
  if (e.metaKey && e.altKey) { ... }                                  // focus direction
  if (e.ctrlKey && e.metaKey) { ... }                                 // workspace nav
  if (e.metaKey && e.key >= "1" && e.key <= "9") { ... }              // workspace jump

  // Browser-specific shortcuts (only when browser pane focused)
  if (activeSurfaceType === "browser") {
    if (e.metaKey && e.key === "l") {
      e.preventDefault();
      surfaceManager.focusBrowserAddressBar();
      return;
    }
    if (e.metaKey && e.key === "[") {
      e.preventDefault();
      surfaceManager.browserGoBack();
      return;
    }
    if (e.metaKey && e.key === "]") {
      e.preventDefault();
      surfaceManager.browserGoForward();
      return;
    }
    if (e.metaKey && e.key === "r") {
      e.preventDefault();
      surfaceManager.browserReload();
      return;
    }
    if (e.metaKey && e.altKey && e.key.toLowerCase() === "i") {
      e.preventDefault();
      surfaceManager.browserToggleDevTools();
      return;
    }
    if (e.metaKey && e.key === "f") {
      e.preventDefault();
      surfaceManager.browserFindInPage();
      return;
    }
    // Font zoom for browser
    if (e.metaKey && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      surfaceManager.browserZoomIn();
      return;
    }
    if (e.metaKey && e.key === "-") {
      e.preventDefault();
      surfaceManager.browserZoomOut();
      return;
    }
    if (e.metaKey && e.key === "0") {
      e.preventDefault();
      surfaceManager.browserZoomReset();
      return;
    }
    // Don't capture other keys — let them flow to the webview
    return;
  }

  // Terminal-specific shortcuts (existing code, unchanged)
  if (e.metaKey && e.key === "d") { requestSplit("horizontal"); ... }
  if (e.metaKey && e.key === "f") { surfaceManager.toggleSearchBar(); ... }
  // ... etc
});
```

#### 5.3 New shortcut: ⌘⇧L — Open browser split

```typescript
if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "l") {
  e.preventDefault();
  rpc.send("splitBrowserSurface", { direction: "horizontal" });
  return;
}
```

#### 5.4 Typing focus mode

The existing `setTypingFocusMode()` / `clearTypingFocusMode()` only triggers when `isTerminalInputActive()`. For browser panes, we don't set typing focus mode (the body class drives UI chrome hiding, which should happen for both terminal and browser when the user is interacting with the pane content).

---

## 6. Phase 5 — Address Bar & Navigation UI

### 6.1 Address bar features

| Feature | Implementation |
|---|---|
| **URL display** | Updates on every `did-navigate` event |
| **URL editing** | Standard `<input>` — Enter to navigate, Escape to revert |
| **Smart URL detection** | `isUrl()` check; non-URLs go to search engine |
| **Lock icon** | 🔒 for https, ⚠️ for http, blank for about: |
| **Back / Forward** | Buttons update enabled/disabled state via `canGoBack()` / `canGoForward()` |
| **Reload** | Click or ⌘R |
| **Loading indicator** | Spinner animation on the reload button between `will-navigate` and `dom-ready` |
| **Select all on focus** | `addressBar.addEventListener("focus", () => addressBar.select())` |
| **⌘L focuses address bar** | `surfaceManager.focusBrowserAddressBar()` |

### 6.2 Address bar autocomplete (Phase 7 — deferred)

The autocomplete dropdown draws from browser history. It's a floating `<div>` positioned below the input with filtered suggestions. Keyboard navigation: Up/Down to select, Enter to navigate, Escape to dismiss.

### 6.3 Loading state

```typescript
let isLoading = false;

webviewEl.on("will-navigate", () => {
  isLoading = true;
  reloadBtn.classList.add("loading");
  // Optionally swap icon to ✕ (stop)
});

webviewEl.on("dom-ready", () => {
  isLoading = false;
  reloadBtn.classList.remove("loading");
});

// Clicking reload while loading = stop (reload acts as stop)
reloadBtn.addEventListener("click", () => {
  if (isLoading) {
    webviewEl.loadURL(view.currentUrl); // stop by reloading same URL
  } else {
    webviewEl.reload();
  }
});
```

---

## 7. Phase 6 — RPC Bridge (Bun ↔ Webview)

### What happens where

| Action | Initiated by | Flows through |
|---|---|---|
| User clicks Back button | Webview DOM → `webviewEl.goBack()` | Direct Electrobun webview tag call |
| User types URL + Enter | Webview DOM → `webviewEl.loadURL(url)` | Direct + notify bun via `browserNavigated` |
| CLI `ht browser navigate` | Socket → bun → `rpc.send("browserNavigateTo", ...)` → webview → `webviewEl.loadURL()` | Full round-trip |
| Page title changes | Webview OOPIF → `host-message` → webview DOM → `rpc.send("browserTitleChanged", ...)` → bun | Forward to bun for state |
| Page navigates | Webview OOPIF → `did-navigate` → webview DOM → `rpc.send("browserNavigated", ...)` → bun | Forward to bun for history |

### Key principle

**Navigation controls** (back, forward, reload, loadURL, find, devtools) are called **directly on the `<electrobun-webview>` element** in the webview DOM. No round-trip through bun needed for user-initiated actions.

**State tracking** (URL, title, zoom) is **forwarded to bun** via RPC so the socket API / CLI / persistence / web mirror can use it.

**CLI-initiated actions** go bun → webview RPC → DOM → `<electrobun-webview>` method.

### Modifications to `src/bun/index.ts`

Handle incoming browser RPC messages, and dispatch socket-initiated browser commands:

```typescript
// Socket API → webview (bun forwards to webview)
function browserDispatch(action: string, payload: Record<string, unknown>) {
  rpc.send("socketAction", { action: `browser.${action}`, payload });
}
```

### Modifications to `src/views/terminal/index.ts`

In the `handleSocketAction` switch, add browser-related cases:

```typescript
case "browser.navigateTo": {
  const id = payload["surfaceId"] as string;
  const url = payload["url"] as string;
  surfaceManager.browserNavigateTo(id, url);
  break;
}
case "browser.goBack":
  surfaceManager.browserGoBack(payload["surfaceId"] as string);
  break;
case "browser.goForward":
  surfaceManager.browserGoForward(payload["surfaceId"] as string);
  break;
case "browser.reload":
  surfaceManager.browserReload(payload["surfaceId"] as string);
  break;
case "browser.evalJs": {
  surfaceManager.browserEvalJs(
    payload["surfaceId"] as string,
    payload["script"] as string,
  );
  break;
}
// ... etc
```

---

## 8. Phase 7 — History, Search & Autocomplete

### 8.1 Browser history store

#### New file: `src/bun/browser-history.ts`

```typescript
export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  lastVisited: number;  // epoch ms
}

export class BrowserHistoryStore {
  private entries = new Map<string, BrowserHistoryEntry>();
  private filePath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(configDir: string) {
    this.filePath = join(configDir, "browser-history.json");
    this.load();
  }

  record(url: string, title: string): void {
    const key = this.normalizeUrl(url);
    const existing = this.entries.get(key);
    if (existing) {
      existing.visitCount++;
      existing.lastVisited = Date.now();
      existing.title = title || existing.title;
    } else {
      this.entries.set(key, {
        url: key,
        title: title || url,
        visitCount: 1,
        lastVisited: Date.now(),
      });
    }
    this.scheduleSave();
  }

  /** Return matches sorted by relevance (visit count * recency). */
  search(query: string, limit = 10): BrowserHistoryEntry[] { ... }

  clear(): void { ... }

  private normalizeUrl(url: string): string {
    // Strip trailing slash, www prefix, protocol for dedup
    return url.replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");
  }

  private load(): void { ... }
  private save(): void { ... }
  private scheduleSave(): void { ... }
}
```

### 8.2 Address bar autocomplete

When the user types in the address bar, the webview sends a lightweight RPC to bun:

```typescript
// Not needed — history search can be done client-side.
// Ship the history to the webview on browser pane creation and
// keep it in memory. OR do a round-trip via RPC request.
```

**Simpler approach**: Since the history is JSON and not huge (<10K entries), we send the full history to the webview on settings init or on-demand. The webview runs the fuzzy search in JS.

Alternatively, add an RPC request:

```typescript
// In HyperTermRPC.bun.requests:
browserHistorySearch: {
  params: { query: string; limit?: number };
  response: BrowserHistoryEntry[];
};
```

### 8.3 Search engine configuration

Add to `AppSettings` in `src/shared/settings.ts`:

```typescript
export interface AppSettings {
  // ... existing ...
  /** Search engine for browser address bar non-URL queries. */
  browserSearchEngine: "google" | "duckduckgo" | "bing" | "kagi";
  /** Whether to show search suggestions in the address bar. */
  browserSearchSuggestions: boolean;
}

// DEFAULT_SETTINGS:
browserSearchEngine: "google",
browserSearchSuggestions: true,
```

---

## 9. Phase 8 — Layout Persistence & Restore

### 9.1 Save

The `workspaceStateSync` RPC message already sends the full workspace state to bun. We extend it:

In `SurfaceManager.getWorkspaceState()`, for each surface in a workspace, check if it's a browser surface. If so, include its URL in `surfaceUrls` and its type in `surfaceTypes`.

```typescript
// In getWorkspaceState():
const surfaceUrls: Record<string, string> = {};
const surfaceTypes: Record<string, "terminal" | "browser"> = {};
for (const sid of surfaceIds) {
  const view = this.surfaces.get(sid);
  if (view?.surfaceType === "browser") {
    surfaceTypes[sid] = "browser";
    surfaceUrls[sid] = view.browserView?.currentUrl ?? "about:blank";
  }
}
```

The `PersistedLayout` on disk now includes `surfaceUrls` and `surfaceTypes`.

### 9.2 Restore

In `tryRestoreLayout()` in `src/bun/index.ts`:

```typescript
for (const oldId of leafIds) {
  const isBrowser = ws.surfaceTypes?.[oldId] === "browser";
  if (isBrowser) {
    const url = ws.surfaceUrls?.[oldId] ?? "about:blank";
    const newId = browserSurfaces.createSurface(url);
    surfaceMapping[oldId] = newId;
    rpc.send("browserSurfaceCreated", { surfaceId: newId, url });
  } else {
    const cwd = ws.surfaceCwds?.[oldId];
    const newId = sessions.createSurface(cols, rows, cwd);
    surfaceMapping[oldId] = newId;
    // ... existing terminal restore logic
  }
}
```

In the webview's `SurfaceManager.restoreLayout()`:
- For each leaf, check if there's a `surfaceType === "browser"` in the workspace data
- Create the appropriate view type (terminal or browser)

---

## 10. Phase 9 — Sidebar & Chip Integration

### 10.1 Pane header chip for browser surfaces

For terminal surfaces, `renderSurfaceChips()` shows cwd, ports, foreground command, git info. For browser surfaces, show:

- **Domain chip**: e.g. `🌐 github.com` — extracted from the URL
- **Title chip**: page title, truncated

```typescript
function renderBrowserChips(chipsEl: HTMLDivElement, url: string, title: string) {
  chipsEl.innerHTML = "";
  try {
    const hostname = new URL(url).hostname;
    const domainChip = document.createElement("span");
    domainChip.className = "surface-chip chip-domain";
    domainChip.textContent = `🌐 ${hostname}`;
    chipsEl.appendChild(domainChip);
  } catch { /* invalid URL */ }
}
```

### 10.2 Sidebar workspace info

The sidebar currently shows foreground command, ports, cwd for the focused surface. For a browser surface that's focused:

- Show `🌐 browsing` as the "foreground command"
- Show the domain as the "cwd"
- No ports, no git info

This requires the sidebar to know the focused surface's type. Extend `SurfaceManager.updateSidebar()` to pass browser surface info.

### 10.3 Pane bar icon

Terminal panes show a terminal icon (▸) in the bar. Browser panes show a globe icon (🌐). Change the icon in `createSurfaceView` based on type.

---

## 11. Phase 10 — Settings Integration

### File: `src/shared/settings.ts`

Add new fields:

```typescript
export interface AppSettings {
  // ... existing ...

  // ── Browser ──
  /** Search engine for the browser address bar. */
  browserSearchEngine: "google" | "duckduckgo" | "bing" | "kagi";
  /** Default page when opening a new browser pane. */
  browserHomePage: string;
  /** Force dark mode on web pages. */
  browserForceDarkMode: boolean;
  /** Open terminal URL clicks in the built-in browser instead of externally. */
  browserInterceptTerminalLinks: boolean;
  /** Hosts allowed to open in the built-in browser (empty = all). */
  browserHostWhitelist: string[];
  /** Additional hosts allowed for insecure HTTP. */
  browserInsecureAllowlist: string[];
}
```

Default values:

```typescript
browserSearchEngine: "google",
browserHomePage: "about:blank",
browserForceDarkMode: false,
browserInterceptTerminalLinks: false,
browserHostWhitelist: [],
browserInsecureAllowlist: [],
```

### File: `src/views/terminal/settings-panel.ts`

Add a **"Browser"** section in the settings panel:

- **Search Engine**: dropdown (Google, DuckDuckGo, Bing, Kagi)
- **Home Page**: text input
- **Force Dark Mode**: toggle
- **Intercept Terminal Links**: toggle
- **Host Whitelist**: textarea (one per line)
- **Insecure HTTP Allowlist**: textarea
- **Clear Browser History**: button (sends RPC to bun)

### File: `src/views/terminal/surface-manager.ts`

In `applySettings()`, pass browser-relevant settings to browser pane views:

```typescript
// In applySettings():
for (const view of this.surfaces.values()) {
  if (view.surfaceType === "browser" && view.browserView) {
    // Apply dark mode CSS injection
    if (s.browserForceDarkMode) {
      view.browserView.webviewEl.executeJavascript(`
        document.documentElement.style.colorScheme = "dark";
      `);
    }
  }
}
```

---

## 12. Phase 11 — Socket API & `ht` CLI

### 12.1 New RPC methods in `src/bun/rpc-handler.ts`

```typescript
// ── Browser ──

"browser.list": () => {
  return browserSurfaces.getAllSurfaces().map((s) => ({
    id: s.id,
    url: s.url,
    title: s.title,
    zoom: s.zoom,
  }));
},

"browser.open": (params) => {
  const url = params["url"] as string | undefined;
  dispatch("createBrowserSurface", { url });
  return "OK";
},

"browser.open_split": (params) => {
  const url = params["url"] as string | undefined;
  const direction = (params["direction"] as string) === "down"
    ? "vertical" : "horizontal";
  dispatch("splitBrowserSurface", { direction, url });
  return "OK";
},

"browser.navigate": (params) => {
  const id = params["surface_id"] as string ??
    params["surface"] as string;
  const url = params["url"] as string;
  if (id && url) dispatch("browser.navigateTo", { surfaceId: id, url });
  return "OK";
},

"browser.back": (params) => {
  const id = params["surface_id"] as string ?? params["surface"] as string;
  if (id) dispatch("browser.goBack", { surfaceId: id });
  return "OK";
},

"browser.forward": (params) => {
  const id = params["surface_id"] as string ?? params["surface"] as string;
  if (id) dispatch("browser.goForward", { surfaceId: id });
  return "OK";
},

"browser.reload": (params) => {
  const id = params["surface_id"] as string ?? params["surface"] as string;
  if (id) dispatch("browser.reload", { surfaceId: id });
  return "OK";
},

"browser.url": (params) => {
  const id = params["surface_id"] as string ?? params["surface"] as string;
  if (!id) return null;
  return browserSurfaces.getSurface(id)?.url ?? null;
},

"browser.eval": (params) => {
  const id = params["surface_id"] as string ?? params["surface"] as string;
  const script = params["script"] as string;
  if (id && script) dispatch("browser.evalJs", { surfaceId: id, script });
  return "OK";
},

"browser.find": (params) => {
  const id = params["surface_id"] as string ?? params["surface"] as string;
  const query = params["query"] as string;
  if (id && query) dispatch("browser.findInPage", { surfaceId: id, query });
  return "OK";
},

"browser.devtools": (params) => {
  const id = params["surface_id"] as string ?? params["surface"] as string;
  if (id) dispatch("browser.toggleDevTools", { surfaceId: id });
  return "OK";
},

"browser.snapshot": async (params) => {
  // Inject accessibility snapshot script and collect via RPC
  const id = params["surface_id"] as string ?? params["surface"] as string;
  if (!id) throw new Error("surface_id required");
  // Fire-and-forget: inject snapshot collector, result comes back via
  // a pending-reads style mechanism
  dispatch("browser.evalJs", {
    surfaceId: id,
    script: ACCESSIBILITY_SNAPSHOT_SCRIPT,
    reqId: `snapshot:${Date.now()}`,
  });
  // TODO: wait for response via pending reads
  return "OK (snapshot dispatched)";
},

"browser.history": () => {
  return browserHistory.search("", 100);
},

"browser.clear_history": () => {
  browserHistory.clear();
  return "OK";
},
```

### 12.2 CLI commands in `bin/ht`

```typescript
// In mapCommand():

case "browser":
case "browser-open":
  return {
    method: "browser.open",
    params: { url: positional[0] },
  };

case "browser-split":
  return {
    method: "browser.open_split",
    params: {
      url: positional[0],
      direction: flags["direction"] || "right",
    },
  };

case "browser-navigate":
  return {
    method: "browser.navigate",
    params: {
      surface_id: flags["surface"] || positional[0],
      url: positional[1] || flags["url"],
    },
  };

case "browser-back":
  return {
    method: "browser.back",
    params: { surface_id: flags["surface"] },
  };

case "browser-forward":
  return {
    method: "browser.forward",
    params: { surface_id: flags["surface"] },
  };

case "browser-reload":
  return {
    method: "browser.reload",
    params: { surface_id: flags["surface"] },
  };

case "browser-url":
  return {
    method: "browser.url",
    params: { surface_id: flags["surface"] },
  };

case "browser-eval":
  return {
    method: "browser.eval",
    params: {
      surface_id: flags["surface"],
      script: positional[0],
    },
  };

case "browser-find":
  return {
    method: "browser.find",
    params: {
      surface_id: flags["surface"],
      query: positional[0],
    },
  };

case "browser-devtools":
  return {
    method: "browser.devtools",
    params: { surface_id: flags["surface"] },
  };

case "browser-snapshot":
  return {
    method: "browser.snapshot",
    params: { surface_id: flags["surface"] },
  };

case "browser-history":
  return { method: "browser.history", params: {} };

case "browser-clear-history":
  return { method: "browser.clear_history", params: {} };

case "list-browsers":
  return { method: "browser.list", params: {} };
```

### 12.3 Help text update

Add browser section to `printHelp()`:

```
Browser:
  ht browser-open [url]              Open browser in new workspace
  ht browser-split [url]             Split browser alongside current pane
  ht browser-navigate <url>          Navigate browser surface to URL
  ht browser-back                    Go back
  ht browser-forward                 Go forward
  ht browser-reload                  Reload page
  ht browser-url                     Get current URL
  ht browser-eval <script>           Execute JavaScript
  ht browser-find <query>            Find text in page
  ht browser-devtools                Toggle developer tools
  ht browser-snapshot                Capture accessibility snapshot
  ht browser-history                 List browser history
  ht browser-clear-history           Clear browser history
  ht list-browsers                   List all browser surfaces
```

---

## 13. Phase 12 — Security & Navigation Rules

### 13.1 Sandbox mode

All browser panes use `sandbox` attribute by default. This disables RPC between the loaded page and our app — only events + `host-message` via preload work. This matches cmux's approach of treating loaded content as untrusted.

### 13.2 Insecure HTTP blocking

When the user navigates to an `http://` URL:
1. Check if the host is in the allowlist (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`, `*.localtest.me`, + user-configured hosts from `browserInsecureAllowlist`)
2. If not allowed, show a confirmation bar below the address bar:
   - "This page is not secure. Allow Once | Always Allow | Cancel"
   - "Always Allow" adds the host to the persistent allowlist in settings

### 13.3 Navigation rules

Set navigation rules on each `<electrobun-webview>` to implement the host whitelist:

```typescript
function applyNavigationRules(
  webviewEl: WebviewTagElement,
  settings: AppSettings,
): void {
  const whitelist = settings.browserHostWhitelist;
  if (whitelist.length === 0) {
    webviewEl.setNavigationRules([]); // allow all
    return;
  }
  const rules = [
    "^*",  // block everything by default
    ...whitelist.map((host) => `*://${host}/*`),
    // Always allow localhost for dev
    "*://localhost/*",
    "*://127.0.0.1/*",
    "*://[::1]/*",
  ];
  webviewEl.setNavigationRules(rules);
}
```

---

## 14. Phase 13 — Scriptable API (Agent Automation)

### 14.1 Accessibility tree snapshot

cmux uses WKWebView's native accessibility tree. We simulate this via JS injection.

#### Snapshot script (injected via `executeJavascript`)

A JavaScript function that walks the DOM and builds an accessibility-tree-like JSON:

```typescript
const ACCESSIBILITY_SNAPSHOT_SCRIPT = `
(function() {
  function snapshot(node, depth, maxDepth) {
    if (depth > maxDepth) return null;
    const role = node.getAttribute?.("role") || node.tagName?.toLowerCase();
    const name = node.getAttribute?.("aria-label") ||
                 node.getAttribute?.("alt") ||
                 node.getAttribute?.("title") ||
                 (node.tagName === "INPUT" ? node.placeholder : "") ||
                 "";
    const text = node.nodeType === 3 ? node.textContent?.trim() : "";
    const interactive = ["a", "button", "input", "select", "textarea"]
      .includes(node.tagName?.toLowerCase());
    const children = [];
    for (const child of (node.childNodes || [])) {
      const snap = snapshot(child, depth + 1, maxDepth);
      if (snap) children.push(snap);
    }
    if (!role && !text && children.length === 0) return null;
    const entry = { role, name, text };
    if (interactive) entry.ref = "e" + (++window.__snapRefCounter);
    if (children.length) entry.children = children;
    return entry;
  }
  window.__snapRefCounter = 0;
  const tree = snapshot(document.body, 0, 10);
  window.__electrobunSendToHost({
    type: "snapshot",
    tree: JSON.stringify(tree)
  });
})();
`;
```

The result is collected via `host-message` → forwarded to bun → returned to the CLI caller via a pending-read pattern.

### 14.2 Element interaction via JS injection

```bash
# Click by CSS selector
ht browser-eval --surface browser:1 "document.querySelector('button.submit').click()"

# Fill a field
ht browser-eval --surface browser:1 "document.querySelector('#email').value = 'test@example.com'"

# Get page title
ht browser-eval --surface browser:1 "document.title"
```

For the `eval` commands, we use `executeJavascript()` (fire-and-forget). To get a return value, we need the preload's `__electrobunSendToHost` pattern:

```typescript
// Eval with response: inject script that sends result back
const wrappedScript = `
  try {
    const __result = eval(${JSON.stringify(script)});
    window.__electrobunSendToHost({
      type: "evalResult",
      reqId: ${JSON.stringify(reqId)},
      result: typeof __result === "object" ? JSON.stringify(__result) : String(__result)
    });
  } catch (e) {
    window.__electrobunSendToHost({
      type: "evalResult",
      reqId: ${JSON.stringify(reqId)},
      error: e.message
    });
  }
`;
webviewEl.executeJavascript(wrappedScript);
```

The `host-message` handler collects the result and resolves a pending Promise on the bun side.

---

## 15. Phase 14 — Web Mirror Integration

### Current state

The web mirror (`src/bun/web-server.ts`) broadcasts terminal I/O to WebSocket clients. It needs to also broadcast browser surface events.

### Additions

```typescript
// In web-server.ts broadcast handlers:

// Browser surface created
{ type: "browserSurfaceCreated", surfaceId, url }

// Browser navigated
{ type: "browserNavigated", surfaceId, url, title }

// Browser surface closed
{ type: "browserSurfaceClosed", surfaceId }
```

The web mirror client can display a simplified browser preview (URL + title) or an iframe for the same URL (limited to localhost/same-network).

---

## 16. Phase 15 — Polish & Edge Cases

### 16.1 `<electrobun-webview>` z-ordering

The Electrobun webview tag is a **layer positioned above** the parent webview. When overlays open (command palette, settings panel, process manager, prompt dialog), the `<electrobun-webview>` would visually appear above them.

**Solution**: When any overlay opens, call `toggleHidden(true)` on all visible browser webview elements. When the overlay closes, call `toggleHidden(false)`.

```typescript
// In surface-manager.ts:
hideBrowserWebviews(): void {
  for (const view of this.surfaces.values()) {
    if (view.surfaceType === "browser" && view.browserView) {
      view.browserView.webviewEl.toggleHidden(true);
    }
  }
}

showBrowserWebviews(): void {
  // Only show webviews for the active workspace
  const ws = this.activeWorkspace();
  if (!ws) return;
  for (const sid of ws.surfaceIds) {
    const view = this.surfaces.get(sid);
    if (view?.surfaceType === "browser" && view.browserView) {
      view.browserView.webviewEl.toggleHidden(false);
    }
  }
}
```

Hook into overlay toggles:

```typescript
// command-palette.ts, settings-panel.ts, process-manager.ts, prompt-dialog.ts:
// On show: surfaceManager.hideBrowserWebviews()
// On hide: surfaceManager.showBrowserWebviews()
```

### 16.2 Workspace switching

When switching workspaces, hide browser webviews of the outgoing workspace and show those of the incoming one.

```typescript
// In switchToWorkspace():
// Hide previous workspace's browser webviews
for (const view of this.surfaces.values()) {
  if (view.surfaceType === "browser" && view.browserView) {
    view.browserView.webviewEl.toggleHidden(true);
  }
}
// ... switch workspace ...
// Show new workspace's browser webviews
for (const sid of newWs.surfaceIds) {
  const view = this.surfaces.get(sid);
  if (view?.surfaceType === "browser" && view.browserView) {
    view.browserView.webviewEl.toggleHidden(false);
    view.browserView.webviewEl.syncDimensions();
  }
}
```

### 16.3 Pane resize

When the pane layout changes (split, close, divider drag), browser webviews need to update their dimensions:

```typescript
// In applyLayout():
for (const sid of ws.surfaceIds) {
  const view = this.surfaces.get(sid);
  if (view?.surfaceType === "browser" && view.browserView) {
    // Force dimension sync after positioning
    requestAnimationFrame(() => {
      view.browserView!.webviewEl.syncDimensions(true);
    });
  }
}
```

### 16.4 Terminal link interception

When `browserInterceptTerminalLinks` is enabled, intercept Cmd+Click on URLs in xterm.js and open them in a browser split instead of externally:

```typescript
// In the WebLinksAddon handler (during terminal surface creation):
const webLinksAddon = new WebLinksAddon((event, url) => {
  if (currentSettings?.browserInterceptTerminalLinks) {
    event.preventDefault();
    rpc.send("splitBrowserSurface", { direction: "horizontal", url });
  } else {
    rpc.send("openExternal", { url });
  }
});
```

### 16.5 Downloads

Listen to download events on `<electrobun-webview>` (via the bun-side `BrowserView` API — this requires the webview tag's underlying `BrowserView` to be accessible). For now, display a toast notification:

```typescript
// On the webview-side, listen for download events:
// Note: download events may need bun-side BrowserView access
// For v1, we show a toast on new-window-open for download links
```

If download events are available on the webview tag directly:

```typescript
webviewEl.on("download-started", (e) => {
  showToast(`Downloading: ${e.detail.filename}`, "info");
});
webviewEl.on("download-completed", (e) => {
  showToast(`Downloaded: ${e.detail.filename}`, "success");
});
webviewEl.on("download-failed", (e) => {
  showToast(`Download failed: ${e.detail.filename}`, "error");
});
```

### 16.6 Dark mode forcing

When `browserForceDarkMode` is enabled, inject CSS via preload or `executeJavascript`:

```typescript
const DARK_MODE_CSS = `
  html { color-scheme: dark !important; }
  @media (prefers-color-scheme: light) {
    html {
      filter: invert(1) hue-rotate(180deg) !important;
    }
    img, video, canvas, svg {
      filter: invert(1) hue-rotate(180deg) !important;
    }
  }
`;

// Apply on dom-ready:
webviewEl.on("dom-ready", () => {
  if (currentSettings?.browserForceDarkMode) {
    webviewEl.executeJavascript(`
      const style = document.createElement("style");
      style.textContent = ${JSON.stringify(DARK_MODE_CSS)};
      document.head.appendChild(style);
    `);
  }
});
```

### 16.7 Console capture via preload

Inject a preload script that hooks `console.*` and forwards to the host:

```typescript
const CONSOLE_CAPTURE_PRELOAD = `
  const _origConsole = { ...console };
  ["log", "info", "warn", "error", "debug"].forEach(level => {
    console[level] = (...args) => {
      _origConsole[level](...args);
      try {
        window.__electrobunSendToHost({
          type: "console",
          level,
          args: args.map(a => {
            try { return typeof a === "object" ? JSON.stringify(a) : String(a); }
            catch { return String(a); }
          }),
          timestamp: Date.now()
        });
      } catch {}
    };
  });

  window.addEventListener("error", (e) => {
    window.__electrobunSendToHost({
      type: "error",
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      timestamp: Date.now()
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    window.__electrobunSendToHost({
      type: "error",
      message: "Unhandled rejection: " + String(e.reason),
      timestamp: Date.now()
    });
  });
`;
```

Use this as the `preload` attribute on the `<electrobun-webview>`:

```html
<electrobun-webview
  src="..."
  preload="<CONSOLE_CAPTURE_PRELOAD>"
  sandbox
  partition="persist:browser-shared"
></electrobun-webview>
```

### 16.8 Cookie/session sharing

All browser panes use the same `partition="persist:browser-shared"` by default. This means cookies are shared across all browser panes — logging into GitHub in one browser pane means you're logged in everywhere. Users can configure per-surface partitions via settings or CLI if needed later.

#### Cookie Store (implemented)

A `CookieStore` (`src/bun/cookie-store.ts`) provides a JSON-persisted cookie store at `~/.config/hyperterm-canvas/cookie-store.json`. Users can import cookies from JSON (EditThisCookie format) or Netscape/cURL files via Settings → Browser → Cookies or via CLI (`ht browser-cookie-import`). On each page navigation (`dom-ready`), matching cookies are auto-injected via `document.cookie` through the `executeJavascript()` API.

The injection flow is: `dom-ready` → webview sends `browserDomReady` RPC → bun queries `cookieStore.getForUrl()` → bun sends `browserInjectCookies` RPC → webview calls `browserPaneInjectCookies()` → `executeJavascript(document.cookie = "...")`.

Limitation: HTTP-only cookies cannot be set via `document.cookie`. They are stored for reference but skipped during injection.

### 16.9 Page zoom persistence

Zoom level per browser surface is tracked in `BrowserSurfaceManager` and persisted in the layout file (alongside `surfaceUrls`).

```typescript
// In PersistedWorkspace:
surfaceZooms?: Record<string, number>;
```

On restore, apply the zoom level after the webview loads.

---

## 17. File Change Matrix

| File | Change Type | Description |
|---|---|---|
| `src/shared/types.ts` | **Modify** | Add `surfaceType` to `PaneLeaf`, add browser RPC messages, add `BrowserSurfaceState`, extend `PersistedWorkspace` |
| `src/shared/settings.ts` | **Modify** | Add `browserSearchEngine`, `browserHomePage`, `browserForceDarkMode`, `browserInterceptTerminalLinks`, `browserHostWhitelist`, `browserInsecureAllowlist` |
| `src/bun/browser-surface-manager.ts` | **New** | Browser surface state management (URL, title, zoom, navigation history) |
| `src/bun/browser-history.ts` | **New** | Browser history persistence and search |
| `src/bun/index.ts` | **Modify** | Import browser managers, handle browser RPC messages, extend `createWorkspaceSurface` / `splitSurface` for browser type, extend `tryRestoreLayout`, extend `saveLayout` |
| `src/bun/rpc-handler.ts` | **Modify** | Add all `browser.*` methods |
| `src/bun/web-server.ts` | **Modify** | Broadcast browser surface events to web mirror clients |
| `src/views/terminal/browser-pane.ts` | **New** | Browser pane DOM construction, address bar, event wiring, navigation helpers, URL utilities |
| `src/views/terminal/surface-manager.ts` | **Modify** | Extend `SurfaceView` interface for browser type, branch in `createSurfaceView`, add browser-specific methods (`browserGoBack`, `browserNavigateTo`, etc.), handle z-ordering, extend layout/positioning for browser panes, extend workspace state sync |
| `src/views/terminal/index.ts` | **Modify** | Add ⌘⇧L shortcut, add browser keyboard shortcuts, extend `handleSocketAction`, extend `buildPaletteCommands`, add browser split buttons |
| `src/views/terminal/index.css` | **Modify** | Add `.surface-browser`, `.browser-address-bar`, `.browser-url-input`, `.browser-nav-btn`, `.browser-webview-container`, `.browser-lock-icon`, loading animation, autocomplete dropdown styles |
| `src/views/terminal/index.html` | **Modify** | Add webview tag script import (if needed by Electrobun) |
| `src/views/terminal/command-palette.ts` | No change | Commands added dynamically via `buildPaletteCommands` |
| `src/views/terminal/settings-panel.ts` | **Modify** | Add "Browser" settings section |
| `src/views/terminal/sidebar.ts` | **Modify** | Show browser metadata for focused browser surface |
| `src/views/terminal/icons.ts` | **Modify** | Add globe/browser icon, lock icon, back/forward/reload icons |
| `bin/ht` | **Modify** | Add all `browser-*` CLI commands, update help text |
| `electrobun.config.ts` | Possibly **Modify** | If the webview tag script needs explicit bundling |
| `tests/` | **New files** | Tests for `BrowserSurfaceManager`, `BrowserHistoryStore`, browser RPC methods |
| `src/bun/cookie-store.ts` | **New** | JSON-persisted cookie store with domain matching, URL filtering, import/export, LRU eviction |
| `src/bun/cookie-parsers.ts` | **New** | Import parsers (JSON/Netscape) and export formatters for cookie files |
| `tests/cookie-store.test.ts` | **New** | 20 tests for CookieStore CRUD, domain matching, persistence |
| `tests/cookie-parsers.test.ts` | **New** | 19 tests for JSON/Netscape parsing, export, round-trips |

---

## 18. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Webview tag z-ordering** — `<electrobun-webview>` renders as a native layer above the parent webview. Overlays (palette, settings, process manager, dialogs) render behind it. | **High** | **High** | Use `toggleHidden(true)` on all browser webview elements when any overlay opens. Use `toggleHidden(false)` when overlay closes. See §16.1. |
| 2 | **Keyboard routing** — Browser panes need keyboard input, but the app's design routes all keys to xterm.js. | **High** | **High** | Surface-type-aware focus routing. When a browser pane is focused, don't forward keys to xterm. See §5. |
| 3 | **Webview tag resizing** — When pane layout changes, the OOPIF overlay may lag behind or not resize correctly. | **Medium** | **Medium** | Call `syncDimensions(true)` after every layout change. Use `requestAnimationFrame` for timing. |
| 4 | **No RPC in sandbox mode** — Sandboxed webview tags can't use Electrobun's typed RPC. | **Medium** | **Low** | We only need `executeJavascript()` (fire-and-forget) + `host-message` events (via preload). Both work in sandbox mode. |
| 5 | **Download events** — Download events (`download-started`, etc.) are documented on `BrowserView` but may not be available on `<electrobun-webview>` tags. | **Medium** | **Low** | Check at runtime. If not available, show downloads as "open in external browser" fallback. |
| 6 | **Accessibility tree quality** — JS-based DOM snapshot is less reliable than native WKWebView accessibility API. | **Low** | **Medium** | Document that the scriptable API is "best effort". For agent automation, `eval` is more reliable than `snapshot` for specific interactions. |
| 7 | **Performance** — Many browser panes open simultaneously could consume significant memory (each is an isolated process). | **Low** | **Medium** | Lazy-load: only show/render webview when workspace is active. When switching away, optionally `toggleHidden(true)` to reduce compositing overhead. |
| 8 | **Electrobun version** — Features like `openDevTools()`, `findInPage()` on webview tags may depend on the Electrobun version (currently 1.16.0). | **Low** | **Medium** | Test each API call. For missing features, degrade gracefully (e.g. "DevTools not available"). |
| 9 | **Cookie import** — cmux supports importing cookies from Chrome/Firefox/Arc. This requires native filesystem access to browser cookie databases. | **Low** | **Low** | ✅ Implemented via `CookieStore` + `cookie-parsers.ts`. Supports JSON (EditThisCookie) and Netscape/cURL formats. Cookies are auto-injected on navigation via `document.cookie`. Import from native browser databases (Chrome encrypted, Safari binary) remains out of scope. |

---

## 19. Testing Plan

### 19.1 Unit tests (new files in `tests/`)

| Test file | What it covers |
|---|---|
| `tests/browser-surface-manager.test.ts` | Create/close/update browser surfaces, navigation state, zoom |
| `tests/browser-history.test.ts` | Record, search, dedup, normalize URLs, persistence round-trip |
| `tests/rpc-handler-browser.test.ts` | All `browser.*` RPC methods — open, navigate, back, forward, url, eval, list, history |
| `tests/url-helpers.test.ts` | `isUrl()`, `normalizeUrl()`, `buildSearchUrl()` — edge cases (localhost:3000, bare domains, unicode, etc.) |
| `tests/cookie-store.test.ts` | CookieStore CRUD, domain matching, URL filtering, persistence round-trip, LRU eviction |
| `tests/cookie-parsers.test.ts` | JSON and Netscape format parsing, export formatting, round-trip fidelity |

### 19.2 Integration tests

| Test | How to verify |
|---|---|
| `bun test` | All existing 134 tests still pass, plus new browser tests |
| `bun run typecheck` | Zero type errors with new types |
| Manual: `bun start` | App launches, terminal works, ⌘⇧L opens a browser split |
| Manual: address bar | Type URL → loads. Type search query → goes to Google. ⌘L focuses bar. |
| Manual: navigation | Back/Forward buttons work. ⌘[ / ⌘] work. |
| Manual: split | Browser pane can be split with another browser or terminal |
| Manual: overlays | Command palette, settings, process manager render above browser pane (webview hidden) |
| Manual: workspace switch | Browser panes hide/show correctly |
| Manual: persistence | Close app, reopen → browser pane restored with same URL |
| Manual: `ht` CLI | `ht browser-open https://example.com` opens a browser pane |
| Manual: devtools | ⌥⌘I opens WebKit inspector on browser pane |
| Manual: find | ⌘F opens find-in-page on browser pane |

### 19.3 Acceptance criteria

- [ ] Terminal panes work exactly as before (zero regressions)
- [ ] ⌘⇧L creates a browser split alongside the focused terminal
- [ ] Address bar navigates to URLs and searches non-URLs
- [ ] Back/Forward/Reload work via buttons and keyboard shortcuts
- [ ] Browser pane survives workspace switch and app restart
- [ ] `ht browser-open`, `ht browser-navigate`, `ht browser-eval` work
- [ ] Command palette shows browser-related commands
- [ ] Settings panel has Browser section
- [ ] Sidebar shows browser metadata for focused browser pane
- [ ] Overlays (palette, settings, dialogs) render above browser panes
- [ ] All `bun test` and `bun run typecheck` pass

---

## Appendix: Keyboard Shortcuts Summary

| Shortcut | Action | Context |
|---|---|---|
| ⌘⇧L | Open browser in split | Global |
| ⌘L | Focus address bar | Browser pane focused |
| ⌘[ | Back | Browser pane focused |
| ⌘] | Forward | Browser pane focused |
| ⌘R | Reload page | Browser pane focused |
| ⌥⌘I | Toggle DevTools | Browser pane focused |
| ⌘F | Find in page | Browser pane focused |
| ⌘+/⌘- | Zoom in/out | Browser pane focused |
| ⌘0 | Reset zoom | Browser pane focused |
| Escape | Blur address bar / close find | Browser pane focused |
| ⌘D | Split browser right | Browser pane focused |
| ⌘⇧D | Split browser down | Browser pane focused |
| ⌘W | Close browser pane | Browser pane focused |

## Appendix: CLI Commands Summary

```
ht browser-open [url]                  Open browser in new workspace
ht browser-split [url] [--direction]   Split browser alongside current pane
ht browser-navigate [--surface] <url>  Navigate to URL
ht browser-back [--surface]            Go back
ht browser-forward [--surface]         Go forward
ht browser-reload [--surface]          Reload page
ht browser-url [--surface]             Print current URL
ht browser-eval [--surface] <script>   Execute JavaScript in page
ht browser-find [--surface] <query>    Find text in page
ht browser-devtools [--surface]        Toggle developer tools
ht browser-snapshot [--surface]        Capture accessibility tree
ht browser-history                     List browser history
ht browser-clear-history               Clear browser history
ht list-browsers                       List all browser surfaces
```
