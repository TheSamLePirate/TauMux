# RPC Socket & CLI System

The RPC System enables fully decoupled communication between external tools (like the `ht` CLI), the Bun backend, and the Electrobun Webview. It uses a Unix Domain Socket to route JSON-RPC style messages.

## Core Components

- **`SocketServer`** (`src/bun/socket-server.ts`): Creates a Unix socket (default: `/tmp/hyperterm.sock`). It accepts incoming newline-delimited JSON messages. When a message is received, it extracts the `method` and `params` and passes them to the internal `RpcHandler`. It responds with a JSON string containing the request `id` and either a `result` or `error` object.
- **`RpcHandler`** (`src/bun/rpc-handler.ts`): The master router containing 29 defined RPC methods spanning:
  - System (`ping`, `tree`, `capabilities`)
  - Workspaces (`create`, `list`, `close`)
  - Surfaces/Panes (`split`, `focus`, `send_text`, `read_text`)
  - Sidebar (`set_status`, `log`)
  - Notifications
  It receives a Redux-like `dispatch` method to update the Electrobun frontend, and a `requestWebview` callback for methods that require a synchronous response from the DOM (like `read_text`).
- **CLI Tool (`bin/ht`)**: A lightweight script mapping CLI arguments directly into JSON-RPC payload structures, which it fires over the Unix socket.

## Flow Example (Creating a Split Pane)

1. User runs `ht new-split right`.
2. `bin/ht` maps this to `{ method: "surface.split", params: { direction: "right" } }`.
3. Payload is stringified and written to `/tmp/hyperterm.sock`.
4. `SocketServer` reads the chunk, parses it, and calls `rpc-handler.ts`.
5. `surface.split` handler executes `dispatch("splitSurface", { direction: "horizontal" })`.
6. `Electrobun` forwards this dispatch to the Webview.
7. Webview recomputes the Binary Tree layout, creates a new Xterm instance, and signals back to Bun to spawn a new PTY.

## Critiques & Limitations

- **No Argument Validation Scheme:** The RPC Handler trusts incoming parameters implicitly (e.g., `params["direction"] as string`). There is no strict schema validation (like Zod or JSONSchema). Malformed params could trigger undefined behaviors or crash the Bun process.
- **Missing Getters for State:** As noted in previous analysis, while there are methods to mutate the state (e.g., `set-status`), there are no RPC methods to read the current Sidebar state, Logs, or active Notifications. This makes it impossible to build external polling scripts or dashboards tracking the terminal's state.
- **CLI Argument Parsing:** `bin/ht` uses a rudimentary custom flag parser (`parseFlags`). It successfully handles `--key value` but does not support `--key=value` or deeply nested object structures.
- **Undocumented CLI Commands:** `bin/ht`'s `printHelp()` function is missing documentation for several functional commands implemented in the `switch (command)` block (e.g., `log`, `notify`, `list-notifications`, `capture-pane`).