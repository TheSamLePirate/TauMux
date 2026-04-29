// τ-mux web mirror — PWA / service-worker registration helper.
//
// Three responsibilities:
//
//   - registerServiceWorker(): idempotent registration with graceful
//     fallback when the API is unavailable (private mode, http on a
//     non-localhost origin, ancient browser). Also wires the D.3
//     update-available flow: when a new SW reaches `installed` state
//     while a previous SW still controls the page, we surface the
//     update banner and reload on `controllerchange`.
//   - injectIosMeta(): drops the iOS-specific Add-to-Home-Screen
//     `<meta>` tags into the document so the icon, status-bar style,
//     and standalone mode all light up. The other browsers honour
//     manifest.json directly.
//   - attachPullToRefresh(): touch-driven manual reload for mobile.
//
// All three are idempotent — safe to call multiple times across
// reconnects or hot reloads.

import { showUpdateBanner } from "./update-banner";

const SW_PATH = "/sw.js";
const APPLE_TOUCH_ICON_PATH = "/icons/apple-touch-icon.png";

export interface RegisterServiceWorkerResult {
  /** True when the SW was registered (or already registered). */
  registered: boolean;
  /** Reason string when not registered ("api-missing", "insecure-context", "error"). */
  reason?: string;
}

/** Register the service worker. Resolves with diagnostic info; never
 *  throws. */
export async function registerServiceWorker(): Promise<RegisterServiceWorkerResult> {
  if (typeof navigator === "undefined") {
    return { registered: false, reason: "api-missing" };
  }
  if (!("serviceWorker" in navigator)) {
    return { registered: false, reason: "api-missing" };
  }
  // Service workers require a secure context. window.isSecureContext
  // returns true on https + localhost; mobile mirror running on a LAN
  // IP over plain http will fail here — and that's correct, browsers
  // refuse to register the worker. We log a hint instead of crashing.
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return { registered: false, reason: "insecure-context" };
  }
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
    wireUpdateFlow(reg);
    return { registered: true };
  } catch {
    return { registered: false, reason: "error" };
  }
}

// D.3 — listen for SW updates and drive the banner.
//
// Three sources of "an update is waiting":
//   1. `reg.waiting` is non-null at registration time (the user opened
//      the app while a previous deploy left a SW already waiting).
//   2. `reg.installing` becomes non-null after registration; we listen
//      to its `statechange` and surface once it reaches `installed`.
//   3. `reg.onupdatefound` fires when the browser's periodic update
//      check finds a new SW.
//
// Each path resolves to the same banner. After the user clicks Reload,
// the banner's onReload handler posts SKIP_WAITING; the SW activates;
// `controllerchange` fires; we reload the page once.
let controllerChangeBound = false;
let reloadingForUpdate = false;
function wireUpdateFlow(reg: ServiceWorkerRegistration): void {
  // (1) Already-waiting worker on first registration.
  if (reg.waiting && navigator.serviceWorker.controller) {
    surfaceBanner(() => reg.waiting);
  }

  // (2) A new SW just started installing — wait for `installed`.
  const watchInstalling = (worker: ServiceWorker | null): void => {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        // Only show the banner when we have an existing controller
        // — that's the "this is an update, not a fresh install" signal.
        surfaceBanner(() => worker);
      }
    });
  };
  watchInstalling(reg.installing);

  // (3) Future updates picked up by `reg.update()` / browser idle
  //     update check.
  reg.addEventListener("updatefound", () => {
    watchInstalling(reg.installing);
  });

  // controllerchange → activate fired on the new SW → reload to
  // pick up the new bundle. We bind once globally; if the helper is
  // called twice (e.g. dev hot reload), the guard avoids double-reload.
  if (!controllerChangeBound) {
    controllerChangeBound = true;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
  }
}

function surfaceBanner(getWaiting: () => ServiceWorker | null): void {
  showUpdateBanner({
    getWaitingWorker: getWaiting,
  });
}

/** Trigger a one-shot update probe so a deployed bundle is picked up
 *  on next reload. Useful after the user hits "pull to refresh". */
export async function refreshServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  } catch {
    /* no-op */
  }
}

/** Add iOS-specific meta tags + apple-touch-icon link if they aren't
 *  already in the document head. Idempotent. */
export function injectIosMeta(): void {
  if (typeof document === "undefined") return;
  ensureMeta("apple-mobile-web-app-capable", "yes");
  ensureMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
  ensureMeta("apple-mobile-web-app-title", "τ-mux");
  ensureLinkRel("apple-touch-icon", APPLE_TOUCH_ICON_PATH);
}

function ensureMeta(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function ensureLinkRel(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// ── Pull-to-refresh ──────────────────────────────────────────

export interface PullToRefreshDeps {
  /** Element scoped for the gesture (typically the pane container). */
  rootEl: HTMLElement;
  /** Called when the user has pulled past the threshold and released. */
  onRefresh: () => void;
}

/** Attach a pull-to-refresh handler. Returns a teardown fn.
 *  The pull is only recognized when the underlying element is at
 *  scroll-top — otherwise the user is just scrolling content. */
export function attachPullToRefresh(deps: PullToRefreshDeps): () => void {
  const { rootEl, onRefresh } = deps;
  const THRESHOLD = 80;
  let startY: number | null = null;

  function onStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      startY = null;
      return;
    }
    const scroller = e.target instanceof HTMLElement ? e.target : null;
    // If anything inside the touch path is scrolled, we yield.
    if (scroller && hasScrollAncestor(scroller, rootEl)) {
      startY = null;
      return;
    }
    if (window.scrollY > 0) {
      startY = null;
      return;
    }
    startY = e.touches[0]!.clientY;
  }

  function onEnd(e: TouchEvent) {
    if (startY === null) return;
    const ct = e.changedTouches[0];
    if (!ct) {
      startY = null;
      return;
    }
    const dy = ct.clientY - startY;
    startY = null;
    if (dy >= THRESHOLD) onRefresh();
  }

  const opts: AddEventListenerOptions = { passive: true };
  rootEl.addEventListener("touchstart", onStart, opts);
  rootEl.addEventListener("touchend", onEnd, opts);
  rootEl.addEventListener("touchcancel", onEnd, opts);

  return () => {
    rootEl.removeEventListener("touchstart", onStart);
    rootEl.removeEventListener("touchend", onEnd);
    rootEl.removeEventListener("touchcancel", onEnd);
  };
}

/** Walk up the parent chain of `el` (stopping at `boundary`) looking
 *  for a scrolled container. Pure helper exported for tests. */
export function hasScrollAncestor(el: Element, boundary: Element): boolean {
  let cur: Element | null = el;
  while (cur && cur !== boundary && cur !== document.body) {
    if (cur instanceof HTMLElement) {
      const overflowY = getComputedStyle(cur).overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        cur.scrollTop > 0
      ) {
        return true;
      }
    }
    cur = cur.parentElement;
  }
  return false;
}
