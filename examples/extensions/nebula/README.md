# 🌌 Nebula — a 3D HTTP API explorer for τ-mux

Nebula is a flagship [τ-mux extension app](../../../doc/design_extension_platform.md):
**Postman, in orbit.** A full HTTP client rendered as a living three.js scene
that is *aware of the servers running in your terminals* and can drive τ-mux
from your API workflow.

## What makes it special

- **Stunning 3D workbench.** Requests fly through a deep-space scene — a glowing
  core (your machine), endpoint nodes in orbit, packets arcing out and back, and
  status-colored rings rippling on every response. A glassmorphism "mission
  control" HUD floats on top.
- **It knows your running servers.** Nebula reads τ-mux's live process metadata
  (`surface.metadata` → `listeningPorts`) and turns every dev server in your
  open terminals into a one-click endpoint — labelled with the command that owns
  it (`bun run dev`, `python3 -m http.server 8080`, …). No copy-pasting ports.
- **Real HTTP client.** Method, URL, headers, body; pretty JSON responses;
  status / timing / size; history + a saved collection (persisted to
  `state.json`).
- **Drives τ-mux.** From any request you can:
  - **Open in browser** → opens the URL in a τ-mux browser pane.
  - **Send as curl →** → opens a new terminal split and runs the equivalent
    `curl` command.
  - It pushes a **live latency sparkline** + a status chip into the τ-mux
    sidebar, and fires a **notification** on failures.

## Architecture

```
frontend (iframe, three.js + DOM HUD)      backend (Bun)
  main.ts   — wires scene + HUD + SDK         index.ts  — owns ALL I/O:
  scene.ts  — the 3D scene                       • fetch proxy (no CORS) + timing
  hud.ts    — the request/response HUD           • server discovery (surface.metadata)
  styles.css                                     • curl→terminal, open-in-browser
        │  sdk.sendToBackend / onBackendMessage  • sidebar sparkline + notifications
        └───────────── app channel ─────────────►• history/collection → state.json
```

The frontend is pure visuals + UX; the **backend** performs every request and
every τ-mux control-surface call. They speak the typed message contract in
[`src/protocol.ts`](./src/protocol.ts).

## Run it

From a terminal pane **inside τ-mux**:

```bash
ht extension install ~/Documents/DEV/crazyShell/examples/extensions/nebula
ht extension open com.taumux.nebula
```

First launch runs `bun install` (three + vite) and starts a Vite dev server with
HMR. Then: start a dev server in another pane (e.g. `bun run dev`), hit the **↻**
on the *Servers* rail in Nebula, and watch it appear as an orbiting node — click
it to load its URL, then **Send**.

> Built on `@tau-mux/sdk`. Fully trusted (no sandbox) — like every τ-mux
> extension, it runs with the app's privileges.
