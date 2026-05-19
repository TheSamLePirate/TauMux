# Tracking — pi-generated conversation title in the Claude sidebar pill

**Plan source:** conversation 2026-05-19 (no separate plan doc — design captured below)
**Started:** 2026-05-19
**Scope:** `claude-integration/ht-bridge/` only. No τ-mux core changes; no version bump (the bridge is not packaged with the app).

## Goal

Replace the current "first-clause-of-prompt" label in the **Claude** sidebar pill (set by `UserPromptSubmit`) with a two-phase flow:

1. Pill flips immediately to `Starting…` in a muted color (`#cdd6f4`).
2. A detached `pi -p` sidecar generates a 3-5 word title via `openai/gpt-5-nano` (thinking off), then updates the pill to the title in the existing pink (`#f5c2e7`).
3. On subsequent prompts within the same session, the previous title is passed as context so pi can refine instead of replacing — "Investigate flaky CI timeout" → "Investigate macOS CI Timeout" as scope clarifies.

## Pre-flight verification (done before implementing)

| Test | Command shape | Result |
|------|---------------|--------|
| Fresh title (turn 1) | `pi -p --model openai/gpt-5-nano --thinking off --no-tools --no-session …` | `Investigate flaky CI timeout` — clean 4 words |
| Refinement (turn 2) | same + "Previous title: …" in stdin | `Investigate macOS CI Timeout` — refined as desired |
| Latency baseline | very short prompt | ~2.0s wall — well under the 5s timeout budget |

## Design decisions (locked at start)

| Decision | Choice | Why |
|----------|--------|-----|
| Model | `openai/gpt-5-nano` with `--thinking off` | User pick. Cheap (~$0.0001/title), sub-second. |
| Refinement | Pass previous title to pi each turn | Lets the title crystallise as scope clarifies. |
| Starting color | Muted `#cdd6f4`, then pink `#f5c2e7` on title | Clear visual that work is being staged. |
| Failure mode | Best-effort, 5s timeout, silent on failure | Aligns with the bridge's "never block, never fail loudly" principle. |
| Idle / permission pills | Keep replacing text (`Waiting for input` / `Approval needed`) | Preserves current behavior; title returns on next prompt. |
| Race between sidecar and Stop | Sidecar always updates state.currentTitle (so next turn has context), but only touches the pill if `state.promptActive` | Avoids a "ghost" pill after Stop. |
| Title disable escape hatch | `titleEnabled` config + `HT_CLAUDE_TITLE_ENABLED` env, falls back to old `truncateLabel(prompt)` path | Keeps the bridge usable if pi is broken / OpenAI key missing. |
| Pricing tracking | Out of scope | Title sidecar spend (~$0.0001/turn) not added to the `cc` ticker. Cleaner to keep that ticker tied to the actual session's transcript. |

## Execution log

| PR / step | Item | Status | Commit | Notes |
|-----------|------|--------|--------|-------|
| 1 | Tracking doc | landed | — | This file. |
| 2 | `index.ts` — Config + SessionState extensions | landed | 3a378f47 | Added `titleEnabled`, `titleStartingLabel`, `titleNeutralColor`, `titleSidecarTimeoutMs`, `titlePiBin`, `titlePiArgs` to Config; `currentTitle`, `promptActive` to SessionState. Env overrides for `HT_CLAUDE_TITLE_ENABLED` and `HT_CLAUDE_PI_BIN`. |
| 3 | `index.ts` — handlePrompt rewrite + spawnTitleSidecar | landed | 3a378f47 | Pill flips to `Starting…` (`#cdd6f4`); `spawnTitleSidecar` re-invokes the same script with argv `["title", sessionId]` detached + unref. `titleEnabled=false` keeps the original first-clause label path. |
| 4 | `index.ts` — handleTitle (new) + sanitizer + runTitleSidecar | landed | 3a378f47 | Builds the generation prompt (previous title + new prompt → 3-5 word rule), spawns `pi` with a 5s SIGTERM timeout, sanitizes output (strip quotes, markdown prefixes, cap to `labelMaxChars`). Re-loads state before writing so a concurrent Stop wins for `promptActive`. |
| 5 | `index.ts` — handleStop / handleNotifyIdle / handleNotifyPermission update promptActive | landed | 3a378f47 | All three set `promptActive=false`. Stop notification title now prefers `currentTitle` over `currentLabel`. |
| 6 | `config.json` — new optional fields | landed | 3a378f47 | Added title fields with `_titleNote` explanation. |
| 7 | `claude-integration/ht-bridge/README.md` — Title generation section | landed | 3a378f47 | New "Title generation" section with phase table, env vars, requirements, disabling. |
| 8 | `claude-integration/README.md` — pi-mirror table refresh | landed | 3a378f47 | Haiku-label row now reads "pi -p --model openai/gpt-5-nano sidecar". Footnote rewritten for the detached/unref'd architecture. |
| 9 | Manual smoke test (turn 1, turn 2, pi missing, disabled, stop) | passed | — | Turn 1: `Refactor to JWT authentication` at t=2s. Turn 2 with same session: `DynamoDB Based Refresh Flow Consistency` (refined correctly). pi-missing: `currentTitle=""` silent. `titleEnabled=0`: `currentLabel` populated, `currentTitle=""`. Stop: `promptActive=false`, title preserved. |

## Deviations from plan

(track here)

## Issues encountered

(track here)

## Out of scope

- Pricing model for `gpt-5-nano` sidecar spend in the `cc` ticker.
- Automated tests — the bridge has no test harness today (fire-and-forget shell hook). Verification stays manual via the smoke recipe.
- Idle / permission pills surfacing the title (could be a follow-up: keep title text + flip color).
- Typecheck integration — `claude-integration/` is outside the project's `tsconfig.json include` (`src/**/*`), so `bun run typecheck` won't catch errors here. Verification is via `bun run` of the script during smoke tests.

## Smoke test recipe

```bash
# 1. baseline — pill should show "Starting…" then a real title
echo '{"session_id":"smoke-1","prompt":"Investigate a flaky test in the billing suite"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts prompt
# wait 1–3s, check Claude pill

# 2. refinement — title should refine, not replace
echo '{"session_id":"smoke-1","prompt":"actually it only fails on macOS"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts prompt

# 3. pi missing — pill should freeze at "Starting…"
HT_CLAUDE_PI_BIN=/nonexistent echo '{"session_id":"smoke-2","prompt":"hi"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts prompt

# 4. disabled — pill should still show first-clause label
HT_CLAUDE_TITLE_ENABLED=0 echo '{"session_id":"smoke-3","prompt":"refactor auth"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts prompt

# 5. stop should carry the title into the notification
echo '{"session_id":"smoke-1","transcript_path":""}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts stop
```
