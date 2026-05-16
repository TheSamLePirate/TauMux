// Triple-A I.11 / U11 — keyboard cheat-sheet rendered from the
// `KEYBOARD_BINDINGS` + `HIGH_PRIORITY_BINDINGS` arrays. Previously
// the bindings carried `id`/`description`/`category` "for a future
// help dialog" and nothing rendered them, so discoverability was
// purely tribal (read the README or hover specific buttons).
//
// Open with the `Help: Keyboard shortcuts` command from the palette
// (or via `keyboardCheatsheet.toggle()`). Closes on Escape or any
// click outside the panel.

import { escapeHtml } from "../../shared/escape-html";
import { ModalHost } from "./a11y/modal-host";

// The cheat-sheet only reads metadata fields — id, description,
// category, and the matcher's `display` property. The runtime ctx
// the bindings dispatch on is irrelevant here. Use a structural
// "info-only" view so the renderer accepts `Binding<KeyCtx>[]` from
// the call site without contravariance problems on the `when`
// predicate (which we never invoke).
type BindingInfo = {
  id: string;
  description?: string;
  category?: string;
  match: { display?: string } | ((e: KeyboardEvent) => boolean);
};

export class KeyboardCheatsheet {
  private overlay: HTMLDivElement;
  /** Stable inner panel — body contents replaced on each render(),
   *  but the panel element itself is reused so ModalHost keeps a
   *  consistent reference for focus-trap descendant lookup. */
  private panel: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private host: ModalHost;
  private visible = false;
  private bindings: ReadonlyArray<BindingInfo> = [];

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "kbd-cheatsheet hidden";
    document.body.appendChild(this.overlay);

    // Build the panel shell once. render() will replace bodyEl's
    // contents on each invocation.
    this.panel = document.createElement("div");
    this.panel.className = "kbd-panel";
    this.panel.setAttribute("role", "document");
    this.overlay.appendChild(this.panel);

    const header = document.createElement("header");
    header.className = "kbd-header";
    const title = document.createElement("h2");
    title.id = "kbd-cheatsheet-title";
    title.textContent = "Keyboard shortcuts";
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.className = "kbd-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    this.panel.appendChild(header);

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "kbd-body";
    this.panel.appendChild(this.bodyEl);

    const footer = document.createElement("footer");
    footer.className = "kbd-footer";
    footer.innerHTML = "<kbd>Esc</kbd> to close";
    this.panel.appendChild(footer);

    this.host = new ModalHost({
      overlay: this.overlay,
      panel: this.panel,
      labelledBy: "kbd-cheatsheet-title",
      onClose: () => this.hide(),
    });
  }

  setBindings(bindings: ReadonlyArray<BindingInfo>): void {
    this.bindings = bindings;
    if (this.visible) this.render();
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.overlay.classList.remove("hidden");
    this.render();
    this.host.open();
    this.host.focusFirst();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.classList.add("hidden");
    this.host.close();
  }

  isVisible(): boolean {
    return this.visible;
  }

  private render(): void {
    // Group by category, preserving binding order within each.
    const groups = new Map<string, BindingInfo[]>();
    for (const b of this.bindings) {
      if (!b.description) continue;
      const display = (b.match as { display?: string }).display ?? "";
      if (!display) continue;
      const cat = b.category ?? "Other";
      const arr = groups.get(cat) ?? [];
      arr.push(b);
      groups.set(cat, arr);
    }
    // Stable category order: known up front, then anything else
    // alphabetically.
    const knownOrder = [
      "App",
      "Workspace",
      "Pane",
      "Surface",
      "Browser",
      "Terminal",
      "Overlays",
      "Other",
    ];
    const sortedCats = [...groups.keys()].sort((a, b) => {
      const ai = knownOrder.indexOf(a);
      const bi = knownOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    const sections = sortedCats
      .map((cat) => {
        const items = groups.get(cat) ?? [];
        const rows = items
          .map((b) => {
            const keys = (b.match as { display?: string }).display ?? "";
            return `<li class="kbd-row"><kbd class="kbd-keys">${escapeHtml(keys)}</kbd><span class="kbd-desc">${escapeHtml(b.description ?? "")}</span></li>`;
          })
          .join("");
        return `<section class="kbd-section"><h3 class="kbd-cat">${escapeHtml(cat)}</h3><ul class="kbd-list">${rows}</ul></section>`;
      })
      .join("");

    this.bodyEl.innerHTML =
      sections || '<p class="kbd-empty">No shortcuts registered.</p>';
  }

  destroy(): void {
    this.host.destroy();
    if (this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
  }
}
