interface PromptDialogOptions {
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Reject a value and say why, or return null to accept.
   *
   * Runs on submit and keeps the sheet open so the user can fix the
   * value in place. That is the whole point: the alternative callers
   * reached for was `alert()`, which inside the Electrobun webview
   * displays nothing at all — the input just appeared to be ignored.
   */
  validate?: (value: string) => string | null;
}

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button as destructive. */
  danger?: boolean;
}

let activeOverlay: HTMLDivElement | null = null;
let activeResolver: ((value: string | null) => void) | null = null;

export function showPromptDialog(
  options: PromptDialogOptions,
): Promise<string | null> {
  closePromptDialog();

  return new Promise((resolve) => {
    activeResolver = resolve;

    const overlay = document.createElement("div");
    overlay.className = "prompt-overlay";

    const sheet = document.createElement("div");
    sheet.className = "prompt-sheet";

    const title = document.createElement("h2");
    title.className = "prompt-title";
    title.textContent = options.title;
    sheet.appendChild(title);

    if (options.message) {
      const message = document.createElement("p");
      message.className = "prompt-message";
      message.textContent = options.message;
      sheet.appendChild(message);
    }

    const input = document.createElement("input");
    input.className = "prompt-input";
    input.type = "text";
    input.value = options.initialValue ?? "";
    input.placeholder = options.placeholder ?? "";
    sheet.appendChild(input);

    const actions = document.createElement("div");
    actions.className = "prompt-actions";

    const cancelButton = document.createElement("button");
    cancelButton.className = "prompt-btn prompt-btn-secondary";
    cancelButton.type = "button";
    cancelButton.textContent = options.cancelLabel ?? "Cancel";
    cancelButton.addEventListener("click", () => {
      finish(null);
    });
    actions.appendChild(cancelButton);

    const confirmButton = document.createElement("button");
    confirmButton.className = "prompt-btn prompt-btn-primary";
    confirmButton.type = "button";
    confirmButton.textContent = options.confirmLabel ?? "Save";
    confirmButton.addEventListener("click", () => {
      submit();
    });
    actions.appendChild(confirmButton);

    sheet.appendChild(actions);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    activeOverlay = overlay;

    /** Inline validation message; created on first refusal. */
    let errorEl: HTMLParagraphElement | null = null;

    /**
     * Refuse the current value. `reason` is null for the empty case,
     * where the shake alone says it: there is nothing to explain.
     */
    function refuse(reason: string | null): void {
      if (reason) {
        if (!errorEl) {
          errorEl = document.createElement("p");
          errorEl.className = "prompt-error";
          // `alert` role so the message is announced, not just drawn.
          errorEl.setAttribute("role", "alert");
          sheet.insertBefore(errorEl, actions);
        }
        errorEl.textContent = reason;
      }
      // Empty values silently did nothing before — user hit Enter on a
      // blank input and got no feedback, looked broken. Shake the
      // input briefly to show the action was seen but refused.
      input.classList.remove("prompt-input-invalid");
      // Force reflow so the class re-add triggers the animation again
      // on repeat invalid submits.
      void input.offsetWidth;
      input.classList.add("prompt-input-invalid");
      input.focus();
    }

    function submit(): void {
      const value = input.value.trim();
      if (!value) return refuse(null);
      const problem = options.validate?.(value) ?? null;
      if (problem) return refuse(problem);
      finish(value);
    }

    function finish(value: string | null): void {
      activeOverlay?.remove();
      activeOverlay = null;

      const resolver = activeResolver;
      activeResolver = null;
      resolver?.(value);
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });

    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) {
        finish(null);
      }
    });

    requestAnimationFrame(() => {
      overlay.classList.add("visible");
      input.focus();
      input.select();
    });
  });
}

/**
 * Yes/no variant of the prompt sheet — same overlay, same chrome, no
 * text input.
 *
 * Kept in this module rather than given its own file so both dialogs
 * share `activeOverlay`: only one modal sheet may exist at a time, and
 * that invariant is enforced by them being the same variable. Opening
 * either closes the other (resolving it as cancelled), which is what
 * `closePromptDialog` already promised.
 *
 * Resolves `true` only on an explicit confirm. Escape, the cancel
 * button, a backdrop click, and being displaced by another dialog all
 * resolve `false` — a confirm prompt that defaults to "yes" on an
 * ambiguous dismissal is a footgun.
 */
export function showConfirmDialog(
  options: ConfirmDialogOptions,
): Promise<boolean> {
  closePromptDialog();

  return new Promise((resolve) => {
    // `activeResolver` is typed for the prompt flow (string | null).
    // Adapt: null → false, anything else → true. That keeps a single
    // displacement path (`closePromptDialog` calls `resolver?.(null)`)
    // rather than two resolver slots that could drift out of sync.
    activeResolver = (value) => resolve(value !== null);

    const overlay = document.createElement("div");
    overlay.className = "prompt-overlay";

    const sheet = document.createElement("div");
    sheet.className = "prompt-sheet";

    const title = document.createElement("h2");
    title.className = "prompt-title";
    title.textContent = options.title;
    sheet.appendChild(title);

    const message = document.createElement("p");
    message.className = "prompt-message";
    message.textContent = options.message;
    sheet.appendChild(message);

    const actions = document.createElement("div");
    actions.className = "prompt-actions";

    const cancelButton = document.createElement("button");
    cancelButton.className = "prompt-btn prompt-btn-secondary";
    cancelButton.type = "button";
    cancelButton.textContent = options.cancelLabel ?? "Cancel";
    cancelButton.addEventListener("click", () => finish(null));
    actions.appendChild(cancelButton);

    const confirmButton = document.createElement("button");
    confirmButton.className = `prompt-btn prompt-btn-primary${
      options.danger ? " prompt-btn-danger" : ""
    }`;
    confirmButton.type = "button";
    confirmButton.textContent = options.confirmLabel ?? "Confirm";
    confirmButton.addEventListener("click", () => finish("confirm"));
    actions.appendChild(confirmButton);

    sheet.appendChild(actions);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    activeOverlay = overlay;

    function finish(value: string | null): void {
      activeOverlay?.remove();
      activeOverlay = null;
      const resolver = activeResolver;
      activeResolver = null;
      resolver?.(value);
    }

    // Keys land on the sheet, not on an input — the confirm button takes
    // focus so Enter/Space activate it natively and the sheet is
    // keyboard-reachable for the focus audit.
    sheet.tabIndex = -1;
    sheet.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });

    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) finish(null);
    });

    requestAnimationFrame(() => {
      overlay.classList.add("visible");
      confirmButton.focus();
    });
  });
}

export function closePromptDialog(): void {
  if (!activeOverlay) return;

  activeOverlay.remove();
  activeOverlay = null;

  const resolver = activeResolver;
  activeResolver = null;
  resolver?.(null);
}

/** Tier 2 test hook: inspect the currently-open prompt dialog. Returns null
 *  when no dialog is visible. The shape mirrors `PromptDialogOptions` so
 *  tests can assert on what the user would see. */
export function readActivePromptDialog(): {
  title: string;
  message: string | null;
  value: string;
  placeholder: string;
} | null {
  if (!activeOverlay) return null;
  const titleEl = activeOverlay.querySelector(".prompt-title");
  const messageEl = activeOverlay.querySelector(".prompt-message");
  const input = activeOverlay.querySelector(
    ".prompt-input",
  ) as HTMLInputElement | null;
  return {
    title: titleEl?.textContent ?? "",
    message: messageEl?.textContent ?? null,
    value: input?.value ?? "",
    placeholder: input?.placeholder ?? "",
  };
}

/** Tier 2 test hook: type a value into the active dialog and Enter-submit it.
 *  Returns true if a dialog was submitted, false otherwise. Empty values
 *  match the production behaviour — the dialog refuses to close. */
export function submitActivePromptDialog(value: string): boolean {
  if (!activeOverlay) return false;
  const input = activeOverlay.querySelector(
    ".prompt-input",
  ) as HTMLInputElement | null;
  if (!input) return false;
  input.value = value;
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  return !activeOverlay; // if Enter cleared the dialog, it submitted
}

/** Tier 2 test hook: cancel the active dialog via Escape. */
export function cancelActivePromptDialog(): boolean {
  if (!activeOverlay) return false;
  const input = activeOverlay.querySelector(
    ".prompt-input",
  ) as HTMLInputElement | null;
  if (input) {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  } else {
    closePromptDialog();
  }
  return true;
}

/**
 * Confirm-then-run for a destructive action.
 *
 * Exists because the DOM `confirm()` is a trap in this app: inside the
 * Electrobun webview the native modal never opens and the call returns
 * `false`, so every `if (confirm(...))` guard silently swallowed its
 * action forever. Three call sites shipped with that bug (closing a
 * dirty editor pane, removing an extension, regenerating the web-mirror
 * token) — this is the replacement they all use.
 *
 * Callback rather than a promise because every call site is a DOM event
 * handler that only cares about the "yes" branch; threading
 * `.then((ok) => { if (ok) … })` through each one is noise.
 */
export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
): void {
  void showConfirmDialog({
    title,
    message,
    confirmLabel,
    cancelLabel: "Cancel",
    danger: true,
  }).then((ok) => {
    if (ok) onConfirm();
  });
}
