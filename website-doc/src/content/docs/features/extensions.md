---
title: Extension Apps
description: Build "extension apps" — a Bun backend + a Vite frontend in an iframe + a typed @tau-mux/sdk that drives every τ-mux control surface. Saved, opened, and edited in-app.
sidebar:
  order: 14
---

An **extension app** is a first-class surface type (alongside terminal / browser / agent / telegram / editor) that hosts a small app you write yourself:

- a **Bun backend** — a real child process that can `bun install` its own dependencies and do anything Bun can (fetch, filesystem, spawn, SQLite, …);
- a **Vite frontend** — rendered in an `<iframe>`, with hot-module reload while you edit and a built static bundle once installed;
- the **`@tau-mux/sdk`** — a typed wrapper over τ-mux's existing socket / RPC so the extension can drive **every control surface**: create panes, open browser surfaces, push notifications, set sidebar status, list workspaces, and more.

Extensions are saved on disk, restored with your layout, and created / edited / removed from inside the app. They are **fully trusted** — there is no sandbox; an extension runs with the same privilege as the app (see [Trust model](#trust-model)).

## The shape of an extension

```
<config>/extensions/<id>/
  manifest.json          # id, name, icon, backend + frontend entry points
  src/
    index.ts             # the Bun backend (optional)
    main.ts              # the Vite frontend
  index.html             # Vite entry
  dist/ (or static/)     # built frontend (installed mode)
  node_modules/          # incl. the vendored @tau-mux/sdk
  state.json             # per-extension persisted state (you write it)
```

`<config>` is the app config dir (`~/Library/Application Support/hyperterm-canvas` on macOS; override with `HT_CONFIG_DIR`). An `extensions-registry.json` next to it indexes what's installed.

### `manifest.json`

```jsonc
{
  "id": "com.you.my-app",        // stable; the folder name + URL segment
  "name": "My App",
  "version": "0.1.0",
  "icon": "🧩",                  // emoji/glyph shown in the pane bar
  "description": "What it does.",
  "backend": { "entry": "src/index.ts" },          // omit for a frontend-only app
  "frontend": {
    "dev": "vite",               // dev-server command (HMR)
    "devPort": 5191,             // the iframe points here in dev mode
    "dist": "dist",              // built output dir (installed mode)
    "entry": "index.html"
  },
  "permissions": ["notification", "sidebar", "surface", "browser"]  // advisory
}
```

## Dev vs installed

An extension surface runs in one of two modes, decided per launch:

- **Dev (Vite HMR).** τ-mux runs the manifest's `frontend.dev` command (a Vite dev server) and points the pane's iframe at `http://127.0.0.1:<devPort>`. Edit `main.ts` in an adjacent [editor pane](/features/file-explorer-and-editor/) and the iframe hot-reloads. The first launch runs `bun install` in the extension dir automatically.
- **Installed (built static).** When a built frontend exists (`dist/` / the manifest's `dist`), τ-mux serves it from a tiny loopback HTTP host and points the iframe there. No dev server, no rebuild.

The backend (`src/index.ts`) is a plain Bun child process in both modes — **never a PTY**. It is started fresh for each surface and stopped (SIGTERM → SIGKILL) when the pane closes or the app exits.

## The `@tau-mux/sdk`

The SDK gives a single typed surface from both halves of an extension. It ships as TypeScript source under `packages/tau-mux-sdk`; the bundled examples **vendor a copy** (`vendor/tau-mux-sdk`, declared as `"@tau-mux/sdk": "file:./vendor/tau-mux-sdk"`) so it travels with the extension and `bun install` resolves it offline — in dev, installed, and packaged builds alike.

**Backend** (`src/index.ts`) — talks to τ-mux over the unix socket; exchanges app-level messages with the frontend over stdin/stdout:

```ts
import { createBackendSdk } from "@tau-mux/sdk/backend";

const sdk = createBackendSdk();
await sdk.sidebar.setStatus({ key: "demo", value: "running" });
await sdk.notification.create({ title: "My App", body: "Backend up" });

sdk.onMessage((data) => {           // a message from the frontend
  sdk.send({ pong: data });          // … reply to the frontend
});
```

**Frontend** (`main.ts`, in the iframe) — talks to τ-mux via a `postMessage` bridge (the host dispatches through the same RPC the CLI uses), and to its own backend:

```ts
import { createFrontendSdk } from "@tau-mux/sdk/frontend";

const sdk = createFrontendSdk();
await sdk.notification.create({ title: "Hello", body: "from the iframe" });
const surfaces = await sdk.surface.list();

sdk.sendToBackend({ type: "ping" });          // → the Bun backend
sdk.onBackendMessage((data) => console.log(data));
sdk.onResize(({ width, height }) => relayout(width, height));
```

Both halves expose the **complete control surface** — every JSON-RPC method the `ht` CLI can call, typed, across all 17 domains (~120 methods):

| Namespace | Highlights |
|---|---|
| `system` | `ping`, `version`, `identify`, `capabilities`, `health`, `tree`, `shutdown` |
| `workspace` | list / current / create / select / next / previous / rename / close |
| `surface` | list, split, close, focus, rename, `sendText`, `sendKey`, `readText` (terminal contents), `metadata` (process tree, **listening ports**, git, package.json), `screenshot`, `openPort` / `killPort` / `killPid`, `waitReady` |
| `sidebar` | `setStatus` (chips + live charts via key suffixes like `_sparkline`), `clearStatus`, `setProgress` / `clearProgress`, `log` |
| `notification` | create / list / dismiss / clear |
| `browser` | the full driver: open, navigate, back/forward/reload, `click` / `type` / `fill` / `press` / `hover` / `select` / `scroll`, `eval` / `addScript` / `addStyle`, `snapshot` / `get` / `is` / `wait`, console + errors, history, the cookie store |
| `agent` | list / create / createSplit / close pi-agent panes, plus `askUser` modals (`askPending` / `askAnswer` / `askCancel`) |
| `telegram` | status / chats / history / send / restart |
| `editor` | open / split / list / save / reload / close CodeMirror panes |
| `extension` | extensions can manage extensions — list / templates / open / new / install / remove / stop |
| `plan` | set / update / complete / list / clear the plan panel |
| `autoContinue` | status / set / pause / resume / fire / audit |
| `audit`, `pane`, `panel`, `script` | self-audits, pane + panel listings, `script.run` |

Plus the raw `call(method, params)` escape hatch for any method added after this SDK shipped. A two-directional coverage test in the repo keeps the SDK's wire names in lockstep with the host's RPC registry. See the [`extension.*` API](/api/extensions/) for the host-side management surface.

## Creating, editing, and removing

Everything is reachable from the **command palette** (`⌘⇧P`, under "Extensions") and the [`ht extension`](/cli/extensions/) CLI:

- **Open** — run an extension in a new pane (`ht extension open <id>`).
- **Edit** — open the extension's backend source (or `manifest.json`) in the CodeMirror [editor surface](/features/file-explorer-and-editor/); paired with the running pane in dev mode, this is the live edit → HMR loop.
- **New Extension…** — scaffold from a bundled template (`ht extension new <id> --template <name>`).
- **Remove** — uninstall and delete the folder (`ht extension remove <id>`).

## Persistence & restore

An extension pane is saved with its workspace layout (by extension id). On restart the surface and a **fresh backend** are restored — the extension reloads its own `state.json`. If the extension has since been uninstalled, the slot degrades to a terminal placeholder rather than being lost.

## Bundled examples

Four example extensions ship in `examples/extensions/` (they double as scaffold templates):

| Example | Demonstrates |
|---|---|
| `hello` | Zero-dependency static app. No `bun install`, no Vite — served straight from a committed `static/`. The fastest way to see the frontend ⇄ host bridge. |
| `three-demo` | A Vite + [three.js](https://threejs.org) WebGL scene with HMR; the backend drives the sidebar + notifications. Proves `bun install` of a real dependency. |
| `http-client` | A Postman-style HTTP request builder. The frontend builds the request; the **backend** runs `fetch` (no CORS) and persists history to `state.json`. |
| `nebula` | The flagship: a **3D HTTP API explorer** — a full Postman-style client rendered as a living three.js scene with a glassmorphism HUD. It **discovers the dev servers running in your terminals** (via `surface.metadata` listening ports) as one-click orbiting endpoints, animates requests/responses through the scene, and drives τ-mux: open-in-browser, send-as-`curl` into a new terminal split, a live latency sparkline in the sidebar, notifications on failures. |

## Trust model

Extensions are **fully trusted** — there is no sandbox. The iframe runs with scripts + same-origin so the SDK bridge works, and the backend has full Bun privilege. The manifest `permissions` list is **advisory** (surfaced in the UI), not enforced. The RPC socket token still applies, so a non-extension process can't impersonate one. Only install extensions you trust, exactly as you would a shell script.

## See also

- [`ht extension` CLI](/cli/extensions/)
- [`extension.*` JSON-RPC API](/api/extensions/)
- [File explorer & editor](/features/file-explorer-and-editor/) — where you edit extension source
- [Command palette](/features/command-palette/)
