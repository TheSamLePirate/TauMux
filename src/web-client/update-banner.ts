// τ-mux web mirror — service-worker update banner.
//
// When a new bundle is deployed and the SW reaches `installed` state
// (waiting for the previous SW to step down), we render a small
// non-modal banner at the top of the viewport: "Update available —
// Reload". Clicking the action button posts `{type:"SKIP_WAITING"}`
// to the waiting SW; the SW responds by activating; the page receives
// `controllerchange` and reloads itself onto the new bundle.
//
// The banner deliberately doesn't auto-dismiss. A user mid-session
// shouldn't lose their place to a transient toast — they decide when
// to reload. Manual close is offered via the "Later" button.

const BANNER_ID = "tau-mux-update-banner";
const STYLE_ID = "tau-mux-update-banner-style";

const CSS = `
#${BANNER_ID} {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99999;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--ht-radius-control, 8px);
  background: var(--ht-bg-card-raised, rgba(255, 255, 255, 0.08));
  color: var(--ht-text-strong, #f5f7fb);
  font-family: var(--ht-font-ui, system-ui);
  font-size: 13px;
  line-height: 1.3;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  border: 1px solid var(--ht-accent-strong, rgba(234, 179, 8, 0.52));
  max-width: calc(100vw - 24px);
}
#${BANNER_ID} .tau-update-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${BANNER_ID} button {
  border: 0;
  font: inherit;
  cursor: pointer;
  border-radius: 999px;
  padding: 4px 10px;
  background: transparent;
  color: var(--ht-text-main, #e4e4e7);
}
#${BANNER_ID} button.primary {
  background: var(--ht-accent, #eab308);
  color: #1a1a1a;
  font-weight: 600;
}
#${BANNER_ID} button:hover {
  filter: brightness(1.1);
}
`;

export interface UpdateBannerDeps {
  /** Resolves to the SW registration that's holding the new bundle.
   *  Returns null when the registration vanished between detection
   *  and click (very rare; we just no-op the click). */
  getWaitingWorker: () => ServiceWorker | null;
  /** Called when the user clicks Reload. Defaults to a postMessage +
   *  page reload via `controllerchange`; the indirection lets tests
   *  observe the call without driving a real SW. */
  onReload?: () => void;
}

/** Mount the update banner if it isn't already on the page. Idempotent
 *  — calling this twice is a no-op. */
export function showUpdateBanner(deps: UpdateBannerDeps): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(BANNER_ID)) return;

  ensureStyle();

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const text = document.createElement("span");
  text.className = "tau-update-text";
  text.textContent = "A new version is available.";
  banner.appendChild(text);

  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "primary";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => {
    if (deps.onReload) {
      deps.onReload();
      return;
    }
    const waiting = deps.getWaitingWorker();
    if (!waiting) {
      // The waiting worker disappeared (e.g. another tab already
      // claimed it). Fallback: a hard reload picks up the new bundle
      // either way — the next navigation re-checks the SW state.
      window.location.reload();
      return;
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
    // The reload is driven by the `controllerchange` listener wired in
    // pwa.ts. Don't reload here — that would race the new SW's
    // activate event and leave the browser navigating to the old
    // bundle on the next start.
  });
  banner.appendChild(reload);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Later";
  dismiss.addEventListener("click", () => {
    banner.remove();
  });
  banner.appendChild(dismiss);

  document.body.appendChild(banner);
}

/** Remove the banner if mounted. Safe to call when nothing's there. */
export function hideUpdateBanner(): void {
  if (typeof document === "undefined") return;
  document.getElementById(BANNER_ID)?.remove();
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
