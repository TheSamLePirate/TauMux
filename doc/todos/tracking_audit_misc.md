# Tracking — Plan 14 part A: git-author audit

**Plan**: [`plan_audit_misc.md`](plan_audit_misc.md) (part A only)
**Status**: part A done; part B deferred
**Status changed**: 2026-04-26
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

Part A only — git-author audit. Part B (sidebar resize line-height
bug) needs live UI reproduction which is not possible in this
environment. Logged as deferred.

## Step-by-step progress

- [x] `src/bun/audits.ts` — `Audit` / `AuditResult` shapes,
      `gitUserAudit` (with `GitRunner` hook for hermetic tests),
      `defaultAudits`, `runAudits`, `applyFix`
- [x] `tests/audits.test.ts` — 13 cases (match / mismatch / unset /
      thrown / fix-invokes / registry on/off / runner-passthrough /
      collected-in-order / broken-audit-doesnt-crash-runner /
      apply-fix-rerun / no-fix / not-in-registry)
- [x] `src/bun/rpc-handlers/audit.ts` — `audit.list` / `audit.run` /
      `audit.fix` (serialises `fix.action` away on the wire so JSON
      transport doesn't drop it silently)
- [x] `src/bun/rpc-handler.ts` — optional `audits` registry handle in
      `RpcHandlerOptions`; aggregator only installs the audit
      handlers when wired (test fixtures stay slim)
- [x] `bin/ht audit` subcommand — `list` (default) / `run` /
      `fix <id>`; pretty-printer with TTY ANSI markers, also exposed
      in `--help`
- [x] AppSettings: `auditsGitUserNameExpected: string | null`,
      default `"olivierveinand"` (the user's value per
      `issues_now.md`); validated as string|null
- [x] `updateSettings` rebuilds the audit registry when
      `auditsGitUserNameExpected` changes — flipped to null disables
      the audit on the fly
- [x] Run audits at startup once; log info results to stdout, warn
      results via `console.warn` so the rotating log captures them
- [x] `bun run typecheck` clean
- [x] `bun test` — 965/965 pass (was 952; +13 audit tests)
- [x] `bun run bump:patch` — 0.2.4 → 0.2.5
- [ ] Commit — next

## Deferred

- **Sidebar warn banner with "Fix" button** — UI work that benefits
  from visual verification. Tracked as a follow-up.
- **Settings panel input field for the expected git user.name** —
  same. The runtime fall-back to `"olivierveinand"` (the user's value
  per `issues_now.md`) is sensible until we have UI. The setting
  field is wired so power users can override via `settings.json`.
- **Sidebar line-height bug (Plan #14 part B)** — needs live repro
  on the running app.

## Deviations from the plan

1. **No sidebar warn banner** in this commit. The plan called for a
   dismissible sidebar banner with a "Fix" button when warn-level
   audits surface; deferred because that's UI work that benefits
   from visual verification. The data is on hand (`audit.list`
   returns the cached results); a future follow-up can light it up
   in `sidebar.ts` quickly.
2. **No Settings panel input field** for `auditsGitUserNameExpected`.
   Same reason as the banner. Power users can edit the value in
   `settings.json` directly (`validateSettings` accepts both string
   and null); UI input lands when we revisit Settings polish.
3. **`AuditFix.action` is stripped on the wire**. The plan didn't
   specify; I went with `serialise()` returning `fixAvailable`
   (boolean) + `fixLabel` (string) so the CLI / future UI know a
   fix exists and what it does. Applying still requires
   `audit.fix <id>` so the click path is explicit.
4. **`updateSettings` rebuilds the registry on the fly** rather than
   waiting for a restart. Cheap (no shell-out yet); makes the
   "disable for collaborators" flow ergonomic — set to null in
   settings, audit disappears immediately.

## Issues encountered

(none — typecheck and tests passed first try after each edit)

## Open questions

- Should the audit run on every startup, or only on first launch
  per session? Going with "every startup" — it's cheap (one
  subprocess call) and the user's original ask was a *canary*
  against a wrong identity slipping through.

## Verification log

(empty)

## Commits

(empty)
