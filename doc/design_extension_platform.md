# τ-mux Extension App Platform — Design

> Status: in progress (branch `worktree-extension-platform`, based on `aaa-polish` @ v0.3.188)
> Tracking: `doc/tracking_extension_platform.md`

## Goal

A new **`extension` surface type** that hosts an "extension app":

- **Backend** = a Bun child process (can `bun install` its own deps).
- **Frontend** = a Vite app rendered in an `<iframe>` (HMR while editing; built static `dist/` when installed).
- **`@tau-mux/sdk`** = a typed wrapper over the EXISTING socket / Electrobun RPC, usable from both the Bun backend (socket client) and the webview frontend (postMessage → Electrobun → socket bridge), so an extension can drive every τ-mux control surface.
- Extensions are **saved / opened / persisted**; an **extension editor** (manage overlay + open-in-editor + palette + `ht extension` CLI) creates / edits / installs them.
- **Fully trusted** — no sandbox. The iframe is the one explicit full-privilege trust boundary (like the `interactive` sideband path).
- Ship **two example extensions**: a Three.js app and an HTTP "Postman clone".

## Decisions (from understanding pass)

| Topic | Decision |
|---|---|
| Surface to mirror | **`editor`** (freshest non-PTY, persisted-with-path controller). `telegram` for minimal broadcast / web-mirror parity reference. |
| Surface id prefix | **`ext:`** — the web mirror dispatches purely on id prefix. |
| Backend process mgr | **`ExtensionManager`** mirroring `PiAgentManager` — `Bun.spawn` (NEVER `terminal:true`), login-shell PATH resolution, stdout-JSONL control channel, SIGTERM→SIGKILL teardown. One backend per *running surface*, not per extension. |
| Frontend host | **`<iframe>`** (not `<electrobun-webview>`, not sideband panel). `devUrl` for Vite HMR; `bundleUrl` static served over the existing `Bun.serve` web server at `/extensions/<id>/*`. |
| SDK transport | Backend → persistent **unix-socket client** (reuse `runRpc` shape + `__token`). Frontend → **`window.parent.postMessage`** → relay in `extension-pane.ts` → `extensionFrontendMessage` webview→bun → socket dispatch; result back via `extensionBackendMessage` → iframe `postMessage`. |
| SDK location | In-repo `packages/tau-mux-sdk/`. Distributed into each extension's `node_modules` via `file:` dep (dev) / vendored copy (installed). No npm publish. |
| On-disk | `configDir/extensions/<id>/` (`manifest.json`, `src/`, `dist/`, `node_modules/`, `state.json`) + `configDir/extensions-registry.json`. configDir = `~/Library/Application Support/hyperterm-canvas` (override `HT_CONFIG_DIR`). |
| Editor UX | `⌘⌥E` "Manage Extensions" overlay (mirrors `ProcessManagerPanel` `⌘⌥P`) + open-in-editor (reuse `editor` surface) + palette commands + `ht extension {list,new,run,stop,remove}`. |
| Web mirror parity | **Deferred to a later phase** (native-only first, like `editor`). Designed-in via `ext:` prefix + HTTP route. |
| Trust | Fully trusted; manifest `permissions` are advisory only. Socket token still enforced so non-extension processes can't impersonate. |

## On-disk layout

```
configDir/
  extensions/
    <extension-id>/
      manifest.json
      src/                 # backend index.ts + frontend Vite app
      dist/                # built frontend (installed mode)
      node_modules/        # incl. vendored @tau-mux/sdk
      state.json           # per-extension persisted state (version:1)
  extensions-registry.json # { version:1, extensions:[{id,path,enabled,installedAt}] }
```

### `manifest.json`

```jsonc
{
  "id": "com.taumux.three-demo",   // stable; stored in surfaceExtensionIds
  "name": "Three.js Demo",
  "version": "0.1.0",
  "icon": "🧊",
  "backend": { "entry": "src/index.ts" },
  "frontend": { "dev": "vite", "devPort": 5173, "dist": "dist", "entry": "index.html" },
  "permissions": ["surface", "browser", "notification"]   // advisory only
}
```

## Runtime architecture

```
ExtensionManager (src/bun/extension-manager.ts)   ── mirrors PiAgentManager
  ├── registry: scans configDir/extensions, reads each manifest
  ├── ExtensionBackendInstance per running surface
  │     spawn: Bun.spawn([bun,"run",entry], { cwd: extDir, env:{ HT_SOCKET_PATH, HT_RPC_TOKEN, HT_SURFACE_ID, HT_EXTENSION_ID }})
  │     dev:   also runs the frontend dev server (vite) → devUrl
  │     stdout JSONL = control channel (ready/log); SDK socket = RPC
  │     teardown: SIGTERM → SIGKILL
  └── ensureBackend(extensionId, surfaceId) → { devUrl?, bundleUrl? }

Webview (src/views/terminal/)
  ├── ExtensionSurfaceController (extension-surface-controller.ts) — mirrors EditorSurfaceController
  ├── extension-pane.ts — builds .surface-extension container → iframe(src=devUrl|bundleUrl)
  │     + postMessage relay (frontend SDK ⇄ host)
  └── SurfaceView.extensionView wiring in surface-manager.ts
```

## `@tau-mux/sdk` surface (v1 curated subset, grows via codegen later)

`sdk.surface.*`, `sdk.workspace.*`, `sdk.notification.*`, `sdk.sidebar.*`, `sdk.browser.*`, plus `sdk.state.get/set` (per-extension `state.json`) and `sdk.onResize`. Both transports expose an identical typed surface.

## Phases

See `doc/tracking_extension_platform.md`. Order: P0 types → P1 ExtensionManager+registry+rpc-handlers → P2 surface plumbing (bun) → P3 webview rendering (iframe) → P4 SDK → P5 editor UX → P6 example extensions → P7 (deferred) web-mirror parity.

## Top risks (mitigations in tracking doc)

1. Bun binary resolution for spawned backends in a packaged `.app` (login-shell PATH fallback).
2. Vite is per-extension (host never imports Vite; spawns `bun run dev`).
3. iframe↔host RPC bridge latency/ordering (match by `id`, persistent socket).
4. `extensionFrontendMessage` is a full-privilege sink (accepted; advisory permissions; token on socket).
5. Backend process leaks (wire removeSurface → `ht-close-surface` → `extensionManager.stop`; kill all on shutdown).
6. Restore = fresh backend (extension reloads its own `state.json`; degrade to terminal placeholder if uninstalled).
7. SDK distribution without npm (`file:` dep / vendored copy).
8. Two persisted-shape copies (`PersistedWorkspace` + inline `TauMuxRPC` mirror) must stay in lockstep.
