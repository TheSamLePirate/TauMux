# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

_Backlog cleared 2026-08-08 — **whole-repo docs sync** (`docs/sync-app-state`).
The 0.10.1 → 0.10.8 backlog below was folded into the site (EN + FR), and the
repo-level docs were audited against the source for the first time since
v0.2.81._

What that sweep covered:

- **Website (EN + FR)** — changelog gained 0.10.1 through 0.10.8 (it stopped
  at 0.10.0). `integrations/claude-code.md` gained the
  `AskUserQuestion`/`ExitPlanMode` exclusion, the retraction behaviour, and
  the per-prompt (not per-transition) firing rule. `features/plan-panel.md`
  gained the clear control, inline step detail, progress bar and freshness
  stamp.
- **README.md** — was stale since v0.2.81 (~8 minor versions). Corrected:
  metadata poller is libSystem FFI (~5 ms/tick), not `ps` + `lsof` (~200 ms);
  12 theme presets defaulting to τ, not 10 defaulting to Obsidian; 3419 tests
  across 278 files, not "1500+ across 100"; `@xterm/xterm` 6.0, not 5.3;
  Bun 1.3.14. Added the seven surface kinds, agent integrations, 83 CLI
  commands, 139 RPC methods across 17 domains, the fd4 sandbox, the real
  keybinding set (`⌘\`, `⌘G`, `⌘⇧?` were missing), and the four CI jobs.
- **CLAUDE.md / AGENTS.md** — same factual corrections. AGENTS.md was a stale
  *copy* of CLAUDE.md that still claimed fd4 content was unsandboxed; the two
  are now byte-identical with a note saying to keep them that way.
- **doc/system-process-metadata.md** — the "full spec" had zero mentions of
  the FFI path. Added the two-implementation table, the self-validation
  contract, real per-tick costs, and a troubleshooting entry for "is the
  native path actually being used?".
- **doc/system-claude-integration.md** — stopped at 0.7.1. Added the terminal
  approval plane (0.10.x) in full: the six safety rules, why it counts
  announcements rather than transitions, the question-exclusion mechanism and
  its deliberate limitation, and registry persistence.
- **doc/system-plan-panel.md** — added the 0.10.5 card controls and the
  `PlanStore.update` description-dropping fix.

Not touched, deliberately: `doc/tracking_*.md`, `doc/todos/*`, `.pi/plans/*`,
`code_reviews/*` and the dated `full_app_review_*` / analysis docs. Those are
historical records of what was true on a given date — rewriting them to match
today would destroy the record rather than update it.

_(Always add new items below this line. When folding into the website, clear
the backlog by overwriting the pending entries with a fresh
"Backlog cleared <date> — …" summary like the one above.)_
