# Tracking — every `ht` config knob reachable from Settings + sidebar auto-approve control

Ask (2026-08-08): *"make every config from the ht commands be accessible in the
settings of the app. Also, for auto-approve, add a visual element on the sidebar
to see the state and a button to enable/disable it."*

## Audit — what `ht` can configure vs. what Settings could reach

| `ht` surface | Persists to | In Settings before this change? |
| --- | --- | --- |
| `claude auto-approve [on\|off] [--delay]` | `claudeAutoApprove`, `claudeAutoApproveDelayMs` | yes (General) |
| `autocontinue set --engine/--dry-run/--cooldown/--max/--model/--api-key-env` | `autoContinue.*` | yes (Auto-continue) |
| `claude install [--features …]` / `claude uninstall` | `~/.claude/settings.json` hooks + statusLine | **no — CLI only** |
| `shell-integration install\|uninstall` | `~/.zshrc` / `~/.bashrc` OSC 133 block | **no — CLI only** |
| `extension enable\|disable\|remove` | extensions registry (`enabled` flag) | **no — palette had open/edit/remove, no enable/disable** |
| `telegram *` | — (runtime actions only) | n/a |

Additionally four `AppSettings` fields had no renderer at all (settings.json
hand-editing only): `webMirrorBind`, `browserPartitionMode`,
`auditsGitUserNameExpected`, `bgBase`.

## Constraint that shaped the implementation

`tests/audit-module-size.test.ts` pins `settings-panel.ts` (2308),
`sidebar.ts` (3715), `views/terminal/index.ts` (3181) and `bun/index.ts` (3357)
at their current size — they may shrink, never grow. Every addition therefore
had to be paid for with an extraction first.

## Plan

1. `src/shared/integrations.ts` — wire types (no node imports; the webview reads them).
2. `src/bun/integrations.ts` — status/install/uninstall over the pure planners already
   in `src/cli/claude-settings-edit.ts` + `src/cli/shell-integration.ts`.
3. `src/bun/webview-handlers/integrations.ts` — Electrobun message slice.
4. `src/views/terminal/settings-layout-section.ts` — extraction (frees budget).
5. `src/views/terminal/settings-integrations.ts` — the new Settings → Integrations section.
6. `src/views/terminal/sidebar-footer.ts` — extraction + auto-approve pill.
7. `src/views/terminal/auto-approve-control.ts` — toggle plumbing shared by palette + sidebar.
8. Missing-field renderers (Network / Browser / Theme / Advanced).
9. Tests + docs note.

## Progress

- [x] 1 shared types
- [x] 2 bun integrations module
- [x] 3 webview-handler slice
- [x] 4 layout-section extraction
- [x] 5 Settings → Integrations
- [x] 6 sidebar footer + auto-approve pill
- [x] 7 auto-approve control module
- [x] 8 orphan settings fields
- [x] 9 tests

## Verification

- `bun run typecheck` clean; `bun test` 3742 pass / 0 fail (45 new tests across
  5 files). `audit:emoji`, `audit:animations`, `audit:guideline` clean.
- Module-size ratchet re-promoted **downwards**: settings-panel 2308 → 2056,
  sidebar 3715 → 3633, views/terminal/index 3181 → 3179.
- Real app (`bun start`): the sidebar pill renders under Telegram / Web Mirror
  and follows a `ht claude auto-approve off` issued from a pane — CLI, settings
  and sidebar agree live. Settings shows the new Integrations nav entry.
- `readIntegrationsStatus()` on this machine matches `ht claude doctor` exactly
  (16/17 hooks wired, approvals missing, statusline user-defined), which is the
  property that matters: one planner, two front ends.
- Not verified by a click in the real app: the Integrations section's own
  buttons. Synthetic clicks don't reach the WKWebView and the native e2e
  harness has no click primitive (it drives `__test.*` RPCs). The section is
  covered by 12 DOM tests against the real `SettingsPanel` class instead.

## Deviations / notes

- The install actions ride the **Electrobun** webview channel, not new socket
  RPC methods: `ht claude install` already does this work locally (and must keep
  working with the app closed), so a second socket entry point would duplicate
  it and pull `website-doc` churn in for no user-visible gain.
- Auto-approve stays in Settings → General *and* gains a mirror row in
  Integrations; moving it would have broken the existing General-section tests
  for no benefit.

## Commits

- `2d275f58` — feat(settings): every `ht` config knob reachable from the app
  (v0.15.0). Whole change in one commit: shared/bun/webview modules, the two
  extractions that paid for it, 5 test files, baseline re-promotion.
