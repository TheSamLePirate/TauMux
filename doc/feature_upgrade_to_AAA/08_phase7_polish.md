# Phase 7 — Per-feature polish sweep

**Parent plan:** `00_master_plan.md`
**Tracking doc:** `doc/tracking_feature_upgrade_to_AAA_phase7.md`
**Status:** In progress (multi-session).
**Owner:** per-feature.
**Engineer-weeks:** ~4.0 (low confidence — long tail).

---

## Scope

The longest phase of the programme. Each named gap in `feature_grades.json` that wasn't covered by Phases 0–6 lands here, one feature-cluster at a time. The master plan's expectation is that this phase ships across multiple sessions; a single session picks a handful of high-leverage cheap items and ships them as one batch.

---

## Backlog (full)

Grouped by feature. Items already done in earlier phases are crossed off.

### Cluster A — cheap data-store polish

- **Cookie store** — URL-host normalize on insert; per-domain cap (currently only global LRU); export / import; privacy / clear command.
- **Browser history** — trailing-slash / `www.` dedup on insert; time-window filter; privacy / clear command.
- **Manifest scanner** — symlinked-`$HOME` handling (macOS data volume); 4× TTL idle-eviction test; symmetric Cargo / package.json parser depth.

### Cluster B — settings + plan + UI a11y polish

- **Plan panel** — RPC input validation on `state` strings (current impl normalises but doesn't reject); configurable audit-ring size; mirror persists audit across page reload.
- **Settings panel** — reset-to-default per field; `aria-invalid` feedback on number inputs that silently clamp; IME composition guards on text inputs.
- **Sidebar** — drop indicator on drag-reorder; Escape cancel; `aria-live` on reorder; mirror parity for CWD file explorer; symlink-cycle guard.
- **ARIA chip labels + live regions** — git-status chips, notification count.

### Cluster C — auto-continue + notifications + telegram

- **Auto-continue** — paused-surfaces persistence across restart; per-session firing metrics; cap-hit warning.
- **Notifications** — copy button + detail expansion; persistent history sidebar; configurable overlay cap.
- **Telegram bridge** — message TTL / DB pruning.

### Cluster D — terminal + editor + browser polish

- **Terminal search** — regex toggle; case-sensitivity toggle; persisted history across sessions.
- **Editor pane** — save-race conflict UX; line-ending convert on save; split keyboard shortcut.
- **Browser pane** — navigation-rule validation with diagnostics; zoom persistence; `findInPage` CLI binding.
- **OSC progress** — per-pane chips (not just workspace-level).

### Cluster E — observability polish

- **SurfaceMetadataPoller** — stale-git skip-tick; rot detection when WS mute >10 s; deeper tree-diff than `tree.length`.
- **Audits** — more audits (locale, node, shell capabilities); auto-rerun on settings change.
- **Health checks** — remediation `fix()` equivalent; UI badge wiring; staleness auto-demotion.
- **Event writer** — queued writes + backpressure; per-channel rate limits.
- **Tau focus audit** — Playwright-runnable assertion (out-of-scope for P7 — owned by P8).

### Cluster F — architecture long-tail (heavy refactors)

These match the items deferred from P2 (Architecture detoxification). Each is one PR's worth of focused work; group them at the end of P7.

- **A6** — Typed `EventBus<EventMap>` replacing 47+ `window.dispatchEvent("ht-…")` channels. Land incrementally (~5 channels per PR).
- **A7** — `VariantContext` interface dropping `__tau*` window globals.
- **F.6** — single `settings.schema.ts` driving `AppSettings` / `DEFAULT_SETTINGS` / `validateSettings` / migrations.
- **F.10** — audit remaining ad-hoc handlers; move into `src/bun/rpc-handlers/`.
- **F.11** — split `WorkspaceCollection` out of `SurfaceManager`.

### Cluster G — security long-tail

- **H.8** — per-surface browser partition.
- **H.9** — session cap + manifest-auth + cross-site origin check.

### Cluster H — theming long-tail

- **Theme switcher UI** — Settings panel field + boot-time `documentElement.dataset.theme` apply.
- **Literal-to-token migration** — ~1013 hard-coded colour literals in component CSS. One PR per cluster (sidebar, settings, agent panel, browser, …).

---

## This session's slice (cluster A + half of cluster B)

This session ships the cheap data-store + plan polish items:

1. **Cookie store URL-host normalize + per-domain cap.**
2. **Browser history URL normalize.**
3. **Manifest scanner symlinked-`$HOME` guard.**
4. **Plan panel RPC input validation.**

Each lands as its own commit. The rest of the backlog stays parked.

---

## Per-step acceptance criteria

Each step ships with a test that asserts the new invariant. Specific criteria documented per-PR in the commit body.

---

## Lifts to track in `feature_grades.json`

- `cookie-store` B → A (after this session's normalize + per-domain cap).
- `browser-history` B → A (after URL-normalize).
- `manifest-scanner` A → S (after symlink-$HOME guard).
- `plan-panel` A → S (after RPC validation).

Items NOT lifted in this session: settings-panel polish, sidebar drag-reorder, ARIA chip labels, terminal search, editor pane, browser pane, auto-continue, notifications, telegram TTL, surface-metadata, audits, health, event writer, theme switcher UI, A6/A7/F.6/F.10/F.11, H.8/H.9, literal migration.

---

## Exit criteria

This session: the four items above land green; feature_grades regenerates; tracking doc records the deferred long tail with an explicit owner-per-cluster.

Phase 7 overall: every named gap in `feature_grades.json` is either closed or has a documented justification for staying open.
