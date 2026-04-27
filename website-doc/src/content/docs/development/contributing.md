---
title: Contributing
description: PR workflow, code style, and the bits the project cares about.
sidebar:
  order: 4
---

τ-mux is a small, opinionated codebase. Contributions are welcome — please skim the constraints below before opening a large PR.

## Code style

- **TypeScript everywhere, ES modules.**
- **Minimal dependencies.** No frameworks in the webview. xterm.js is the only significant view dep.
- **Interface-heavy design, minimal class inheritance.**
- **Pure parsers.** Anything that turns subprocess output into structured maps is a pure function so it can be unit-tested without spawning processes.
- **Locale-robustness.** Any subprocess whose output we parse runs with `LC_ALL=C, LANG=C`. Decimal separators, thousand separators, and date formats vary by locale and have bitten us before.
- **Error handling.** try/catch with graceful degradation. Log errors, don't throw from callbacks. The metadata poller must never crash the main process — all subprocess runners return empty maps on failure.
- **Bun idioms.** Use `Bun.file(fd).stream()` for reading fds, `Bun.write(fd, data)` for writing.

## Constraints that won't bend

- **No node-pty.** `Bun.spawn` with `terminal: true` is the only PTY API.
- **No React.** Vanilla TypeScript + DOM in the webview.
- **Keyboard never goes to panels or chips.** All keystrokes go to xterm.js → stdin. Panels and chips are mouse-only (chip buttons are keyboard-focusable).
- **Each content block is its own DOM element.** Independent panels with CSS transforms, not a shared canvas.
- **PTY is the source of truth.** Canvas panels and metadata chips are ephemeral overlays — they never affect terminal state.

## PR workflow

1. **Branch.** From `main`. Name it `feature/<short>` or `fix/<short>`.
2. **Type-check + test.**

   ```bash
   bun run typecheck
   bun test
   ```

3. **End-to-end test if the change touches the web mirror, the webview, or shortcuts.**

   ```bash
   bun run test:e2e        # web mirror
   bun run test:native     # webview
   ```

4. **Bump the version.** Per the project's CLAUDE.md, run `bun run bump:patch` (or `:minor` / `:major`) before committing. If you don't, explain why in the PR.
5. **Open the PR.** Describe the *why* in 1–2 sentences. Reference the issue or feature plan if applicable.

## Reviewing

- The `crazyShell Reviewer` agent (`bun run review:agent`) runs a proposition-only review on demand and writes dated markdown reports to `code_reviews/`. Useful for self-review before pushing. See `doc/code-review-agent.md` for the workflow.

## Common patterns

See [Architecture deep-dive](/development/architecture/) for the patterns table:

- Adding a settings field
- Adding a CLI / socket command
- Adding a keyboard shortcut
- Adding a pane-bar chip
- Adding a non-PTY surface kind

## Logs

```bash
tail -f ~/Library/Logs/tau-mux/app-$(date +%Y-%m-%d).log
```

Tests redirect to `$HT_CONFIG_DIR/logs` so the real directory stays clean.

## License

MIT.
