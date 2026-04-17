interface PromptDialogOptions {
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
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

    function submit(): void {
      const value = input.value.trim();
      if (!value) return;
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
