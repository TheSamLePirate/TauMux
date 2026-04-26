# Plan 14 — Misc audits: git-author audit, sidebar resize line-height bug

## Source quotes

> #add a audit that check if my name is in git olivierveinand (it is !!!)
>
> issue with line height (i think) on sidebar resize

Two small, independent items grouped in one plan because each is
short.

---

## A. Git-author audit

### What

On startup (or as part of `ht doctor` from Plan #01), verify that the
machine's `git config user.name` matches the expected canonical value
`olivierveinand`. If not, surface a sidebar warning and offer a one-
click fix.

### Why

The user noticed a wrong git identity slipped through and they want a
canary for it.

### Implementation

#### Audit module

`src/bun/audits.ts` (new) — collection of small startup checks. Each
audit returns:

```ts
interface AuditResult {
  id: string;
  ok: boolean;
  severity: "info" | "warn" | "err";
  message: string;
  fix?: { label: string; action: () => Promise<void> };
}
```

First audit:

```ts
async function gitUserAudit(): Promise<AuditResult> {
  const expected = settings.gitUserNameExpected ?? "olivierveinand";
  const out = await $`git config --global user.name`.text();
  const actual = out.trim();
  if (actual === expected) return { id:"git-user", ok:true, severity:"info", message:`git user.name = ${actual}` };
  return {
    id:"git-user",
    ok:false,
    severity:"warn",
    message:`git user.name is "${actual}", expected "${expected}"`,
    fix: {
      label: `Set git user.name to "${expected}"`,
      action: async () => { await $`git config --global user.name ${expected}`; },
    },
  };
}
```

#### Where to run

- Once at startup; result attached to the system-health summary
  (Plan #07).
- Also exposed via `ht audit list` / `ht audit run <id>` /
  `ht audit fix <id>`.
- Sidebar shows warn-level audits as a dismissable banner with a
  "Fix" button if the audit provides one.

#### Settings

- `audits.gitUserName.expected: string | null` — when null the audit
  is skipped (so other users of the project don't get a warning).

### Files

- new `src/bun/audits.ts`
- new `src/bun/rpc-handlers/audit.ts`
- `bin/ht` — `audit` subcommand
- `src/views/terminal/sidebar.ts` — warn banner
- `src/shared/settings.ts` — `audits.gitUserName.expected`
- `src/views/terminal/settings-panel.ts` — input field

### Tests

- `tests/audit-git-user.test.ts` — mock `$` to return matching /
  mismatched values; assert `ok` flag.

### Effort

S — half a day.

---

## B. Sidebar resize → line-height issue

### What

When the user resizes the sidebar (drags the splitter), terminal
content appears to render with a different line-height. Could be:

- xterm font metric recompute on container width change picking a
  fractional cell height;
- the recent default-line-height-1.0 commit (`bc961e6`) interacting
  with reflow;
- workspace-card-driven flicker (Plan #06) presenting as line-height
  jitter.

The recent commit `bc961e6 fix: set default terminal line height to
1.0 for authentic rendering` is suspicious — that change might have
introduced a sub-pixel rendering issue that only shows under resize.

### Investigation

1. Reproduce: drag sidebar slowly while a busy terminal renders text;
   look for visible line-height jumps.
2. Inspect computed style on `.xterm-viewport > div` before / after
   the drag.
3. Check whether `term.options.lineHeight` is being mutated mid-drag
   (e.g. by `applySettings` running on a settings event that fires
   during resize).
4. Check `fit()` calls during drag — they recompute rows/cols and may
   round in a way that shifts vertical layout.

### Likely fixes

- Pin xterm internal line-height computation to integer-px cells
  (option `lineHeight: 1.0` should already do this — verify the fit
  computation doesn't override).
- Throttle `fit()` to once per animation frame during drag.
- Avoid running `applySettings` from inside the drag handler —
  decouple the panes resize from settings reapplication.

### Files

- `src/views/terminal/surface-manager.ts` — fit throttling.
- `src/views/terminal/pane-drag.ts` — verify drag handler doesn't
  trigger settings re-apply.
- `src/views/terminal/index.css` — confirm no transform/scale that
  amplifies fractional pixels.

### Tests

- `tests/terminal-resize-line-height.test.ts` — virtual resize, then
  read `getComputedStyle(.xterm-rows).lineHeight`; assert it equals
  `(fontSize * lineHeight)px` and is integer.

### Effort

S — bug-hunt + minimal patch + regression test. ~half day.

---

## Combined effort

S — both items together fit in a single day.

## Risks

- Audits can become noisy fast. Cap startup audits to truly
  user-actionable items; everything else lives in `ht doctor` /
  on-demand.
- The line-height bug may be a red herring tied to the workspace card
  flicker (Plan #06). Verify under controlled reproduction.
