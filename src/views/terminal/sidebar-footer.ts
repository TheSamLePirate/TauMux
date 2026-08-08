/**
 * Sidebar footer — the always-visible service strip, extracted from
 * `sidebar.ts`.
 *
 * Two read-only pills (Telegram, Web Mirror) and one control: Claude
 * Code permission auto-approve.
 *
 * Auto-approve earns a control rather than a readout because it is the
 * one setting in this app that can act on the user's machine while they
 * are not looking — it answers permission prompts for a coding agent.
 * Before this it lived behind ⌘, → General (or `ht claude auto-approve`),
 * which meant the state was invisible exactly when it mattered: you
 * could not tell, at a glance, whether the agent in the pane next door
 * was being supervised. The pill states the answer at all times and
 * flips it in one click.
 *
 * It renders as a real `<button>` with `aria-pressed`, so it is
 * reachable by keyboard and announced as a toggle — the sibling pills
 * stay `<div>`s because they are not actionable.
 */

import { createIcon } from "./icons";
import { htEvents } from "../../shared/event-bus";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import type { AppSettings } from "../../shared/settings";
import type { TelegramStatusWire } from "../../shared/types";

/** The two `AppSettings` fields the pill reflects. Taken as a slice
 *  rather than a bespoke shape so callers can hand over the settings
 *  object they already have. */
export type AutoApproveState = Pick<
  AppSettings,
  "claudeAutoApprove" | "claudeAutoApproveDelayMs"
>;

/**
 * Builds the footer and owns its element refs. The sidebar keeps a
 * reference and forwards status pushes; nothing else reaches in.
 */
export class SidebarFooter {
  readonly root: HTMLElement;

  private telegramDot: HTMLElement;
  private telegramLabel: HTMLElement;
  private telegramValue: HTMLElement;
  private serverDot: HTMLElement;
  private serverUrl: HTMLElement;
  private autoApproveBtn: HTMLButtonElement;
  private autoApproveDot: HTMLElement;
  private autoApproveValue: HTMLElement;
  private autoApprove: AutoApproveState = DEFAULT_SETTINGS;

  constructor() {
    const row = document.createElement("div");
    row.className = "sidebar-server-row";

    // ── Telegram ──
    const tgRow = document.createElement("div");
    tgRow.className = "sidebar-server-pill";
    this.telegramDot = document.createElement("div");
    this.telegramDot.className = "sidebar-server-dot offline";
    tgRow.appendChild(this.telegramDot);
    tgRow.append(createIcon("messageCircle", "sidebar-server-icon", 11));
    this.telegramLabel = document.createElement("span");
    this.telegramLabel.className = "sidebar-server-label";
    this.telegramLabel.textContent = "Telegram";
    tgRow.appendChild(this.telegramLabel);
    this.telegramValue = document.createElement("span");
    this.telegramValue.className = "sidebar-server-url";
    this.telegramValue.textContent = "Disabled";
    tgRow.appendChild(this.telegramValue);
    tgRow.title = "Telegram — disabled";

    // ── Web mirror ──
    const wmRow = document.createElement("div");
    wmRow.className = "sidebar-server-pill";
    this.serverDot = document.createElement("div");
    this.serverDot.className = "sidebar-server-dot offline";
    wmRow.appendChild(this.serverDot);
    wmRow.append(createIcon("globe", "sidebar-server-icon", 11));
    const serverLabel = document.createElement("span");
    serverLabel.className = "sidebar-server-label";
    serverLabel.textContent = "Web Mirror";
    wmRow.appendChild(serverLabel);
    this.serverUrl = document.createElement("span");
    this.serverUrl.className = "sidebar-server-url";
    this.serverUrl.textContent = "Offline";
    wmRow.appendChild(this.serverUrl);

    // ── Claude Code auto-approve (actionable) ──
    this.autoApproveBtn = document.createElement("button");
    this.autoApproveBtn.type = "button";
    this.autoApproveBtn.className =
      "sidebar-server-pill sidebar-server-pill-action sidebar-auto-approve";
    this.autoApproveDot = document.createElement("div");
    this.autoApproveDot.className = "sidebar-server-dot offline";
    this.autoApproveBtn.appendChild(this.autoApproveDot);
    this.autoApproveBtn.append(createIcon("shield", "sidebar-server-icon", 11));
    const aaLabel = document.createElement("span");
    aaLabel.className = "sidebar-server-label";
    aaLabel.textContent = "Auto-approve";
    this.autoApproveBtn.appendChild(aaLabel);
    this.autoApproveValue = document.createElement("span");
    this.autoApproveValue.className = "sidebar-server-url";
    this.autoApproveBtn.appendChild(this.autoApproveValue);
    // Fire and forget: the host persists the flip through the normal
    // settings pipeline and echoes it back via `setAutoApprove`. The
    // pill never flips itself optimistically — if the write fails, the
    // dot must not claim a state the engine isn't in.
    this.autoApproveBtn.addEventListener("click", () => {
      htEvents.emit("ht-set-auto-approve", {
        enabled: !this.autoApprove.claudeAutoApprove,
      });
    });

    row.append(tgRow, wmRow, this.autoApproveBtn);
    this.root = row;
    this.applyAutoApprove();
  }

  setWebServerStatus(running: boolean, port: number, url?: string): void {
    this.serverDot.classList.toggle("online", running);
    this.serverDot.classList.toggle("offline", !running);
    if (running && url) {
      this.serverUrl.textContent = `:${port}`;
      this.serverUrl.title = url;
    } else {
      this.serverUrl.textContent = "Offline";
      this.serverUrl.title = "";
    }
  }

  setTelegramStatus(status: TelegramStatusWire): void {
    const dot = this.telegramDot;
    dot.classList.remove("online", "offline", "starting", "error", "conflict");
    let valueText = "—";
    switch (status.state) {
      case "polling":
        dot.classList.add("online");
        valueText = "Polling";
        break;
      case "starting":
        dot.classList.add("starting");
        valueText = "Starting…";
        break;
      case "conflict":
        dot.classList.add("conflict");
        valueText = "Conflict";
        break;
      case "error":
        dot.classList.add("error");
        valueText = "Error";
        break;
      case "disabled":
      default:
        dot.classList.add("offline");
        valueText = "Disabled";
        break;
    }
    const parts = [`Telegram — ${status.state}`];
    if (status.botUsername) parts.push(`@${status.botUsername}`);
    if (status.error) parts.push(status.error);
    const title = parts.join(" · ");
    dot.title = title;
    this.telegramLabel.title = title;
    this.telegramValue.textContent = status.botUsername
      ? `@${status.botUsername}`
      : valueText;
    const pill = dot.parentElement;
    if (pill) pill.title = title;
  }

  /** Reflect the live `claudeAutoApprove` / `claudeAutoApproveDelayMs`
   *  settings. Called from every settings apply, so the pill agrees with
   *  Settings, the command palette, and `ht claude auto-approve`. */
  setAutoApprove(state: AutoApproveState): void {
    this.autoApprove = state;
    this.applyAutoApprove();
  }

  private applyAutoApprove(): void {
    const on = this.autoApprove.claudeAutoApprove;
    // "armed" rather than "online": green would read as healthy, and an
    // agent approving its own commands unattended is a state to notice,
    // not to be reassured by. Amber is the agent colour (§7).
    this.autoApproveDot.classList.toggle("armed", on);
    this.autoApproveDot.classList.toggle("offline", !on);
    this.autoApproveBtn.classList.toggle("active", on);
    this.autoApproveValue.textContent = on ? "On" : "Off";
    this.autoApproveBtn.setAttribute("aria-pressed", on ? "true" : "false");
    const title = on
      ? `Claude Code auto-approve is ON — permission prompts in terminal panes are answered for you after ${this.autoApprove.claudeAutoApproveDelayMs} ms. Click to turn off.`
      : "Claude Code auto-approve is OFF — permission prompts wait for you. Click to turn on.";
    this.autoApproveBtn.title = title;
    this.autoApproveBtn.setAttribute("aria-label", title);
  }
}
