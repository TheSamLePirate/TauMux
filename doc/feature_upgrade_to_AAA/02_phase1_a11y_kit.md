# Phase 1 — A11y kit

**Parent plan:** `00_master_plan.md`
**Tracking doc:** `doc/tracking_feature_upgrade_to_AAA_phase1.md`
**Status:** In progress — started 2026-05-16.
**Owner:** webview.
**Engineer-weeks:** ~1.5 (high confidence).
**Lifts:** Process Manager B→A, Command Palette B→A, Settings Panel B→A, Ask-user B→A, Cheatsheet A→S, Notifications B→A, Sidebar B→A, Tau primitives A→S, Terminal Effects B→A (with the JS canvas guard).

---

## Goal

Five feature grades sit at B specifically because their modals lack `role="dialog"` / `aria-modal` / focus trap / focus restore (U1, HIGH). A shared a11y helper lifts all five in one PR per modal — the highest single-step leverage in the entire programme.

Phase 1 also ships the reduced-motion blanket verification (the I.2/I.3 rules landed in Phase 0 but never gated), the sidebar roving-tabindex fix (U12), IME composition guards on text inputs (U15), and a touch-target shim for mobile mirror (U5/I.5).

---

## Steps

### Step 1 — Build the modal-host helper

`src/views/terminal/a11y/modal-host.ts` — a class that wraps any element and applies:

- `role="dialog"` + `aria-modal="true"` on the overlay element.
- `aria-labelledby` / `aria-describedby` plumbing via an options interface.
- Focus trap — `keydown` listener on the host that intercepts Tab / Shift+Tab and cycles focus among the focusable descendants. Computes the focusable set on each Tab press (cheap, handles dynamically-shown content).
- Focus restore — on close, restore focus to the element that was `document.activeElement` when the host opened.
- Escape-to-close — optional `escapeCloses` flag (default true).
- Scrim click — optional `scrimCloses` flag (default true); the click on the overlay backdrop (not the inner panel) triggers close.
- Lifecycle: `open()` / `close()` / `destroy()`. All listeners attached via a single `AbortController` so `destroy()` is one call.

The helper does NOT own the DOM — callers provide the overlay element and an inner panel. This keeps it composable with the existing modal implementations (Process Manager, Command Palette, Settings Panel, Ask-user, Cheatsheet).

Tests: `tests/views/a11y/modal-host.test.ts` (happy-dom) — open/close lifecycle, focus restore, tab cycle, shift-tab cycle, escape closes, scrim click closes, listeners removed on destroy.

### Step 2 — Apply to Process Manager (⌘⌥P)

Wire `ModalHost` into `src/views/terminal/process-manager.ts`. The overlay element already exists; just hand it to the host with the right options. Adds:
- `role="dialog"` + `aria-modal="true"`.
- `aria-labelledby` pointing to the title.
- Focus trap inside the panel.
- Escape closes (already partially wired; consolidate).

Tests: extend `tests/process-manager.test.ts` (creating it — `B` → `A` requires actual coverage).

### Step 3 — Apply to Command Palette (⌘⇧P)

Wire `ModalHost` into `src/views/terminal/command-palette.ts`. Replace the existing per-listener Escape handler with the host's. Add an **IME composition guard** on Enter: capture `compositionstart`/`compositionend` on the input and skip the Enter handler while `isComposing` (U15).

Tests: extend `tests/command-palette-destroy.test.ts` with focus-trap + IME tests.

### Step 4 — Apply to Settings Panel

Wire `ModalHost` into `src/views/terminal/settings-panel.ts`. Two extra a11y improvements:
- **IME composition guards** on every text input.
- **aria-invalid** on number inputs when the entered value falls outside the [min, max] clamp range. Surface a help text via `aria-describedby` pointing to a per-field error span.

Tests: extend `tests/settings-panel-theme.test.ts` (rename to `settings-panel.test.ts`) with modal lifecycle + clamp-feedback tests.

### Step 5 — Apply to Ask-user modal

Wire `ModalHost` into `src/views/terminal/ask-user-modal.ts`. This is the U1 HIGH item. The four kinds (yesno / choice / text / confirm-command) all share the same modal shell; one helper application covers all four.

Tests: extend `tests/ask-user-modal-dom.test.ts` with focus-trap + restore.

### Step 6 — Strengthen Keyboard Cheatsheet

The cheatsheet already has `role="dialog"` + `aria-modal` + focus-restore (per Phase 0 audit), but no true focus trap — tab can escape into the underlying terminal. Wire `ModalHost` to add the trap. Lifts Cheatsheet A→S.

Tests: extend `tests/keyboard-cheatsheet-render.test.ts`.

### Step 7 — Sidebar roving-tabindex (U12)

Replace `tabindex="-1"` on the workspace list with a roving-tabindex pattern:
- One element in the list has `tabindex="0"` at any time (the "currently focused" workspace card).
- The rest have `tabindex="-1"`.
- Arrow up/down move the `tabindex="0"` and `.focus()` together.
- Home / End jump to first / last.
- Enter activates (calls existing `selectWorkspaceById`).

Tests: extend `tests/sidebar-state.test.ts` with key-handling assertions (or a new `tests/sidebar-roving-tabindex.test.ts`).

### Step 8 — Touch target shim (U5/I.5)

Add `src/web-client/min-target.css` (mirror-only initially, since the native webview is desktop) — a media query for `(pointer: coarse)` that bumps `.chip-*`, `.toast`, `.surface-tab-close` to at least 44 × 44 px hit area.

Tests: a Playwright mobile-viewport test asserting no interactive element has a bounding box below 44 × 44 px on the mirror.

### Step 9 — ARIA labels + live regions (U7/U8)

- Git-status chips get `aria-label` describing the dirty state (e.g. "dirty: 3 unstaged, 1 staged").
- A new `aria-live="polite"` region in the sidebar announces notification count changes.
- Error toasts get a copy button (U8) with `aria-label="Copy error text"`.

### Step 10 — Reduced-motion verification (I.2/I.3)

The CSS blanket landed in Phase 0 (PR 21). Add a JS guard in `terminal-effects.ts` so the WebGL bloom layer also halts under `matchMedia("(prefers-reduced-motion: reduce)")`. Tests assert the JS check is in place.

---

## Per-step acceptance criteria

| Step | Acceptance |
|---|---|
| 1 | `tests/views/a11y/modal-host.test.ts` covers open/close/focus-restore/tab/shift-tab/escape/scrim/destroy. |
| 2 | Process Manager overlay has `role="dialog"`, `aria-modal`, focus trap, focus restore. Tests assert each. |
| 3 | Command Palette has the same + IME guard. Tests assert each. |
| 4 | Settings Panel has the same + IME guards + `aria-invalid` feedback. Tests assert each. |
| 5 | Ask-user modal has the same. U1 closed. |
| 6 | Cheatsheet has a true focus trap; tab cycles within. |
| 7 | Sidebar workspace list is keyboard-reachable; arrow / Home / End / Enter work. |
| 8 | Mirror touch targets all ≥ 44 × 44 px under coarse pointer. |
| 9 | Git chips have aria-label; notification count live-announced. |
| 10 | `terminal-effects.ts` honours `prefers-reduced-motion`. |

---

## Lifts to track in `feature_grades.json`

- `process-manager` B → A (after Step 2 + tests).
- `command-palette` B → A (after Step 3).
- `settings-panel` B → A (after Step 4).
- `ask-user` B → A (after Step 5).
- `keyboard-cheatsheet` A → S (after Step 6).
- `notifications` B → A (after Step 9 — copy button + live region).
- `sidebar` B → A (after Step 7).
- `tau-primitives` A → S (after the design tokens are confirmed unchanged + reduced-motion in primitives — partial here, full in P5).
- `terminal-effects` B → A (after Step 10).

---

## Rollback

Each step lands as its own PR with bump:patch. Rollback = `git revert` of the specific PR.

The modal-host helper is additive — applying it to a modal doesn't change visible behaviour, just adds the trap + restore + ARIA attrs. Worst case the trap could feel "sticky" if the focusable set is computed wrong; the test suite asserts the cycle.

---

## Open questions

1. **focusable selector:** the standard set is `a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])`. Confirm this covers every interactive element we use. (Resolved at start of Step 1.)
2. **Where to declare the `[lang]` for screen readers?** The app is English-only today; deferred until i18n lands.
3. **Should the touch-target shim apply to native (Electrobun) too?** Native is desktop-only; deferred.

---

## Exit criteria

- All seven modals pass an axe-core scan with zero serious/critical violations. (axe-core gate landed as part of Step 11 closing.)
- Tab cycle stays inside each modal.
- Escape closes each modal.
- Focus restores on close.
- `bun test` green.
- `feature_grades.json` updated; `bun run report:feature-grades:check` green.
