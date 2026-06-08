# fallow Report

Static-analysis sweep of the τ-mux repository using [`fallow`](https://github.com/fallow-rs/fallow).

- **Tool version:** fallow `2.88.2`
- **App version:** τ-mux `0.3.186`
- **Date generated:** 2026-06-03
- **Files scanned:** 629 (608 in dupe analysis)
- **Entry points resolved:** 311 (26 from `package.json`, 285 from plugins)
- **Plugins detected:** playwright, eslint, bun, astro
- **Workspaces:** 1 internal (`website-doc` → `tau-mux-docs`)
- **No fallow config present** (`fallow.json` absent) — all entry points are auto-detected, so suppression/ignore rules are not yet in play.

> ⚠️ **Read before acting.** `fallow` is a *static* import-graph analyzer. It cannot see runtime-only entry points (Electrobun build config, manually-run demo scripts, CLI binaries, service-worker registration), nor exports invoked dynamically by tests through string-keyed action routers. A large share of the findings below are **false positives by design** — every deletion needs human confirmation. Categories most affected are called out inline.

---

## 1. Dead code (`fallow dead-code`)

**326 total issues** in 188 ms.

| Category | Count | Notes |
|---|---:|---|
| Unused files | 75 | Heavily inflated by runtime-only entry points — see §1.1 |
| Unused exports | 140 | Mostly test/dynamic helpers — review, don't bulk-delete |
| Unused types | 33 | Safe-ish; type-only removals are low-risk |
| Unused class members | 60 | Includes live API surface (DI/dynamic) — see §1.4 |
| Unused dependencies | 1 | `sharp` (website-doc) |
| Unused dev dependencies | 2 | `@ai-hero/sandcastle`, `@typescript-eslint/parser` |
| Unlisted dependencies | 3 | pi-extension imports — see §1.5 |
| Unresolved imports | 7 | Mostly `.jsx`/design-helper paths — see §1.6 |
| Duplicate exports | 5 | Intentional cross-tier mirrors — see §1.7 |
| Private type leaks / circular deps / boundary violations | 0 | ✅ Clean |

### 1.1 Unused files (75) — by area

| Area | Count | Verdict |
|---|---:|---|
| `scripts/` (demos + build hooks) | 23 | **False positives.** `demo_*.ts` are run manually; `post-build.ts` is a build hook; `png.ts`/`hyperterm.ts` are CLI libs. |
| `src/` | 17 | **Mixed.** Real entry points (`src/views/terminal/index.ts`, `index.css`, `web-client/main.ts`, `sw.ts`, `pwa.ts`) are loaded by Electrobun/HTML, not imported. A few (`__test-handlers.ts`, `variants/*`, `surface-details.ts`, `prompt-dialog.ts`) deserve a real look. |
| `pi-extensions/ht-bridge/` | 17 | **False positives.** Loaded by the upstream `pi --mode rpc` host, not statically imported by this repo. |
| `design_guidelines/` | 9 | `.jsx` design mockups — not part of the build. Consider excluding the dir. |
| `website-doc/` | 3 | Astro components/styles resolved by Astro, not fallow. |
| `shareBin/` | 3 | CLI binary sources. |
| `tests-e2e/` | 1 | `server-boot.ts` test harness. |
| `electrobun.config.ts` | 1 | **False positive** — the build entry point itself. |
| `claude-integration/ht-bridge/src/index.ts` | 1 | Shell-hook bridge loaded by Claude Code, not this build. |

**Actionable subset:** `design_guidelines/` and the `pi-extensions/`, `claude-integration/`, `website-doc/` trees are the prime candidates for a `fallow.json` ignore rule (they belong to *other* runtime hosts). That alone would drop the "unused files" noise dramatically.

### 1.2 Unused exports (140) — top files

| File | Count |
|---|---:|
| `src/views/terminal/tau-primitives.ts` | 9 |
| `src/views/terminal/tau-icons.ts` | 8 |
| `src/web-client/panel-renderers.ts` | 6 |
| `src/views/terminal/tau-tokens.ts` | 6 |
| `pi-extensions/ht-bridge/lib/summarizer.ts` | 6 |
| `src/web-client/pwa.ts` | 5 |
| `src/views/terminal/prompt-dialog.ts` | 5 |
| `src/web-client/sidebar/local-ui-state.ts` | 4 |
| `src/views/terminal/ask-user-modal.ts` | 4 |
| `pi-extensions/ht-bridge/intercept/bash-safety.ts` | 4 |

⚠️ Many of these are **test-driven dynamic surfaces**: `ask-user-modal.ts` / `prompt-dialog.ts` expose `read*/submit*/cancel*` functions that the e2e harness and `__test-handlers.ts` action router call by name, so static analysis sees them as unused. The `tau-*` design-system exports are likely a deliberately-broad public palette. Treat this list as a *review queue*, not a delete list.

### 1.3 Unused types (33)

Lower-risk than exports. Concentrations: `status-keys.ts` (5), `notification-overlay.ts` (3), `tau-primitives.ts` (2), `webview-handlers/index.ts` (2). The rest are scattered one-offs across `src/shared`, `src/bun`, and test fixtures.

### 1.4 Unused class members (60) — top files

| File | Count |
|---|---:|
| `src/views/terminal/surface-manager.ts` | 21 |
| `src/bun/pi-agent-manager.ts` | 7 |
| `src/views/terminal/sidebar.ts` | 6 |
| `src/views/terminal/terminal-effects.ts` | 5 |
| `src/views/terminal/panel-manager.ts` | 4 |
| `src/views/terminal/command-palette.ts` | 4 |
| `src/bun/browser-surface-manager.ts` | 4 |

⚠️ `surface-manager.ts`'s 21 flagged methods (`addAgentSurface`, `browserNavigateTo`, `getSurfaceRect`, `setStatus`, `workspaceCount`, …) are mostly **public API invoked via RPC dispatch or webview bridges**, not direct call sites — fallow even attaches the note *"Class member may be used via dependency injection."* Do not bulk-remove. A genuine grep is needed per-method.

### 1.5 Unlisted dependencies (3)

These pi-extension imports are not declared in any `package.json` in this repo because they are resolved by the upstream pi host:

- `@mariozechner/pi-coding-agent` — imported by 21 files under `pi-extensions/ht-bridge/`
- `@mariozechner/pi-ai` — 4 files
- `typebox` — 6 files

**Recommendation:** add these to `ignoreDependencies` in `fallow.json` (they're intentional peer/host deps), or add a dedicated `package.json` for the extension if it's ever published standalone.

### 1.6 Unresolved imports (7)

All are non-TS or design-helper paths fallow can't follow:

- `design_guidelines/Design tau-mux.html` → `./design-canvas.jsx`
- `src/views/terminal/index.html` → `./theme-tokens.css`
- `scripts/audit-design-baselines.ts` → `../tests-e2e/design/helpers/demos`
- `tests-e2e/design/demos.spec.ts` & `tests-e2e-native/specs/demos.spec.ts` → `./helpers/demos` (×4)

The `helpers/demos` ones suggest a real missing/renamed module worth a quick check; the rest are HTML/CSS asset references (expected).

### 1.7 Duplicate exports (5) — intentional cross-tier mirrors

These are the same symbol defined in the shared layer **and** re-implemented per render target (native webview vs. web mirror) — a documented architectural pattern in this repo, not a bug:

- `PanelState` — `shared/web-protocol.ts` + `web-client/store.ts`
- `WorkspaceInfo` — `shared/sidebar-state.ts` + `views/terminal/sidebar.ts`
- `WorkspaceCardOptions` — `views/terminal/sidebar.ts` + `tau-primitives.ts`
- `computeRects` — `shared/pane-layout-math.ts` + `web-client/layout.ts`
- `playNotificationSound` — `shared/sounds.ts` + `views/terminal/sounds.ts` + `web-client/sounds.ts`

**Recommendation:** add these to `ignoreExports` (fallow offers an auto-fixable action for exactly this) to silence them as intentional namespace mirrors.

### 1.8 Dependencies worth actually removing

Investigated all three; **2 of 3 were safe to remove, 1 was a false positive**:

- ✅ **`@ai-hero/sandcastle`** (root `devDependencies`) — genuinely unused (only referenced in `package.json`). **Removed.**
- ✅ **`@typescript-eslint/parser`** (root `devDependencies`) — redundant. The ESLint flat config (`eslint.config.js`) uses `tseslint.parser` from the `typescript-eslint` meta-package, which already depends on `@typescript-eslint/parser@8.58.0`. The direct devDep is dead weight. **Removed** (ESLint verified still parsing TS afterward).
- ❌ **`sharp`** (`website-doc/package.json`) — **FALSE POSITIVE, kept.** `website-doc/src/content/docs/index.mdx` (and `fr/index.mdx`) import `{ Image } from "astro:assets"` and render `<Image>`; Astro's `<Image>` uses sharp as its default build-time image-optimization service. Nothing imports `sharp` in source, so fallow flags it — but `astro build` would break without it. Added to `ignoreDependencies` in `.fallowrc.json`.

> Lesson: every "unused dependency" finding needs a usage check for *implicit* consumers (build tools, framework image/asset pipelines, plugin meta-packages) before deletion.

---

## 2. Code duplication (`fallow dupes`)

| Metric | Value |
|---|---:|
| Total files | 608 |
| Files with clones | 249 |
| Total lines | 152,390 |
| Duplicated lines | 14,479 |
| **Duplication %** | **9.50%** |
| Clone groups | 403 |
| Clone instances | 1,198 |
| Clone families | 248 |

### 2.1 Biggest single clone group

**`scripts/hyperterm.ts` ↔ `shareBin/hyperterm.ts` — 800 identical lines.** These two CLI sources are near-verbatim copies. This is by far the largest extractable win (the family report estimates 800 lines of savings). Consolidating into one shared module (or having one re-export the other) would remove ~5.5% of *all* duplicated lines in the repo in a single change.

### 2.2 Top clone families (by duplicated lines)

| Lines | Groups | Files |
|---:|---:|---|
| 800 | 1 | `scripts/hyperterm.ts`, `shareBin/hyperterm.ts` |
| 385 | 12 | `scripts/demo_gitdiff.ts`, `scripts/demo_gitgraph.ts` |
| 181 | 4 | `scripts/demo_procs.ts`, `scripts/demo_sysmon.ts` |
| 161 | 3 | `scripts/demo_files.ts`, `scripts/demo_gitgraph.ts` |
| 146 | 3 | `scripts/demo_files.ts`, `scripts/demo_procs.ts` |
| 139 | 6 | `tests/web-client-layout.test.ts` (internal) |
| 102 | 9 | `tests/sideband-parser.test.ts` (internal) |
| 92 | 2 | `tests/agent-panel-dialogs.test.ts`, `tests/agent-panel-response.test.ts` |
| 91 | 4 | `tests-e2e/security.spec.ts` (internal) |
| 86 | 3 | `src/views/terminal/sidebar.ts`, `src/web-client/sidebar/card-manifests.ts` |
| 84 | 1 | `src/bun/rpc-handlers/ask-user.ts`, `src/bun/rpc-handlers/plan.ts` |
| 76 | 3 | `src/bun/browser-history.ts`, `src/bun/cookie-store.ts` |

### 2.3 Where the duplication clusters

- **Demo scripts (`scripts/demo_*.ts`)** — the dominant source of duplication. They share boilerplate (sideband setup, full-screen handling, formatting helpers). Low priority (manually-run examples), but a shared `scripts/lib/demo-kit.ts` would cut hundreds of lines.
- **Tests** — repeated fixture/arrange blocks across `tests/` and `tests-e2e/`. Mostly acceptable for test clarity; candidates for shared helpers where blocks exceed ~50 lines.
- **Production code worth extracting:**
  - `rpc-handlers/ask-user.ts` ↔ `rpc-handlers/plan.ts` (84 lines) — two RPC handlers with parallel structure; a shared helper is justified.
  - `views/terminal/sidebar.ts` ↔ `web-client/sidebar/card-manifests.ts` (86 lines) — native/web sidebar card logic; candidate for a `shared/` extraction consistent with the existing cross-tier sharing pattern.
  - `bun/browser-history.ts` ↔ `bun/cookie-store.ts` (76 lines) — likely a shared SQLite-store base class.
  - `formatDuration()` is copy-pasted in `claude-integration/ht-bridge/src/index.ts` and `pi-extensions/ht-bridge/lib/messages.ts` (10 lines each) — but those live in separate runtime hosts, so sharing is awkward.

---

## 3. Feature flags (`fallow flags`)

**0 feature flags / environment gates detected.** The project uses no flag-library-style gating that fallow recognizes. (Settings-driven toggles in `AppSettings` are runtime config, not static feature flags, so this is expected.)

---

## 4. Auto-fix preview (`fallow fix --dry-run`)

**136 auto-fixable changes** available:

| Fix type | Count |
|---|---:|
| `remove_export` | 132 |
| `remove_dependency` | 3 |
| `add_ignore_exports` | 1 |

⚠️ **Do not run `fallow fix --yes` blindly on this repo.** The 132 `remove_export` fixes include the dynamic test-driven exports from §1.2 (e.g. `ask-user-modal` / `prompt-dialog` functions, `tau-*` design palette). Auto-removing them would break the e2e harness and the design system's public API even though the code compiles. The auto-fixer can't know they're reached via string-keyed routers.

**Safe-to-apply subset:** the dependency fixes (after verifying §1.8 — note one was a false positive) and the `add_ignore_exports` config. The export removals should be applied **selectively, file by file, with grep verification** — not in bulk.

---

## 5. Recommended next steps (priority order)

1. ✅ **Done — added `.fallowrc.json`** (fallow auto-loads this name, not `fallow.json`) covering `ignoreDependencies` (pi host deps + sharp), `ignorePatterns` for other-host trees (`pi-extensions/**`, `claude-integration/**`, `design_guidelines/**`), and the 5 intentional cross-tier `ignoreExports` (§1.7). This dropped total issues **326 → 261** and zeroed the unlisted-deps and duplicate-exports categories.
2. ✅ **Done — removed 2 of 3 dependencies** (§1.8): `@ai-hero/sandcastle` and `@typescript-eslint/parser`. `sharp` kept (Astro false positive).
3. **Consolidate `scripts/hyperterm.ts` ↔ `shareBin/hyperterm.ts`** (800-line clone) — the single highest-impact dedup. *(Still open.)*
4. **Extract shared logic** for the production duplications in §2.3 (`ask-user`/`plan` handlers, sidebar card logic, SQLite stores).
5. **Triage the real `src/` dead code** (the genuinely-unimported exports/types/members) one file at a time — *after* the noise is suppressed, the remaining list will actually be trustworthy.
6. **Re-run `fallow dead-code --changed-since main --format json`** in PR CI for incremental, per-diff checks rather than whole-repo sweeps.

---

*Generated by running `fallow list | dead-code | dupes | flags | fix --dry-run` (all `--format json`). Raw JSON outputs were captured under `/tmp/fallow/` during analysis; re-run any command to refresh.*
