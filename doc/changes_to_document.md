# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

_Backlog cleared 2026-08-02 — full sweep folded the desktop-performance wave
(v0.4.8 → v0.4.11), the audit-remediation wave (v0.4.12), AND the entire
august-plan Claude Code integration (M1 v0.5.0 → M4-partial v0.7.1) into:_

- `website-doc/src/content/docs/changelog.md` (en + fr) — three new top
  sections: **"0.7.1 — Claude Code integration (milestones 1–3)"**,
  **"0.4.12 — Audit remediation"**, **"0.4.11 — Desktop performance"**.
- `integrations/claude-code.md` (en + fr) — full rewrite around the
  three-planes architecture (event / data / decision), the task mirror,
  `ht claude install/doctor`, the skill v2, and the agent-teams pill.
- **NEW** `features/claude-code-pane.md` (en + fr) — the native pane:
  open flow, streamed transcript + tool cards, permission modes,
  interrupt, Sessions picker, lifecycle/restore semantics.
- **NEW** `cli/claude.md` (en + fr) — `ht claude statusline / sessions /
  install / uninstall / doctor / event` with the installer safety
  contract and the approvals opt-in.
- **NEW** `api/claude.md` (en + fr) — `claude.event / statusline /
  sessions` with payload shapes and registry semantics.
- `configuration/settings.md` (en + fr) — `rpcSocketRequireToken`
  default flip (`false` → `true`, v0.4.12) + new `terminalRenderer`
  field (experimental, DOM fallback, v0.4.12 persisted-`webgl`
  migration).
- `web-mirror/auth-and-hardening.md` (en + fr) — RPC socket token
  section rewritten as on-by-default; first-party clients present it
  automatically; third-party escape hatch.
- `cli/extensions.md` + `api/extensions.md` (en + fr) — `enable` /
  `disable` verbs (enforcement note), install trust note, no more
  `bun x` network fallback, per-instance dev ports.
- `api/system.md` + `cli/system.md` (en + fr) — version 0.7.1
  (auto-propagated by `bump-version.ts`).

_(Site builds clean: `cd website-doc && bun run build` — 149 pages.)_

_(Always add new items below this line. When folding into the website,
clear the backlog by overwriting the pending entries with a fresh
"Backlog cleared <date> — …" summary like the one above.)_
