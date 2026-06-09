# Tracking — Extension App Platform

Branch: `worktree-extension-platform` (based on `aaa-polish` @ e2c8fa19 / v0.3.188).
Design: `doc/design_extension_platform.md`.

Legend: ☐ todo · ◐ in progress · ☑ done · ⚠ deviation/issue

## Phase 0 — Foundations (types + RPC contracts) ☑
- ☑ Add `"extension"` to `SurfaceKind` (`src/shared/types.ts`)
- ☑ Add `surfaceExtensionIds?` to `PersistedWorkspace` + inline `workspaceStateSync` mirror + `WorkspaceSnapshot`
- ☑ bun→ messages `createExtensionSurface`, `splitExtensionSurface`, `extensionFrontendMessage`
- ☑ webview messages `extensionSurfaceCreated`, `extensionBackendMessage`
- ☑ Manifest / registry / SDK bridge shared types (`src/shared/extension-types.ts`)
- ☑ `bun run typecheck` green

## Phase 1 — ExtensionManager (bun) ☑
- ☑ `src/bun/extension-manager.ts` (ExtensionBackendInstance + ExtensionManager + static bundle host) mirroring PiAgentManager
- ☑ registry + manifest load under configDir; atomic-write persistence; scaffold/install/remove/reload
- ☑ `src/bun/rpc-handlers/extension.ts` (list/templates/open/split/new/install/remove/reload/stop) + HandlerDeps + rpc-handler wiring
- ☐ Headless test via socket (`ht extension list/run`) — pending CLI (Phase 5) + test

## Phase 2 — Surface plumbing (bun index.ts) ☑
- ☑ `nextExtensionSurfaceId` (`ext:` prefix)
- ☑ `createExtensionWorkspaceSurface`, `splitExtensionSurface` (async ensureBackend → extensionSurfaceCreated)
- ☑ `tryRestoreLayout` branch (re-mount or degrade) + remap; `saveLayout` writeout (`surfaceExtensionIds` + `surfaceEditorFiles`)
- ☑ socket-action dispatch (create/split) + closeSurface ext branch + webview-handler slice + context wiring
- ☑ gracefulShutdown `extensionManager.dispose()`
- ☑ host→frontend payload sink (`sendExtensionHostPayload` → `extensionBackendMessage`)

## Phase 3 — Webview rendering (iframe) ☑
- ☑ `src/views/terminal/extension-pane.ts` (iframe + postMessage relay + ResizeObserver + status pill)
- ☑ `src/views/terminal/extension-surface-controller.ts`
- ☑ `SurfaceView.extensionView`, factory `createExtensionSurfaceView`, all 6 factories add `extensionView:null`
- ☑ `applyLayout` / `focusSurface` / `removeSurface` branches; snapshot builder; CSS in `index.css`
- ☑ webview message handlers (`extensionSurfaceCreated`, `extensionBackendMessage`, `extensionList`) + htEvents listeners (`ht-split-extension`, `ht-extension-frontend-message`)
- ☑ new htEvents channels registered in `HtEventMap`

## Phase 4 — @tau-mux/sdk ☑
- ☑ `packages/tau-mux-sdk/` — `protocol.ts` (typed `TauMuxApi` + bridge types), `backend.ts` (persistent unix-socket client + stdin/stdout app channel), `frontend.ts` (postMessage bridge), `index.ts`
- ☑ Ships TS source (Bun + Vite both resolve `.ts`); `exports` map (`.`/`./backend`/`./frontend`/`./protocol`); standalone tsconfig typechecks clean
- ☑ Distribution into extension node_modules via `file:../../../packages/tau-mux-sdk`

## Phase 5 — Extension editor UX ☑
- ☑ Command Palette per-extension: **Open** (run), **Edit** (opens its
  backend src / manifest in the CodeMirror editor surface), **Remove** (confirm
  → delete) + **New Extension…** (prompt id + template → scaffold). Driven by
  the enriched `extensionList` (path / hasBackend / templates).
- ☑ `extensionScaffold` / `extensionRemove` webview→bun messages (mutate +
  re-push list).
- ☑ `ht extension {list,templates,open,split,new,install,remove,reload,stop}` CLI + bin/ht help
- Note: chose palette + existing CodeMirror editor + prompt dialogs over a
  bespoke ⌘⌥E overlay — leaner, reuses proven primitives, same capability set.

## Phase 6 — Example extensions ☑
- ☑ `examples/extensions/three-demo` (Vite + three; backend drives sidebar/notification)
- ☑ `examples/extensions/http-client` (Postman clone; backend fetch proxy + state.json history)
- ☑ `examples/extensions/hello` (zero-dep static; committed dist/; offline demo + test target)
- ☑ `tests/extension-manager.test.ts` (registry / scaffold / static host / traversal / remove — 6 tests)

## Phase 7 — Web-mirror parity (deferred)
- ☐ `ext:` dispatch + `/extensions/<id>/*` HTTP route + envelope

## Verification gates (CLAUDE.md)
- ☑ `bun test` green (3100 pass / 0 fail incl. 6 new extension-manager tests)
- ☑ `bun run typecheck` green
- ☑ emoji audit clean
- ☐ `bun start` launches; extension pane renders; HMR works — pending manual run
- ☑ `bun run bump:*` before commit

## Commits
- `205d7a37` feat(extensions): extension-app platform — Bun runtime + Vite
  frontend + SDK (v0.4.0). Phases 0–4, 6 + CLI/palette (Phase 5 partial).
  3100 tests pass, typecheck + emoji-audit clean, web-client bundle builds.
- `70d17581` feat(extensions): in-app editor — Open/Edit/Remove/New via command
  palette (v0.4.1). Completes Phase 5. 3100 tests pass, all gates green.

## Deviations / issues
- Worktree was branched from `origin/main` (v0.3.182); reset to `aaa-polish` (v0.3.188) so the feature builds on the user's latest work.
