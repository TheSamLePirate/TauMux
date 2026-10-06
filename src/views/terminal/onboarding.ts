import { createIcon } from "./icons";

/**
 * First-run welcome — the entire onboarding story, deliberately small.
 *
 * τ-mux ships 100+ palette commands, 80+ `ht` commands and ten settings
 * sections, and historically announced none of it: first launch created
 * a workspace, spawned a shell, and that was the whole experience. This
 * overlay is the 80%-value fix: four lines that make the app
 * discoverable, shown once, gated on `settings.onboardingCompleted`.
 *
 * Shown once per install (the flag persists); dismissible with the
 * button, Escape, or a backdrop click. Every dismissal path persists
 * the flag — a welcome you can't make go away forever is not a
 * welcome.
 */

const SHORTCUTS: Array<{ keys: string; what: string }> = [
  { keys: "⌘⇧P", what: "Command palette — every action, fuzzy-searchable" },
  { keys: "⌘⌥P", what: "Process manager — see and kill what runs in panes" },
  { keys: "⌘⇧?", what: "Keyboard cheatsheet — every binding, live-generated" },
  { keys: "ht --help", what: "Script everything from any shell on this Mac" },
];

export interface OnboardingOptions {
  /** Persisted flag — when true the overlay never mounts. */
  completed: boolean;
  /** Persist `onboardingCompleted: true` (fire-and-forget rpc). */
  onDismiss: () => void;
}

/** Show the welcome overlay unless onboarding already completed.
 *  Returns true when the overlay was mounted. */
export function maybeShowOnboarding(opts: OnboardingOptions): boolean {
  if (opts.completed) return false;
  if (document.getElementById("onboarding-overlay")) return false;

  const overlay = document.createElement("div");
  overlay.id = "onboarding-overlay";
  overlay.className = "onboarding-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Welcome to τ-mux");

  const card = document.createElement("div");
  card.className = "onboarding-card";

  const eyebrow = document.createElement("span");
  eyebrow.className = "onboarding-eyebrow";
  eyebrow.textContent = "Welcome to τ-mux";

  const title = document.createElement("h2");
  title.className = "onboarding-title";
  title.textContent = "A terminal that shows its work.";

  const list = document.createElement("ul");
  list.className = "onboarding-shortcuts";
  for (const s of SHORTCUTS) {
    const li = document.createElement("li");
    const keys = document.createElement("kbd");
    keys.className = "onboarding-keys";
    keys.textContent = s.keys;
    const what = document.createElement("span");
    what.className = "onboarding-what";
    what.textContent = s.what;
    li.append(keys, what);
    list.appendChild(li);
  }

  const dismiss = document.createElement("button");
  dismiss.className = "onboarding-dismiss";
  dismiss.append(createIcon("close", "", 12));
  const label = document.createElement("span");
  label.textContent = "Got it";
  dismiss.append(label);

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    overlay.classList.remove("visible");
    window.removeEventListener("keydown", onKey, true);
    // Let the fade finish before unmounting.
    setTimeout(() => overlay.remove(), 250);
    opts.onDismiss();
  };
  dismiss.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);

  card.append(eyebrow, title, list, dismiss);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  // Double rAF so the opacity transition actually plays.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => overlay.classList.add("visible")),
  );
  dismiss.focus();
  return true;
}
