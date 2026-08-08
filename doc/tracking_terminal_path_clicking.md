# Tracking — clickable paths in terminal output

Session of 2026-08-08. Goal: clicking a path in a terminal pane resolves it
correctly and opens it in the right kind of pane.

**Commit:** `40df3fd0` — feat(terminal): clickable paths open the right pane
(v0.16.0). Branch `feat/claude-code-terminal`, not pushed.

## Starting state — what was actually broken

The plumbing existed (`terminal-links.ts` → `ht-open-file-in-editor` →
`splitEditorSurface`) but leaked information at every hop:

| # | Defect | Where |
|---|--------|-------|
| 1 | `cwd` computed, then dropped — relative paths resolved against τ-mux's own launch dir, silently opening the wrong file or nothing | `views/terminal/index.ts` listener read only `path`/`create` |
| 2 | `~/x` resolved to `<cwd>/~/x`; `isAbsoluteish()` also suppressed the cwd for `~`, so it broke on both ends | `bun/editor-files.ts:resolveEditorPath` |
| 3 | `line` parsed by the matcher, then discarded — every file opened at line 1 | `surface-manager.ts` omitted it from the event |
| 4 | Images hit `looksBinary()` → "Binary files cannot be edited" | `bun/editor-files.ts:readEditorFile` |
| 5 | Every click made a new split — a 6-frame stack trace shredded the layout | no reuse logic existed |
| 6 | Missing paths and directories still opened a pane whose only content was an error | no existence check before linking |

## Decisions

- **Image panes reuse the `editor` surface kind** rather than adding an
  eighth `SurfaceKind`. Persistence, layout restore, `ht editor open` and
  the sidebar explorer are all already keyed on a path; a new kind would
  duplicate all of it for a read-only viewer. The pane is now a *file*
  pane: text → CodeMirror, image → viewer, SVG → sandboxed preview.
  (User chose this over the dedicated-kind option.)
- **Reuse-or-split**: same file → focus + jump locally (no re-read, so
  scroll/undo survive); different file → retarget the last-focused clean
  file pane; nothing safe to reuse → split. ⌥-click always splits. A
  dirty pane is never retargeted.
- **Only existing paths are underlined.** The probe runs on hover (xterm
  calls `provideLinks` per row hover, not per row rendered), so the cost
  is one bounded `lstat` batch behind a TTL cache.
- **SVG renders through `shared/sideband-sandbox.ts`** (`<iframe sandbox>`,
  no scripts, no same-origin, strict CSP). An SVG is an executable
  document that arrived because it scrolled past in terminal output; the
  user pointing at it is not the user vouching for it. This is the sink
  CLAUDE.md's fd4 rule exists to protect.

## New modules

| File | Role |
|------|------|
| `src/shared/file-kind.ts` | pure: extension→MIME, magic-byte sniffing, `text \| image \| svg \| binary` |
| `src/bun/file-probe.ts` | resolve + `lstat` + classify a bounded batch; optional thumbnails |
| `src/views/terminal/file-link-service.ts` | TTL cache + request correlation in front of `probeFilePaths` |
| `src/views/terminal/file-link-controller.ts` | routing policy (reveal / focus+jump / retarget / split) |
| `src/views/terminal/file-link-tooltip.ts` | hover card: resolved path, size, mtime, thumbnail |
| `src/views/terminal/sidebar-reveal.ts` | pure path arithmetic for "expand the tree to here" |
| `src/views/terminal/editor-events.ts` | editor / file-pane DOM events → RPC, extracted from `index.ts` |
| `src/shared/wrapped-file-reference.ts` | pure: rejoin references a terminal or an app split across rows |
| `src/views/terminal/settings-auth-token.ts` | the web-mirror auth-token settings row, extracted from `settings-panel.ts` |
| `src/views/terminal/sidebar-file-actions.ts` | file-explorer "+" button + new-file name rules, extracted from `sidebar.ts` |

## Deviations from the plan

- **The module-size ratchet forced real extraction.** The first pass grew
  all four baselined god modules; `tests/audit-module-size.test.ts`
  rejected it. Rather than promote the baseline wholesale, the work was
  extracted into the modules above. Net effect across the session on the
  frozen modules: **−134 lines** (`settings-panel.ts` −97,
  `views/terminal/index.ts` −51, `sidebar.ts` −21, `bun/index.ts` −15,
  `agent-panel.ts` −1, `surface-manager.ts` +8). The baseline was
  re-promoted so every module that shrank is now ratcheted tighter.
- **`bun/index.ts`**: `createEditorWorkspaceSurface` + `splitEditorSurface`
  collapsed into one `openEditorSurface(opts)` taking an options object.
  Five positional params were about to become seven.
- **`--line` / `--column` added to `ht editor open` / `editor.split`** for
  parity — not in the original ask, but the RPC now carries the fields
  and leaving the CLI unable to use them would be an odd gap.
- **New keyframe `file-row-reveal`** needed a rationale entry in
  `scripts/audit-animations.ts` (§10 state-vs-ornament gate).

## Verification

- `bun test` — **3922 pass, 0 fail** (was 3742; +180 new across
  `file-kind`, `file-probe`, `terminal-file-links`,
  `wrapped-file-reference`, `sidebar-reveal`, `editor-pane`,
  `prompt-dialog`, `sidebar-file-actions`, `settings-panel-network`,
  `browser-url-helpers`).
- `bun run typecheck` clean; `bun run lint` clean (2 pre-existing warnings
  in `examples/extensions/nebula`).
- Live, against a dev instance (`HT_SOCKET_PATH` → the dev config dir):
  - `ht editor open notes.ts --cwd <dir>` resolved to
    `<dir>/notes.ts` — **defect #1 confirmed fixed end-to-end**;
  - opening a `.png` flipped the pane chip from `error` to `image`;
    on stashed pre-change code the same file gave "Binary file" —
    **defect #4 confirmed fixed**.

## Round 2 — user-reported defects

### 7. References split across rows were dead

The first pass matched one row at a time and documented skipping wrapped
references as a deliberate simplification. That was the wrong call for
this app: the pane is rarely wide enough for an absolute path, so the
references people most want to click are exactly the split ones. Neither
half responded to hover or click.

Two different splits, handled separately in
`src/shared/wrapped-file-reference.ts`:

- **Soft wrap** — xterm sets `isWrapped`, nothing was inserted, join is
  exact.
- **Application hard wrap** — the program re-flowed its own output and
  emitted a newline plus an indent. Claude Code's transcript does this
  constantly. Nothing in the byte stream says the indent is decoration;
  recovering the path means *guessing*.

The guess is safe only because of the probe: the module deliberately
**over-generates** (the un-joined reading *and* every successive join),
and the caller keeps only what exists on disk. A wrong join names a file
that isn't there and disappears. `pickNonOverlapping` then prefers the
longest existing reading, so a real directory that happens to be a
prefix of the wrapped path loses to the full path.

Two properties worth keeping in mind when touching this:

- Candidates are emitted **hovered-row-first**, because the probe batch
  is capped (`MAX_PROBE_PATHS = 32`); if a busy row over-generates past
  the cap it must be the speculative joins that get cut, never the plain
  reading of the row under the pointer.
- Rows are never merged *before* matching. An earlier design did, and
  `edited src/a.ts` + `  and more` became one greedy token that
  destroyed the real reference. Pinned by a regression test.

### 8. A dirty editor pane could not be closed

`requestCloseEditor` / `reloadEditor` used the DOM `confirm()`. Inside
the Electrobun webview that modal never opens and the call returns
`false`, so the guard swallowed the close forever — the pane was
unclosable until saved. Both now use `showConfirmDialog` from
`prompt-dialog.ts` (the in-app sheet the rest of the UI already uses),
titled "File not saved", with **Discard and close** / **Keep editing**.

Then fixed the other two callers of the same trap:

- **Remove extension** (command palette) — the extension could never be
  removed.
- **Regenerate web-mirror auth token** — did nothing *once a token
  existed*; with an empty token the guard short-circuited, which is why
  it looked like it worked.

Both now use `confirmDestructive(title, message, confirmLabel, onConfirm)`
in `prompt-dialog.ts` — callback rather than promise, because every call
site is a DOM handler that only cares about the "yes" branch.

Fitting the settings change under the ratchet started as line-golf,
which was the wrong instinct; the ratchet's own advice is "put new code
in a new module". Extracted the whole auth-token row into
`settings-auth-token.ts` (~90 lines, two dependencies on its host).
`generateAuthToken` moved with it and is re-exported from
`settings-panel.ts` so existing importers and tests keep their entry
point. Result: settings-panel **−97**, index.ts **−51**.

Then swept the rest. Every native browser modal is a trap here:
`confirm()` returns false, `prompt()` returns null, `alert()` draws
nothing. **Five** shipped call sites relied on one, and all five
silently did nothing:

| Call site | What was broken |
|---|---|
| `editor-pane.ts` close / reload | a dirty pane was unclosable |
| `index.ts` remove extension | extension could never be removed |
| `settings-panel.ts` regenerate token | no-op once a token existed |
| `sidebar.ts` new-file "+" | button entirely inert |
| `agent-panel.ts` rename session | clicking the name did nothing |

`showPromptDialog` gained a `validate?: (value) => string | null` hook so
a refused name explains itself **in place** and the sheet stays open —
strictly better than the `alert()` it replaces, which rendered nothing,
and better than a toast, which makes the user re-open the dialog.

There are now **no** native `confirm` / `alert` / `prompt` calls left in
`src/views/terminal/` or `src/web-client/`.

### 9. HTML files had only one reading

`coverage/index.html` is something you want to *look at*; `src/index.html`
is something you want to *edit*. The path cannot tell you which, so
neither wins:

- a plain click opens the source in the file pane;
- **⌘-click** on the terminal link opens the rendered page in a browser
  pane;
- the file pane grows a **Preview** button for previewable files.

The button is not redundant with the modifier — it is the reason the
feature is usable, since an undiscoverable modifier is not a feature.
It also means the capability still works if a webview swallows ⌘-click,
which could not be verified without a mouse.

`isPreviewablePath` / `fileUrlForPath` live in `shared/file-kind.ts`.
The URL builder escapes `#`, `?` and `%`: `encodeURI` preserves the
first two as URL syntax, but in a *filename* they are ordinary
characters and leaving them truncates the path. `isUrl` / `normalizeUrl`
in `browser-pane.ts` learned `file://` so a local preview round-trips
through the address bar instead of becoming `https://file:///…`.

Security note: routing local HTML to the browser pane is *safer* than
the alternatives, not riskier — the pane is a separate BrowserView,
whereas the file pane lives in the webview that holds the Electrobun RPC
bridge. That is the same reasoning that put SVG behind the sideband
sandbox.

## Open issue — NOT caused by this work

**The editor pane body does not paint in the dev build on this branch.**
The pane bar and its chips render, but `.editor-pane-body` (CodeMirror /
image view / status line) is invisible, and the bar sizes to its content
instead of the pane. Reproduced on **stashed, pre-change code** with a
fresh `hyperterm-canvas-dev` config on the `bridge` variant, for a plain
`.ts` file — so it predates this session. The installed
`/Applications/tau-mux.app` (older release) renders the same pane
correctly, which points at a regression somewhere earlier on
`feat/claude-code-terminal`. It blocked visual confirmation of the image
viewer; the DOM-level behaviour is covered by the happy-dom tests
instead. Worth a separate investigation.

## Not done

- `website-doc` not updated beyond the version stamp `bump:minor` writes
  into `{,fr/}{cli,api}/system.md`. The content backlog is in
  `doc/changes_to_document.md` awaiting a user-driven docs sweep (EN + FR).
- Not pushed.
