/**
 * Web-mirror auth-token row (Settings → Network).
 *
 * Shows the current token masked with a peek toggle, a copy button, a
 * one-click regenerate, and the LAN URL to paste into a phone. New
 * tokens go through the normal `updateSettings` pipeline so the running
 * web server picks them up.
 *
 * Lifted out of `settings-panel.ts`, which is a baselined god module
 * (scripts/audit-module-size.ts) — the ratchet's advice when a change
 * needs room is to put the code in a new module, and this row is a
 * self-contained ~90-line builder with exactly two dependencies on its
 * host.
 */

import type { AppSettings } from "../../shared/settings";
import { confirmDestructive } from "./prompt-dialog";

export interface AuthTokenRowDeps {
  /** The panel's shared label + control row builder. */
  fieldRow: (parent: HTMLElement, label: string) => HTMLElement;
  /** Dispatch a settings patch through the panel's usual pipeline. */
  emit: (partial: Partial<AppSettings>) => void;
}

/** 32 bytes of crypto-quality randomness as 64 hex chars; matches the
 *  bun-side default-on-empty fallback. `crypto.getRandomValues` exists
 *  in every modern webview. */
export function generateAuthToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

export function renderAuthTokenRow(
  c: HTMLElement,
  s: AppSettings,
  deps: AuthTokenRowDeps,
): void {
  const row = deps.fieldRow(c, "Auth Token");

  const wrap = document.createElement("div");
  wrap.className = "settings-color-wrap"; // re-use the input + button row layout

  const input = document.createElement("input");
  input.type = "password";
  input.className = "settings-input";
  input.value = s.webMirrorAuthToken;
  input.placeholder = "(no token — anyone on the LAN can connect)";
  input.style.flex = "1";
  input.setAttribute("aria-label", "Web mirror auth token");
  input.addEventListener("change", () => {
    deps.emit({ webMirrorAuthToken: input.value.trim() });
  });

  /** The three buttons on this row differ only by label. */
  const segment = (label: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "settings-segment";
    b.textContent = label;
    return b;
  };

  const peekBtn = segment("Show");
  peekBtn.setAttribute("aria-pressed", "false");
  peekBtn.addEventListener("click", () => {
    const peeking = input.type === "text";
    input.type = peeking ? "password" : "text";
    peekBtn.textContent = peeking ? "Show" : "Hide";
    peekBtn.setAttribute("aria-pressed", peeking ? "false" : "true");
  });

  const copyBtn = segment("Copy");
  copyBtn.title = "Copy auth token to clipboard";
  copyBtn.addEventListener("click", () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(input.value);
        copyBtn.textContent = "Copied";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 1100);
      } catch {
        /* clipboard unavailable — silent */
      }
    })();
  });

  const regenBtn = segment("Regenerate");
  regenBtn.title =
    "Replace with a fresh 32-byte hex token. Existing connections must reconnect.";
  const regenerate = (): void => {
    const next = generateAuthToken();
    input.value = next;
    deps.emit({ webMirrorAuthToken: next });
  };
  regenBtn.addEventListener("click", () => {
    // Nothing to lose when there is no token yet, so skip the ask.
    if (s.webMirrorAuthToken.length === 0) return regenerate();
    // NOT the DOM `confirm()`: inside the Electrobun webview that modal
    // never opens and returns false, so this button did nothing at all
    // once a token existed.
    confirmDestructive(
      "Replace auth token",
      "Connected web mirror clients will need to reconnect with the new URL.",
      "Regenerate",
      regenerate,
    );
  });

  wrap.append(input, peekBtn, copyBtn, regenBtn);
  row.appendChild(wrap);

  // Show the LAN URL the user can paste into a phone / laptop.
  if (s.webMirrorAuthToken.length > 0) {
    const note = document.createElement("div");
    note.className = "settings-field-note";
    note.style.marginTop = "6px";
    const hostname =
      typeof window !== "undefined" && window.location.hostname.length > 0
        ? window.location.hostname
        : "<your-host>";
    note.textContent = `Mirror URL: http://${hostname}:${s.webMirrorPort}/?t=${s.webMirrorAuthToken.slice(0, 6)}…`;
    note.title =
      "Token is truncated for display. Use Copy to grab the full URL.";
    c.appendChild(note);
  }
}
