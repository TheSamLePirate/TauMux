type ToastLevel = "info" | "success" | "warning" | "error";

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  container.setAttribute("role", "status");
  container.setAttribute("aria-live", "polite");
  document.body.appendChild(container);
  return container;
}

const MAX_TOASTS = 5;

export function showToast(message: string, level: ToastLevel = "info"): void {
  const parent = ensureContainer();

  // Evict the oldest BEFORE appending so we never briefly have 6+
  // toasts mounted (which caused layout thrash during error bursts).
  const existing = parent.querySelectorAll<HTMLElement>(
    ".toast:not(.toast-exit)",
  );
  if (existing.length >= MAX_TOASTS) {
    // Drop the oldest enough so we land at MAX_TOASTS - 1 after append.
    const toEvict = existing.length - (MAX_TOASTS - 1);
    for (let i = 0; i < toEvict; i++) dismissToast(existing[i]);
  }

  const el = document.createElement("div");
  el.className = `toast toast-${level}`;
  el.textContent = message;
  if (level === "error") el.setAttribute("role", "alert");

  parent.appendChild(el);

  // Animate in
  requestAnimationFrame(() => {
    el.classList.add("toast-visible");
  });

  // Auto-dismiss
  const timeout = level === "error" ? 6000 : 4000;
  setTimeout(() => dismissToast(el), timeout);
}

function dismissToast(el: HTMLElement): void {
  if (!el.parentElement) return;
  el.classList.remove("toast-visible");
  el.classList.add("toast-exit");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  // Safety: remove after 500ms even if transitionend doesn't fire
  setTimeout(() => el.remove(), 500);
}
