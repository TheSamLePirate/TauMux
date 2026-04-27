---
title: JSON-RPC overview
description: How to talk to τ-mux over the Unix socket — framing, errors, method index.
sidebar:
  order: 1
---

τ-mux exposes a JSON-RPC API at `/tmp/hyperterm.sock` (override with `HT_SOCKET_PATH`). The same handler set is available over Electrobun RPC (used by the webview) and the WebSocket [web mirror](/features/web-mirror/).

## Connecting

The socket is a plain Unix domain socket. Speak newline-delimited JSON.

```bash
echo '{"id":"1","method":"system.ping","params":{}}' | nc -U /tmp/hyperterm.sock
# {"id":"1","result":"PONG"}
```

Or in code:

```ts
import { connect } from "node:net";

const s = connect("/tmp/hyperterm.sock");
s.write(JSON.stringify({ id: "1", method: "system.ping", params: {} }) + "\n");
s.on("data", (buf) => console.log(buf.toString()));
```

## Request shape

```json
{ "id": "<your-id>", "method": "domain.method", "params": { … } }
```

- `id` — string. Echoed back in the response. Use any unique value per request.
- `method` — `"<domain>.<name>"` (`system.ping`, `surface.split`, `browser.click`, …).
- `params` — object. Required parameters per method are documented in each domain page.

## Response shape

Success:

```json
{ "id": "<your-id>", "result": <any> }
```

Error:

```json
{ "id": "<your-id>", "error": "human-readable message" }
```

Unlike standard JSON-RPC 2.0, errors are plain strings rather than `{code, message, data}` objects. The `id` is always echoed.

## Streaming events

Some methods are **streams** rather than single-response calls — `surface.metadata` (live metadata changes), `browser.console_list` with `--follow`, etc. Streaming is opt-in per method.

In streaming mode, the server emits `{"id":"<your-id>","event":<payload>}` frames repeatedly until the client closes the socket or sends a `"<method>.cancel"` call. See [Web mirror protocol v2](/web-mirror/protocol-v2/) for the framing used over WebSocket.

## Method index

| Domain | Methods |
|---|---|
| [system](/api/system/) | ping, version, identify, capabilities, tree |
| [workspace](/api/workspace/) | list, current, create, select, close, rename, next, previous |
| [surface](/api/surface/) | list, split, close, focus, send_text, send_key, read_text, metadata, open_port, kill_port, kill_pid, screenshot |
| [sidebar](/api/sidebar/) | set_status, clear_status, set_progress, clear_progress, log |
| [pane](/api/pane/) | list |
| [notification](/api/notification/) | create, list, clear, dismiss |
| [browser](/api/browser/) | open, navigate, click, fill, wait, snapshot, eval, console_list, errors_list, history, … (40+) |
| [telegram](/api/telegram/) | list_chats, read, send, status, settings |

## Discoverability

Programmatically:

```bash
ht capabilities --json
```

Returns the full method catalogue with parameter shapes. Useful for agent integrations that should adapt to whatever version of τ-mux they're attached to.

## Validation

Every method validates `params` against a schema (`METHOD_SCHEMAS` in `src/bun/rpc-handlers/shared.ts`) before dispatch. Errors surface as `{"id", "error": "param X is required"}`.

## Source files

- `src/bun/socket-server.ts` — Unix socket server, framing.
- `src/bun/rpc-handler.ts` — dispatcher merging per-domain handlers.
- `src/bun/rpc-handlers/` — per-domain handler modules.
- `src/bun/rpc-handlers/shared.ts` — `METHOD_SCHEMAS`, `validateParams`.
- `src/shared/types.ts` — `TauMuxRPC` contract type.
