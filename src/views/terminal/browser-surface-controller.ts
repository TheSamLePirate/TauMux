// BrowserSurfaceController — the browser-pane concern extracted out of the
// SurfaceManager god object (full_app_review_2026-05.md §3, H10).
//
// SurfaceManager owns the generic surface machinery (workspaces, the pane
// tree, layout, focus, the SurfaceView lifecycle). Everything that knows
// HOW a browser pane works — creating the OOPIF view, wiring its callbacks,
// the navigate/zoom/find/devtools/cookie actions, and the show/hide overlay
// management — lives here. SurfaceManager composes one of these and delegates
// its browser-specific branches to it, so adding the next surface kind can
// follow the same controller template instead of growing SurfaceManager.
//
// The public browser* methods on SurfaceManager are kept as thin forwards to
// this controller so existing call sites (keybindings in index.ts, the
// socket API in socket-actions.ts) are unchanged.

import { htEvents } from "../../shared/event-bus";
import type { AppSettings } from "../../shared/settings";
import {
  type BrowserPaneView,
  createBrowserPaneView,
  browserPaneNavigateTo,
  browserPaneGoBack,
  browserPaneGoForward,
  browserPaneReload,
  browserPaneEvalJs,
  browserPaneFindInPage,
  browserPaneStopFind,
  browserPaneToggleDevTools,
  browserPaneFocusAddressBar,
  browserPaneSyncDimensions,
  browserPaneSetHidden,
  browserPaneApplyDarkMode,
  browserPaneInjectCookies,
  browserPaneGetCookies,
  destroyBrowserPaneView,
} from "./browser-pane";
import type { SurfaceView } from "./surface-manager";

export type BrowserCookie = {
  name: string;
  value: string;
  path: string;
  expires: number;
  secure: boolean;
  sameSite: string;
};

/** Pane rect as computed by the layout pass (matches the param type of
 *  `browserPaneSyncDimensions`). Not a DOMRect. */
type PaneRect = { x: number; y: number; w: number; h: number };

/** What the controller needs from SurfaceManager. Kept minimal so the
 *  browser concern doesn't reach back into SurfaceManager internals beyond
 *  these well-defined seams. */
export interface BrowserControllerDeps {
  /** Resolve a surface view by id (read from SurfaceManager's `surfaces`). */
  getSurface: (id: string) => SurfaceView | undefined;
  /** The currently-focused surface id (used as the default target). */
  getFocusedSurfaceId: () => string | null;
  /** All surface views (for hiding every browser overlay). */
  allSurfaces: () => Iterable<SurfaceView>;
  /** Surface ids in the active workspace (for showing its overlays).
   *  Iterable so the workspace's `Set<string>` passes through unchanged. */
  activeWorkspaceSurfaceIds: () => Iterable<string>;
  /** Focus a surface (browser pane `onFocus` callback). */
  focusSurface: (id: string) => void;
  /** Re-render the sidebar (browser pane `onTitleChanged` callback). */
  updateSidebar: () => void;
}

export class BrowserSurfaceController {
  /** P7 S7 — cached so `createBrowserView` picks up the user's choice
   *  instead of the browser-pane hardcoded fallback. */
  private searchEngine: AppSettings["browserSearchEngine"] = "google";

  constructor(private deps: BrowserControllerDeps) {}

  // ── settings ───────────────────────────────────────────────────────────
  setSearchEngine(engine: AppSettings["browserSearchEngine"]): void {
    this.searchEngine = engine;
  }

  // ── view creation ──────────────────────────────────────────────────────
  /** Create + wire a browser pane view. The caller (SurfaceManager) is
   *  responsible for attaching `view.container` to the DOM and wrapping the
   *  result in a SurfaceView. */
  createBrowserView(
    surfaceId: string,
    url: string,
    partition?: string,
  ): BrowserPaneView {
    return createBrowserPaneView(
      surfaceId,
      url,
      {
        onNavigated: (sid, navUrl, navTitle) => {
          htEvents.emit("ht-browser-navigated", {
            surfaceId: sid,
            url: navUrl,
            title: navTitle,
          });
        },
        onTitleChanged: (sid, newTitle) => {
          const view = this.deps.getSurface(sid);
          if (view) {
            view.title = newTitle;
            view.titleEl.textContent = newTitle;
          }
          htEvents.emit("ht-browser-title-changed", {
            surfaceId: sid,
            title: newTitle,
          });
          this.deps.updateSidebar();
        },
        onNewWindow: (sid, newUrl) => {
          // Open links from the page in the same browser pane
          const view = this.deps.getSurface(sid);
          if (view?.browserView) {
            browserPaneNavigateTo(view.browserView, newUrl);
          }
        },
        onFocus: (sid) => {
          this.deps.focusSurface(sid);
        },
        onClose: (sid) => {
          htEvents.emit("ht-close-surface", { surfaceId: sid });
        },
        onSplit: (sid, direction) => {
          htEvents.emit("ht-split", { surfaceId: sid, direction });
        },
        onEvalResult: (sid, reqId, result, error) => {
          htEvents.emit("ht-browser-eval-result", {
            surfaceId: sid,
            reqId,
            result,
            error,
          });
        },
        onConsoleLog: (sid, level, args, timestamp) => {
          htEvents.emit("ht-browser-console-log", {
            surfaceId: sid,
            level,
            args,
            timestamp,
          });
        },
        onError: (sid, message, filename, lineno, timestamp) => {
          htEvents.emit("ht-browser-error", {
            surfaceId: sid,
            message,
            filename,
            lineno,
            timestamp,
          });
        },
        onDomReady: (sid, domUrl) => {
          htEvents.emit("ht-browser-dom-ready", {
            surfaceId: sid,
            url: domUrl,
          });
        },
      },
      this.searchEngine,
      partition,
    );
  }

  // ── lifecycle ops used by SurfaceManager's generic machinery ───────────
  /** Detach the pane's event handlers (called from removeSurface). */
  destroyView(view: BrowserPaneView): void {
    destroyBrowserPaneView(view);
  }
  /** Toggle the OOPIF overlay visibility (switchToWorkspace). */
  setHidden(view: BrowserPaneView, hidden: boolean): void {
    browserPaneSetHidden(view, hidden);
  }
  /** Sync the OOPIF overlay rect (applyLayout). */
  syncDimensions(view: BrowserPaneView, rect?: PaneRect): void {
    browserPaneSyncDimensions(view, rect);
  }
  /** Apply force-dark-mode (applySettings). */
  applyDarkMode(view: BrowserPaneView, enabled: boolean): void {
    browserPaneApplyDarkMode(view, enabled);
  }

  // ── action helpers ─────────────────────────────────────────────────────
  /** Resolve the focused-or-named browser pane and run `fn` on it. */
  private withBrowserView(
    surfaceId: string | null | undefined,
    fn: (view: BrowserPaneView, resolvedId: string) => void,
  ): void {
    const id = surfaceId ?? this.deps.getFocusedSurfaceId();
    if (!id) return;
    const view = this.deps.getSurface(id);
    if (view?.browserView) fn(view.browserView, id);
  }

  /** Set a browser pane's zoom + dispatch the persistence event. */
  private applyBrowserZoom(
    view: BrowserPaneView,
    surfaceId: string,
    zoom: number,
  ): void {
    view.zoom = zoom;
    htEvents.emit("ht-browser-zoom", { surfaceId, zoom });
  }

  // ── actions (forwarded from SurfaceManager's public browser* methods) ──
  navigateTo(surfaceId: string | null, url: string): void {
    this.withBrowserView(surfaceId, (v) => browserPaneNavigateTo(v, url));
  }
  goBack(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneGoBack(v));
  }
  goForward(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneGoForward(v));
  }
  reload(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneReload(v));
  }
  evalJs(surfaceId: string | null, script: string, reqId?: string): void {
    this.withBrowserView(surfaceId, (v) => browserPaneEvalJs(v, script, reqId));
  }
  findInPage(surfaceId?: string | null, query?: string): void {
    this.withBrowserView(surfaceId, (v) =>
      browserPaneFindInPage(v, query ?? ""),
    );
  }
  stopFind(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneStopFind(v));
  }
  toggleDevTools(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneToggleDevTools(v));
  }
  injectCookies(surfaceId: string, cookies: BrowserCookie[]): void {
    this.withBrowserView(surfaceId, (v) =>
      browserPaneInjectCookies(v, cookies),
    );
  }
  getCookies(surfaceId: string, reqId: string): void {
    this.withBrowserView(surfaceId, (v) => browserPaneGetCookies(v, reqId));
  }
  focusAddressBar(): void {
    this.withBrowserView(null, (v) => browserPaneFocusAddressBar(v));
  }
  zoomIn(): void {
    this.withBrowserView(null, (v, id) => {
      this.applyBrowserZoom(v, id, Math.min(5.0, (v.zoom || 1.0) + 0.1));
    });
  }
  zoomOut(): void {
    this.withBrowserView(null, (v, id) => {
      this.applyBrowserZoom(v, id, Math.max(0.25, (v.zoom || 1.0) - 0.1));
    });
  }
  zoomReset(): void {
    this.withBrowserView(null, (v, id) => this.applyBrowserZoom(v, id, 1.0));
  }

  /** Hide all browser webview overlays (called when overlays open). */
  hideAllWebviews(): void {
    for (const view of this.deps.allSurfaces()) {
      if (view.browserView) browserPaneSetHidden(view.browserView, true);
    }
  }

  /** Show browser webview overlays for the active workspace. */
  showActiveWebviews(): void {
    for (const sid of this.deps.activeWorkspaceSurfaceIds()) {
      const view = this.deps.getSurface(sid);
      if (view?.browserView) {
        browserPaneSetHidden(view.browserView, false);
        // Force-sync on return-from-hidden — the cache was cleared by
        // setHidden(false) so this is a fresh sync regardless.
        browserPaneSyncDimensions(view.browserView, undefined, true);
      }
    }
  }
}
