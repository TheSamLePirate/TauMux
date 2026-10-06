/**
 * Settings search — cross-section field filtering for the settings
 * panel.
 *
 * With 45+ fields across ten sections, "I know the knob exists but not
 * where it lives" was the panel's biggest navigability gap. Typing in
 * the search box renders every section's fields and hides the ones
 * whose label/note text doesn't match; section chrome (titles, descs)
 * with zero visible fields is hidden wholesale so the result list is
 * pure signal.
 *
 * Extracted from settings-panel.ts to keep that module under its
 * size-ratchet ceiling; the panel owns the query state and the
 * render-branch, this module owns the DOM mechanics.
 */

export interface SettingsSearchInput {
  el: HTMLInputElement;
  /** Current trimmed, lowercased query ("" when idle). */
  query(): string;
  clear(): void;
}

/** Build the header search box. `onChange` fires on every query change
 *  (including clears); the panel re-renders in response. */
export function createSettingsSearchInput(onChange: () => void): SettingsSearchInput {
  const el = document.createElement("input");
  el.className = "settings-search";
  el.type = "search";
  el.placeholder = "Search settings…";
  el.setAttribute("aria-label", "Search settings");

  const state = { value: "" };

  el.addEventListener("input", () => {
    state.value = el.value.trim().toLowerCase();
    onChange();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.value) {
      e.stopPropagation();
      el.value = "";
      state.value = "";
      onChange();
    }
  });

  return {
    el,
    query: () => state.value,
    clear: () => {
      el.value = "";
      state.value = "";
    },
  };
}

/** Hide non-matching `.settings-field` rows (and the chrome of emptied
 *  sections) inside a rendered-all-sections container. Appends a
 *  "no matches" line when nothing survives. */
export function filterSettingsContent(
  content: HTMLElement,
  query: string,
  rawQuery: string,
): void {
  // Defensive lowercase: callers are expected to pre-normalize, but a
  // raw "AUTH" must still match — the cost is one toLowerCase.
  const q = query.trim().toLowerCase();
  if (!q) return;
  let visible = 0;
  // Fields are grouped under their section title/desc chrome in DOM
  // order; a title group with no matching field is hidden wholesale.
  let chrome: HTMLElement[] = [];
  let chromeHasVisible = false;
  const flushChrome = () => {
    if (!chromeHasVisible) {
      for (const el of chrome) el.style.display = "none";
    }
    chrome = [];
    chromeHasVisible = false;
  };
  for (const child of Array.from(content.children) as HTMLElement[]) {
    if (child.classList.contains("settings-section-title")) {
      flushChrome();
      chrome.push(child);
      continue;
    }
    if (
      child.classList.contains("settings-section-desc") ||
      child.classList.contains("settings-info-note")
    ) {
      chrome.push(child);
      continue;
    }
    if (child.classList.contains("settings-field")) {
      const text = (child.textContent ?? "").toLowerCase();
      if (text.includes(q)) {
        visible++;
        chromeHasVisible = true;
      } else {
        child.style.display = "none";
      }
    }
  }
  flushChrome();
  if (visible === 0) {
    const empty = document.createElement("div");
    empty.className = "settings-search-empty";
    empty.textContent = `No settings match "${rawQuery}"`;
    content.appendChild(empty);
  }
}
