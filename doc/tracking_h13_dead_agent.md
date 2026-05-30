# Tracking — H13: crashed pi-agent surface no longer silently swallows input

Source: `doc/full_app_review_2026-05.md` §10.4 (H13, high).

## Problem

When a `pi --mode rpc` subprocess exits (crash / OOM / self-exit), the
manager-level `onExit` hook evicts the instance from the registry
(`index.ts:260` → `piAgentManager.removeAgent`). But the agent **panel** only
appended a system message on `agent_exit` — the input textarea, send button,
pickers, and toolbar stayed **enabled**. Every subsequent command then hit
`getAgent(id) → undefined` and was a silent no-op: the user typed, saw the
message echo locally, got zero response, with no indication and no restart path.

## Fix

### Core (the bug) — `src/views/terminal/agent-panel.ts`

- Added `dead: boolean` + `exitCode: number | null` to `AgentPanelState`.
- New `setAgentDead(view, code)` latches the state on `agent_exit`: disables the
  input + send button, hides the streaming indicator, reveals the dead banner,
  and pins the footer to `Agent exited (code N)`. Called **last** in the
  `agent_exit` case so it wins over `syncStreamingUI` (which would otherwise
  re-enable the send button).
- Gated `submitInput()` and `handleInputKeydown()` on `s.dead` — defense in
  depth beyond the disabled input, so no keystroke is ever silently swallowed.

### Recovery — restart wired end-to-end

- New `onRestart(surfaceId, { provider, model, thinkingLevel })` callback in
  `AgentPanelCallbacks`, fired by a **"Restart agent"** button in the banner
  (carries the model/provider/thinking the panel knew).
- `AgentSurfaceController` emits `ht-agent-restart` on the typed `htEvents` bus
  (new `AgentRestartPayload` + map entry in `src/shared/event-bus.ts`).
- `src/views/terminal/index.ts` listens and runs two **existing, proven** RPC
  paths in order: `createAgentSurface` (a fresh agent, same config) then
  `closeSurface` (drops the dead husk). `rpc.send` preserves order.

### Styling — `src/views/terminal/index.css`

`.agent-dead-banner` (+ `-hidden`, `-text`, `.agent-dead-restart-btn`): a red
exit notice with an accent restart button, above the input bar.

## Verification

- `bun run typecheck` — clean. `bun run lint` — 0.
- `bun test tests/agent-panel.test.ts` — 14 pass (11 + 3 new): exit latches
  dead/disables UI/reveals banner/footer code; dead pane's keydown submits
  nothing; Restart button fires `onRestart` with the panel's model/provider.
- `bun test` — 3010 pass / 0 fail.
- `bun start` — webview bundle rebuilt with the change; boots clean.

## Deviations / notes

- **Restart placement.** `createAgentSurface` (no split) opens the replacement
  in a **new workspace** (the same well-tested path the "new agent" command
  uses) rather than in-place where the dead pane sat. True in-place restart
  would need split-from-dead + collapse-on-close, which depends on a
  focus-ordering race and pane-tree collapse behavior I can't GUI-verify here;
  deferred in favor of composing two proven operations. The husk is closed so
  nothing lingers.
- **cwd fidelity.** The panel doesn't track its cwd, so the restarted agent
  uses the host's default cwd resolution (`focused surface snapshot ??
  process.cwd()`). provider/model/thinking ARE preserved. Minor; noted for a
  follow-up if faithful cwd restore is wanted.

## Commit

- bump: `bun run bump:patch`
- commit: (filled at commit time)
