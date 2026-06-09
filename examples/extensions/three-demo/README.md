# Three.js Demo — τ-mux extension app

A minimal **extension app** for [τ-mux](../../../README.md) that renders a
spinning 3D scene with [three.js](https://threejs.org/) and drives a few host
control surfaces from a companion Bun backend.

It's intended as a reference for the extension app shape:

```
three-demo/
├── manifest.json     # id, name, backend entry, frontend dev/dist, permissions
├── package.json      # deps (three, @tau-mux/sdk) + dev/build scripts
├── vite.config.ts    # base: "./" so assets resolve under /ext/<id>/
├── tsconfig.json
├── index.html        # full-viewport #app mount for the three.js canvas
└── src/
    ├── main.ts       # frontend — three.js scene + @tau-mux/sdk/frontend
    └── index.ts      # backend  — Bun process + @tau-mux/sdk/backend
```

## What it demonstrates

- **Frontend (`src/main.ts`)** — a three.js perspective camera, ambient + point
  lighting, and a faceted icosahedron with a wireframe accent, animated via
  `requestAnimationFrame`. It resizes cleanly to the pane (both `sdk.onResize`
  and the window `resize` event), and on mount it:
  - sets a sidebar status chip (`sdk.sidebar.setStatus`),
  - posts a notification (`sdk.notification.create`),
  - pulses the rotation speed whenever the backend sends a message
    (`sdk.onBackendMessage`).
- **Backend (`src/index.ts`)** — a long-lived Bun process that logs to the
  sidebar and posts a notification on startup, echoes frontend messages back as
  `{ pong: … }` (`sdk.onMessage` / `sdk.send`), and emits a `{ tick }` heartbeat
  every 5 s so the scene reacts to its own backend.

All host calls are wrapped in `try/catch` — a failed control-surface call never
breaks rendering or kills the backend.

## Running it

This example is loaded by τ-mux, not run standalone. Open it from the host:

```sh
# From τ-mux's extension manager, or via the CLI:
ht extension open com.taumux.three-demo
```

In development τ-mux launches the Vite dev server (`vite`, pinned to port
**5191** in `manifest.json` / `vite.config.ts`) for the frontend and runs
`src/index.ts` under Bun for the backend. For a packaged build the frontend is
served from `dist/` (`vite build`); `base: "./"` keeps its asset URLs relative
so they resolve under the host's `/ext/<id>/` sub-path.

The local scripts mirror that flow:

```sh
bun install      # install three + @tau-mux/sdk (linked via file:)
bun run dev      # frontend dev server on http://127.0.0.1:5191
bun run build    # produce dist/ for packaging
```
