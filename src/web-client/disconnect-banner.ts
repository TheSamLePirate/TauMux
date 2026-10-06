// τ-mux web mirror — disconnect banner.
//
// The transport gives up after MAX_RECONNECT_ATTEMPTS (≈ a phone that
// slept through the whole backoff ladder, or a host that restarted
// with a rotated token). Before this banner the only signal was an
// 8 px header dot going red — the terminal simply froze with no
// explanation and no way out short of knowing to pull-to-refresh.
//
// Same deliberate non-modal shape as the SW update banner: it does
// not auto-dismiss and it does not auto-reload — a user mid-read
// shouldn't lose their place. "Reload" re-boots the client (fresh
// transport, fresh auth token from the URL); "Later" dismisses until
// the next disconnect episode.

const BANNER_ID = "tau-mux-disconnect-banner";
const STYLE_ID = "tau-mux-disconnect-banner-style";

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
  border: 1px solid var(--ht-sem-error, rgba(239, 68, 68, 0.52));
  max-width: calc(100vw - 24px);
}
#${BANNER_ID} .tau-disconnect-text {
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
  background: var(--ht-sem-error, #ef4444);
  color: #fff;
  font-weight: 600;
}
#${BANNER_ID} button:hover {
  filter: brightness(1.1);
}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function removeBanner(): void {
  document.getElementById(BANNER_ID)?.remove();
}

function showBanner(): void {
  if (document.getElementById(BANNER_ID)) return;
  ensureStyle();
  const el = document.createElement("div");
  el.id = BANNER_ID;
  el.setAttribute("role", "alert");

  const text = document.createElement("span");
  text.className = "tau-disconnect-text";
  text.textContent = "Connection to τ-mux lost";

  const reload = document.createElement("button");
  reload.className = "primary";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());

  const later = document.createElement("button");
  later.textContent = "Later";
  later.addEventListener("click", removeBanner);

  el.append(text, reload, later);
  document.body.appendChild(el);
}

/** Drive the banner from the store's connection status. Called on
 *  every status transition; cheap (idempotent show/remove). */
export function applyConnectionBanner(
  status: "connecting" | "connected" | "disconnected",
): void {
  if (status === "disconnected") showBanner();
  else removeBanner();
}
