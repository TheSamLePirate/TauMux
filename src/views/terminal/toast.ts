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

export function showToast(message: string, level: ToastLevel = "info"): void {
  const parent = ensureContainer();

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

  // Cap visible toasts
  const toasts = parent.querySelectorAll(".toast");
  if (toasts.length > 5) {
    dismissToast(toasts[0] as HTMLElement);
  }
}

function dismissToast(el: HTMLElement): void {
  if (!el.parentElement) return;
  el.classList.remove("toast-visible");
  el.classList.add("toast-exit");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  // Safety: remove after 500ms even if transitionend doesn't fire
  setTimeout(() => el.remove(), 500);
}
