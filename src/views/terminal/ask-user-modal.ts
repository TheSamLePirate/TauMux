/**
 * Webview modal for Plan #10 ask-user (commit C).
 *
 * Renders the head AskUserRequest pending for the currently focused
 * surface. Modeled on prompt-dialog.ts: a single document-root overlay,
 * proven keyboard / focus / Esc / Enter behavior, plus four kind
 * variants (yesno · choice · text · confirm-command).
 *
 * Lifecycle:
 *   - The state subscriber + `ht-surface-focused` listener trigger
 *     re-render: when the active surface changes, or when its head
 *     request appears / resolves, swap the sheet contents in place.
 *   - Optimistic dismiss: clicking an answer removes the modal locally
 *     and dispatches `askUserAnswer` / `askUserCancel` to bun. The
 *     authoritative `askUserEvent: resolved` arrives shortly after and
 *     is a no-op if the request is already gone from local state.
 *
 * Test hooks at module scope expose enough to drive the modal through
 * its kinds without faking RPC.
 */

import type { AskUserRequest } from "../../shared/types";
import type { AskUserState, AskUserStateChange } from "./ask-user-state";

export interface AskUserAttribution {
  workspace: string;
  surface: string;
}

export interface AskUserModalOptions {
  state: AskUserState;
  /** Dispatched on user answer. The modal does NOT wait for the bun
   *  side to confirm — the resolved push handles that. */
  onAnswer: (request_id: string, value: string) => void;
  /** Dispatched on user cancel. */
  onCancel: (request_id: string, reason?: string) => void;
  /** Live read — the currently focused surface in the webview. */
  getActiveSurfaceId: () => string | null;
  /** Pretty header line — workspace name and surface title at the
   *  moment the request shows. Best-effort: missing values render as
   *  empty strings, the modal still works. */
  getAttribution: (surface_id: string) => AskUserAttribution;
}

interface MountedModal {
  overlay: HTMLDivElement;
  request: AskUserRequest;
  /** confirm-command two-step state: false until the user clicks
   *  "I understand"; revealed shows the [Run] button. */
  confirmRevealed: boolean;
}

let active: MountedModal | null = null;
let activeOptions: AskUserModalOptions | null = null;

export function installAskUserModal(options: AskUserModalOptions): {
  rerender: () => void;
  isVisible: () => boolean;
  destroy: () => void;
} {
  activeOptions = options;
  const offState = options.state.subscribe((change) => onStateChange(change));
  const onSurfaceFocused = (): void => rerender();
  window.addEventListener("ht-surface-focused", onSurfaceFocused);

  return {
    rerender,
    isVisible: () => active !== null,
    destroy: () => {
      offState();
      window.removeEventListener("ht-surface-focused", onSurfaceFocused);
      unmount();
      activeOptions = null;
    },
  };
}

function onStateChange(_change: AskUserStateChange): void {
  // We always reconcile against the head of the active surface,
  // regardless of which event landed. Cheap render — singleton DOM,
  // no diff cost.
  rerender();
}

function rerender(): void {
  if (!activeOptions) return;
  const surfaceId = activeOptions.getActiveSurfaceId();
  if (!surfaceId) {
    unmount();
    return;
  }
  const head = activeOptions.state.getHeadForSurface(surfaceId);
  if (!head) {
    unmount();
    return;
  }
  if (active && active.request.request_id === head.request_id) {
    // Same request — nothing to redo; preserves focus + confirmRevealed.
    return;
  }
  unmount();
  mount(head);
}

function mount(request: AskUserRequest): void {
  if (!activeOptions) return;

  const overlay = document.createElement("div");
  overlay.className = "ask-user-overlay";
  overlay.setAttribute("data-ask-user-overlay", "1");
  overlay.setAttribute("data-request-id", request.request_id);
  overlay.setAttribute("data-kind", request.kind);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      // Clicking the dim backdrop cancels — same UX as prompt-dialog.
      cancelActive("backdrop click");
    }
  });

  const sheet = document.createElement("div");
  sheet.className = "ask-user-sheet";

  const attribution = activeOptions.getAttribution(request.surface_id);
  const attEl = document.createElement("div");
  attEl.className = "ask-user-attribution";
  attEl.textContent = formatAttribution(attribution, request);
  sheet.appendChild(attEl);

  const titleEl = document.createElement("h2");
  titleEl.className = "prompt-title ask-user-title";
  titleEl.textContent = request.title;
  sheet.appendChild(titleEl);

  if (request.unsafe) {
    const banner = document.createElement("div");
    banner.className = "ask-user-unsafe-banner";
    banner.textContent = "This will execute on your machine.";
    sheet.appendChild(banner);
  }

  if (request.body) {
    const bodyEl = document.createElement("p");
    bodyEl.className = "prompt-message ask-user-body";
    bodyEl.textContent = request.body;
    sheet.appendChild(bodyEl);
  }

  // Kind-specific body + actions are appended onto the sheet.
  active = { overlay, request, confirmRevealed: false };
  switch (request.kind) {
    case "yesno":
      renderYesno(sheet, request);
      break;
    case "choice":
      renderChoice(sheet, request);
      break;
    case "text":
      renderText(sheet, request);
      break;
    case "confirm-command":
      renderConfirmCommand(sheet, request);
      break;
  }

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add("visible");
    focusInitial();
  });
}

function unmount(): void {
  if (!active) return;
  active.overlay.remove();
  active = null;
}

function answerActive(value: string): void {
  if (!active || !activeOptions) return;
  const id = active.request.request_id;
  // Optimistic drop — re-render is driven by the resolved push from
  // bun, but for the mounting modal we remove eagerly so the user
  // sees instant feedback. If bun rejects (resolved=false), the
  // modal stays gone anyway because the request is unknown to bun.
  unmount();
  activeOptions.onAnswer(id, value);
}

function cancelActive(reason?: string): void {
  if (!active || !activeOptions) return;
  const id = active.request.request_id;
  unmount();
  activeOptions.onCancel(id, reason);
}

function renderYesno(sheet: HTMLDivElement, _req: AskUserRequest): void {
  const actions = document.createElement("div");
  actions.className = "prompt-actions ask-user-actions";

  const yes = mkButton("Yes", "prompt-btn-primary", "yes", () =>
    answerActive("yes"),
  );
  yes.dataset["askUserButton"] = "yes";
  const no = mkButton("No", "prompt-btn-secondary", "no", () =>
    answerActive("no"),
  );
  no.dataset["askUserButton"] = "no";
  const cancel = mkCancelButton();

  actions.append(yes, no, cancel);
  sheet.appendChild(actions);

  sheet.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      answerActive("yes");
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelActive("escape");
    }
  });
}

function renderChoice(sheet: HTMLDivElement, req: AskUserRequest): void {
  const list = document.createElement("div");
  list.className = "ask-user-choices";

  const choices = req.choices ?? [];
  for (const c of choices) {
    const btn = mkButton(c.label, "prompt-btn-secondary", c.id, () =>
      answerActive(c.id),
    );
    btn.dataset["askUserChoice"] = c.id;
    list.appendChild(btn);
  }
  sheet.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "prompt-actions ask-user-actions";
  actions.appendChild(mkCancelButton());
  sheet.appendChild(actions);

  sheet.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && choices.length > 0) {
      event.preventDefault();
      answerActive(choices[0].id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelActive("escape");
    }
  });
}

function renderText(sheet: HTMLDivElement, req: AskUserRequest): void {
  const input = document.createElement("input");
  input.className = "prompt-input ask-user-input";
  input.type = "text";
  input.value = req.default ?? "";
  input.placeholder = "";
  sheet.appendChild(input);

  const actions = document.createElement("div");
  actions.className = "prompt-actions ask-user-actions";
  actions.appendChild(mkCancelButton());
  const submit = mkButton("Submit", "prompt-btn-primary", "submit", () =>
    submit_(),
  );
  submit.dataset["askUserButton"] = "submit";
  actions.appendChild(submit);
  sheet.appendChild(actions);

  function submit_(): void {
    const value = input.value;
    if (value.length === 0) {
      input.classList.remove("prompt-input-invalid");
      void input.offsetWidth; // reflow to retrigger animation
      input.classList.add("prompt-input-invalid");
      input.focus();
      return;
    }
    answerActive(value);
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit_();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelActive("escape");
    }
  });
}

function renderConfirmCommand(
  sheet: HTMLDivElement,
  req: AskUserRequest,
): void {
  // The body is rendered as a code box rather than the standard
  // `<p>`. Replace the previously-appended body element if any —
  // the generic prefix in mount() rendered req.body as plain text,
  // which is wrong for a command. Walk the sheet and swap.
  const oldBody = sheet.querySelector(".ask-user-body");
  if (oldBody) oldBody.remove();
  if (req.body) {
    const codebox = document.createElement("pre");
    codebox.className = "ask-user-codebox";
    codebox.textContent = req.body;
    sheet.appendChild(codebox);
  }

  const actions = document.createElement("div");
  actions.className = "prompt-actions ask-user-actions";
  sheet.appendChild(actions);
  renderConfirmActions(actions, req);

  sheet.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelActive("escape");
    }
    // Enter intentionally does NOT submit — confirm-command requires
    // two deliberate clicks.
  });
}

function renderConfirmActions(
  actions: HTMLDivElement,
  _req: AskUserRequest,
): void {
  while (actions.firstChild) actions.removeChild(actions.firstChild);
  if (!active) return;

  if (!active.confirmRevealed) {
    actions.appendChild(mkCancelButton());
    const ack = mkButton(
      "I understand",
      "prompt-btn-secondary ask-user-confirm-ack",
      "ack",
      () => {
        if (!active) return;
        active.confirmRevealed = true;
        active.overlay.setAttribute("data-confirm-revealed", "1");
        renderConfirmActions(actions, _req);
      },
    );
    ack.dataset["askUserButton"] = "ack";
    actions.appendChild(ack);
  } else {
    actions.appendChild(mkCancelButton());
    const back = mkButton("Back", "prompt-btn-secondary", "back", () => {
      if (!active) return;
      active.confirmRevealed = false;
      active.overlay.removeAttribute("data-confirm-revealed");
      renderConfirmActions(actions, _req);
    });
    back.dataset["askUserButton"] = "back";
    actions.appendChild(back);
    const run = mkButton("Run", "ask-user-btn-danger", "run", () =>
      answerActive("run"),
    );
    run.dataset["askUserButton"] = "run";
    actions.appendChild(run);
  }
  // After re-render, focus the rightmost action (Run when revealed,
  // Ack otherwise). Use rAF so the DOM mutation lands before focus.
  requestAnimationFrame(() => {
    const last = actions.lastElementChild as HTMLElement | null;
    last?.focus();
  });
}

function mkButton(
  label: string,
  className: string,
  identifier: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `prompt-btn ${className}`;
  btn.textContent = label;
  btn.dataset["askUserId"] = identifier;
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return btn;
}

function mkCancelButton(): HTMLButtonElement {
  const btn = mkButton(
    "Cancel",
    "prompt-btn-secondary ask-user-cancel",
    "cancel",
    () => cancelActive("user cancelled"),
  );
  btn.dataset["askUserButton"] = "cancel";
  return btn;
}

function focusInitial(): void {
  if (!active) return;
  const overlay = active.overlay;
  // Per-kind: text → input, yesno → Yes, choice → first choice,
  // confirm-command → "I understand" (or Run when revealed).
  const target =
    (overlay.querySelector(".ask-user-input") as HTMLElement | null) ??
    (overlay.querySelector(
      '[data-ask-user-button="yes"]',
    ) as HTMLElement | null) ??
    (overlay.querySelector(
      ".ask-user-choices > button",
    ) as HTMLElement | null) ??
    (overlay.querySelector(
      '[data-ask-user-button="ack"]',
    ) as HTMLElement | null);
  target?.focus();
}

function formatAttribution(
  att: AskUserAttribution,
  req: AskUserRequest,
): string {
  const parts: string[] = [];
  if (att.workspace) parts.push(att.workspace);
  if (att.surface) parts.push(att.surface);
  if (parts.length === 0) parts.push(req.surface_id);
  if (req.agent_id) parts.push(req.agent_id);
  return parts.join(" · ");
}

// ── Test hooks ───────────────────────────────────────────────────────
// These mirror the shape of prompt-dialog.ts's test hooks. They let
// tests drive the modal end-to-end without touching the real RPC.

export interface ActiveAskUserModalSnapshot {
  request_id: string;
  kind: AskUserRequest["kind"];
  title: string;
  body: string | null;
  attribution: string;
  unsafe: boolean;
  /** For kind=text: current input value. */
  inputValue?: string;
  /** For kind=choice: choice ids in order. */
  choiceIds?: string[];
  /** For kind=confirm-command: whether ack has been revealed. */
  confirmRevealed?: boolean;
}

export function readActiveAskUserModal(): ActiveAskUserModalSnapshot | null {
  if (!active) return null;
  const overlay = active.overlay;
  const titleEl = overlay.querySelector(".ask-user-title");
  const bodyEl = overlay.querySelector(
    ".ask-user-body, .ask-user-codebox",
  ) as HTMLElement | null;
  const attEl = overlay.querySelector(".ask-user-attribution");
  const input = overlay.querySelector(
    ".ask-user-input",
  ) as HTMLInputElement | null;
  const choiceBtns = Array.from(
    overlay.querySelectorAll<HTMLButtonElement>(".ask-user-choices button"),
  );
  return {
    request_id: active.request.request_id,
    kind: active.request.kind,
    title: titleEl?.textContent ?? "",
    body: bodyEl?.textContent ?? null,
    attribution: attEl?.textContent ?? "",
    unsafe: active.request.unsafe === true,
    inputValue: input?.value,
    choiceIds:
      choiceBtns.length > 0
        ? choiceBtns.map((b) => b.dataset["askUserChoice"] ?? "")
        : undefined,
    confirmRevealed:
      active.request.kind === "confirm-command"
        ? active.confirmRevealed
        : undefined,
  };
}

/** Click the button matching `value`. For text, also typing the
 *  given string before pressing the submit button. Returns true
 *  on a recognized action. */
export function submitActiveAskUserModal(value: string): boolean {
  if (!active) return false;
  const overlay = active.overlay;
  const kind = active.request.kind;
  if (kind === "text") {
    const input = overlay.querySelector(
      ".ask-user-input",
    ) as HTMLInputElement | null;
    if (!input) return false;
    input.value = value;
    const submit = overlay.querySelector(
      '[data-ask-user-button="submit"]',
    ) as HTMLButtonElement | null;
    submit?.click();
    return true;
  }
  if (kind === "yesno") {
    const btn = overlay.querySelector(
      `[data-ask-user-button="${value}"]`,
    ) as HTMLButtonElement | null;
    if (!btn) return false;
    btn.click();
    return true;
  }
  if (kind === "choice") {
    const btn = overlay.querySelector(
      `[data-ask-user-choice="${value}"]`,
    ) as HTMLButtonElement | null;
    if (!btn) return false;
    btn.click();
    return true;
  }
  // confirm-command: only "run" submits, and only after ack.
  if (kind === "confirm-command") {
    if (value !== "run") return false;
    const run = overlay.querySelector(
      '[data-ask-user-button="run"]',
    ) as HTMLButtonElement | null;
    if (!run) return false;
    run.click();
    return true;
  }
  return false;
}

export function cancelActiveAskUserModal(): boolean {
  if (!active) return false;
  const btn = active.overlay.querySelector(
    '[data-ask-user-button="cancel"]',
  ) as HTMLButtonElement | null;
  if (!btn) return false;
  btn.click();
  return true;
}

/** confirm-command only — taps "I understand" to reveal the Run
 *  button. Returns true on success, false if the active modal isn't
 *  a confirm-command or is already revealed. */
export function ackActiveAskUserModal(): boolean {
  if (!active) return false;
  if (active.request.kind !== "confirm-command") return false;
  if (active.confirmRevealed) return false;
  const ack = active.overlay.querySelector(
    '[data-ask-user-button="ack"]',
  ) as HTMLButtonElement | null;
  if (!ack) return false;
  ack.click();
  return true;
}
