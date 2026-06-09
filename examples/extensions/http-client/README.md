# HTTP Client — τ-mux extension example

A Postman-style HTTP request builder, built as a τ-mux **extension app**:

- a **Vite frontend** (`index.html` + `src/main.ts`) that runs in an iframe and
  builds requests with plain DOM (no framework), and
- a **Bun backend** (`src/index.ts`) that actually performs the `fetch`.

It uses [`@tau-mux/sdk`](../../../packages/tau-mux-sdk) for the frontend ⇄ backend
channel and for τ-mux control surfaces (notifications, sidebar).

## Why the request runs in the backend

The frontend never calls `fetch` directly. A request issued from the iframe would
be subject to the browser's **CORS** policy, so most cross-origin APIs would fail.
Instead the request flows through the backend:

```
frontend  ──sendToBackend({type:"request", id, method, url, headers, body})──▶  backend
                                                                                  │
                                                                          fetch(url, …)   (no CORS)
                                                                                  │
frontend  ◀──onBackendMessage({type:"response", id, status, headers, body, timeMs})──  backend
```

The backend runs in Bun, where `fetch` has no same-origin restriction, so any URL
works.

## History persistence

Each completed (or failed) request is appended to an in-memory history list and
written to **`state.json`** in the extension's own directory (the backend's cwd).
The list is capped to the last 50 entries. On load, the frontend asks the backend
for the saved history (`{type:"history"}`) and renders it in the right-hand rail;
clicking an entry refills the form.

A `state.json` is created on first request — it is local runtime state and can be
deleted at any time.

## Run it

From inside τ-mux:

```sh
ht extension open com.taumux.http-client
```

The host starts the Bun backend and the Vite dev server (pinned to port `5192`,
per `manifest.json`), then mounts the frontend in a pane.

## Develop standalone

```sh
bun install
bun run dev     # Vite dev server on http://127.0.0.1:5192
bun run build   # production bundle into dist/
```

(The frontend's τ-mux SDK calls are no-ops outside the host, but the UI still
renders — useful for styling work.)
