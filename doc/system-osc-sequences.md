# Supported OSC sequences

τ-mux is built on xterm.js, which already handles the long tail of
standard OSCs (window title, default colours, hyperlinks, clipboard,
shell integration marks). This document tracks the OSCs τ-mux *adds
behaviour to* on top of the xterm defaults — i.e. the ones that
produce τ-mux-specific UI side effects.

## Inventory

| OSC      | Meaning                                  | Handled by              | τ-mux side effect                                                                  |
| -------- | ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| 0 / 2    | Window / icon title                      | xterm + `onTitleChange` | Renames the surface (cap 60 chars; `fromOsc: true` so it doesn't override pane manual rename) |
| 4        | Set ANSI palette                         | xterm                   | None — palette change rendered by xterm                                            |
| 7        | Working directory hint                   | xterm                   | None — surface metadata poller is the source of truth for cwd                      |
| 8        | Hyperlink                                | xterm web-links addon   | Click → opens via `ht-open-external` event (URL allowlist applies)                |
| 9;4      | **Progress reporting**                   | τ-mux                   | Bridges to the workspace progress bar (see below)                                  |
| 11       | Default background                       | xterm                   | None                                                                               |
| 52       | Set clipboard                            | τ-mux (`@xterm/addon-clipboard`, v0.11.2) | **Write-only**, gated: the payload lands on the macOS system clipboard via bun. Reads are refused (a program must never scrape the clipboard). See `src/views/terminal/terminal-clipboard.ts`. |
| 133      | Shell integration semantic marks         | τ-mux (v0.12.0)         | **Command blocks**: prompt/command/output/exit-code boundaries feed `ht blocks` (see below). Requires the optional hooks from `ht shell-integration install`; without them the metadata poller remains the ground truth. |

The xterm-handled OSCs are listed for completeness so someone debugging
an OSC-related bug can see at a glance whether τ-mux is in the loop.

> Doc note (2026-10): this table previously claimed OSC 52 and 133 had
> "no τ-mux side effect" — stale rows from before v0.11.2/v0.12.0
> shipped exactly those features. If a row here ever disagrees with
> the code again, the code wins; please fix the row.

---

## OSC 133 — command blocks

With the optional shell hooks installed (`ht shell-integration install`,
zsh + bash), τ-mux sees the semantic marks a shell emits around every
command: prompt start, command start, output start, command finished
(with its exit code). Those boundaries are recorded as **command
blocks** — what ran, where, how long it took, what it returned — and
exposed over the socket API:

```sh
ht blocks                    # last finished command, with output
ht blocks list --limit 10    # recent history
ht blocks current            # what's running right now
ht blocks --surface surface:2
```

Design notes:

- **Strictly optional.** The process-metadata poller (cwd / foreground
  command / ports, via libSystem FFI) stays the zero-config ground
  truth; blocks add command-boundary and exit-code facts on top.
- **Safe outside τ-mux.** The rc line sources `$HT_SHELL_INTEGRATION_PATH`,
  which only exists inside τ-mux PTYs — the same rc file is inert in
  iTerm2, over SSH, and in CI.
- **Duplicate marks are deduped** — a shell that emits its own OSC 133
  (or tmux passing them through) can't double-record a block.

Implementation: `src/cli/shell-integration.ts` (installer),
`src/bun/rpc-handlers/blocks.ts` (socket surface), `command-blocks.test.ts`.

---

## OSC 9;4 — progress reporting

### Wire format

```
ESC ] 9 ; 4 ; <state> ; <progress> ESC \
```

| state | Meaning           | Renders as                                  |
| ----- | ----------------- | ------------------------------------------- |
| `0`   | Remove            | Clears the workspace progress bar           |
| `1`   | Normal            | Bar fills to `<progress>` percent           |
| `2`   | Error             | Bar at last known level, label = "error"    |
| `3`   | Indeterminate     | Bar holds, label = "working…"               |
| `4`   | Paused            | Bar at last known level, label = "paused"   |

`<progress>` is `0..100` integer percent. Empty / missing for states
0 / 3, optional for 2 / 4 (we use the last known level when omitted).
Out-of-range values are clamped; non-numeric values reject the message
entirely.

### Behaviour

- Wired in `src/views/terminal/surface-manager.ts` via
  `term.parser.registerOscHandler(9, …)`. The handler delegates to
  `parseOsc94Payload` (a pure function in
  `src/views/terminal/osc-progress.ts`) and bridges to
  `SurfaceManager.setProgress` / `clearProgress` for the surface's
  workspace.
- Falls back to the default xterm handler when the OSC 9 payload
  doesn't match the `4;…` sub-command, so other OSC 9 dialects (cwd
  notifications etc.) keep working.
- Gated by `AppSettings.terminalOsc94Enabled` (default **on**).
  Settings → Advanced has the toggle.

### Examples

```bash
# Show 73% normal progress
printf '\e]9;4;1;73\e\\'

# Mark error (red bar at last known level)
printf '\e]9;4;2\e\\'

# Indeterminate ("working…")
printf '\e]9;4;3\e\\'

# Clear
printf '\e]9;4;0\e\\'
```

Modern build tools that emit OSC 9;4 unconditionally:

- `cargo` (since v1.74)
- `ninja` (any version)
- `pv` with `-N` (with appropriate plugin)
- Most Rust CLI tools using `indicatif` ≥ 0.17

### Why the workspace progress bar (not a per-pane chip)

The workspace progress bar (`SurfaceManager.setProgress`) already
exists and is wired through to the web mirror. Reusing it gives every
caller a single source of truth, regardless of whether progress came
from a script (`ht set-progress`), an agent, or a build tool's OSC.
A per-pane chip can be added later if multi-pane progress diverges
visibly.

---

## Adding a new OSC handler

1. Pure parser → new file under `src/views/terminal/` returning a
   typed `… | null`. Test it with table-driven cases (see
   `tests/osc-progress.test.ts` as the reference).
2. Register in `surface-manager.ts createSurface` via
   `term.parser.registerOscHandler(<id>, …)`. Always `return false` if
   the payload isn't yours so other handlers run.
3. Bridge to existing surfaces (`SurfaceManager.setProgress`,
   `setStatus`, `notification.create`) rather than inventing a new
   side-channel. Reuse the web-mirror broadcast that already attaches
   to those.
4. Gate with an `AppSettings` toggle if the behaviour is potentially
   disruptive. Default true unless there's a good reason.
5. Update the inventory table at the top of this doc.
