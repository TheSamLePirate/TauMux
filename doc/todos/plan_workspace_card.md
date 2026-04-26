# Plan 06 — Sidebar workspace card: flicker fix + modular settings

## Source quote

> # Sidebar Workspace card:
> - flicker on refresh...
> - Add settings for what is shown and how, modular

## Two distinct issues

### A. Flicker on refresh

The workspace card visibly flickers when data updates (1 Hz metadata
poll, or any sidebar event). Symptoms typically come from one of:

1. **Full innerHTML replace** — every refresh tears the DOM down and
   rebuilds it, so the browser re-paints from scratch.
2. **No keyed reconciliation** — child rows get re-created instead of
   updated in place.
3. **Layout thrash** — a forced reflow sequence triggers visible
   resize.

#### Investigation

```sh
rg "innerHTML\s*=" src/views/terminal/sidebar.ts src/views/terminal/sidebar-state.ts
rg "render(All|Workspaces|WorkspaceCard)" src/views/terminal/sidebar.ts
```

Likely fix: convert the card-render path to a stable diff:

- One element per workspace; key by `workspace.id`.
- Each subfield (name, color dot, surfaces, status pills, log preview)
  has a stable child element; the renderer updates `textContent` /
  attributes, never replaces.
- Use `requestAnimationFrame` to batch updates within a single tick;
  don't render twice when both the metadata-poll event and a focus
  event fire in the same ms.

#### Implementation

- Refactor `renderWorkspaceCard()` to a constructor that returns a
  `WorkspaceCardView` object with `update(state)` semantics.
  Pattern:
  ```ts
  interface WorkspaceCardView {
    el: HTMLElement;
    update(workspace: WorkspaceState, ...): void;
    destroy(): void;
  }
  ```
- The parent (`sidebar.ts` outer loop) keeps a `Map<workspaceId, WorkspaceCardView>`,
  diffs add/remove on workspace list change, calls `update` on every
  refresh.
- Same pattern for inner rows (status pills, log entries).

#### Tests

- `tests/sidebar-card-stability.test.ts` (new) — render card; capture
  `el.firstElementChild`; `update()` with new data; assert
  `el.firstElementChild` is the same DOM node (no replace).

### B. Modular settings — what to show and how

Today the workspace card shows: name + color dot, surface chips,
status pills (`htStatuses`), CPU/MEM aggregate, log tail. The user
wants each of these to be opt-in/out.

#### Proposed settings

In `AppSettings.workspaceCard`:

```ts
workspaceCard: {
  density: "compact" | "comfortable" | "spacious";
  show: {
    surfaceChips: boolean;
    cpuMem: boolean;
    statusPills: boolean;
    logTail: boolean;
    progressBar: boolean;
    notificationBadge: boolean;
  };
  logTailLines: number; // 0..10
  statusPillOrder: string[]; // overrides default order
};
```

#### Settings UI

New section under Sidebar:

- Density radio
- Checkbox per `show.*` field
- Slider for `logTailLines` (0–10)
- Drag-reorder list for `statusPillOrder`

Persistence: lives in the same JSON the existing `SettingsManager`
debounces.

#### Card rendering changes

- Wrap each subfield in a stable `<section>` with class indicating its
  kind. CSS `display: none` when toggled off (so the slot stays in DOM
  for stable reconciliation).
- Density: a CSS variable `--ws-card-density` (compact = 0.75rem
  padding, comfortable = 1rem, spacious = 1.5rem) that scales padding
  and font-size.
- Order: the renderer reads `statusPillOrder` and re-orders the pills
  via DOM moves (not full re-render).

## Files

- `src/views/terminal/sidebar.ts` — extract `WorkspaceCardView` class.
- `src/views/terminal/sidebar-state.ts` — verify it's pure state, no
  DOM in here.
- new `src/views/terminal/sidebar-workspace-card.ts` — the
  `WorkspaceCardView` (split from `sidebar.ts` since it's getting
  thick).
- `src/shared/settings.ts` — `workspaceCard` field + defaults.
- `src/views/terminal/settings-panel.ts` — new section.
- `src/views/terminal/index.css` — density vars, opt-out display rules.

## Tests

- Card-stability test (above).
- `tests/sidebar-card-settings.test.ts` — toggle each `show.*`, assert
  the corresponding section gets `display: none`.
- Snapshot via design report — capture all three densities so changes
  in metrics get caught.

## Effort

M — ~1 day for the diff-based renderer, ~half day for settings UI,
~half day for tests + design baselines. Total ~2 days.

## Risks

- The flicker may be aggravated by a wider issue (font swap, reflow
  during sidebar resize — see Plan #14 line-height bug). Verify the
  fix on its own; if flicker persists, revisit.
- Reordering pills via DOM moves (not re-render) preserves event
  listeners but is fiddly to get right. Keep it simple: re-append in
  desired order; that re-parents in place, no listener loss.
