# Sideband Protocol System

The Sideband Protocol is the unique mechanism that distinguishes HyperTerm Canvas from traditional terminal emulators. It allows scripts running inside the terminal (like Python, Bash, Node) to render structured UI components (SVG, HTML, Images) as floating overlays, bypassing the standard PTY character grid.

## Architecture

The protocol uses three extra POSIX file descriptors mapped into the child process at startup:

1. **FD 3 (Meta Channel):** A unidirectional pipe from the script to the terminal. Sends JSONL (JSON Lines) representing panel metadata (id, type, dimensions, position).
2. **FD 4 (Data Channel):** A unidirectional pipe from the script to the terminal. Sends raw binary payloads (like PNG image bytes).
3. **FD 5 (Event Channel):** A unidirectional pipe from the terminal back to the script. Sends JSONL containing user interactions (clicks, drags, resizes, closures) related to the generated panels.

### `SidebandParser` (`src/bun/sideband-parser.ts`)

This class reads streams from `fd3` and `fd4`.
- It continually reads `fd3` using `Bun.file(fd).stream()`.
- Upon parsing a complete JSON message, it checks the `byteLength` property.
- If `byteLength > 0`, it switches over to `fd4` and reads exactly `n` bytes synchronously (buffering any leftovers) before emitting the `onData` event.
- This strict interleaving guarantees that metadata and binary data are synchronized correctly.

### `EventWriter` (`src/bun/event-writer.ts`)

A lightweight class wrapping `fd5`. When the user interacts with a canvas panel in the Webview, the UI sends an RPC call back to Bun. Bun then serializes the event as JSON and writes it to `fd5` using `Bun.write(Bun.file(this.fd), ...)`. The script running in the terminal can read this fd to trigger callbacks (e.g., Python `ht.events()`).

## Critiques & Limitations

- **Blocking Reads on `fd4`:** The `processMetaBuffer` loop halts processing of subsequent metadata messages until all expected binary bytes are read from `fd4`. If a script incorrectly sends metadata with a large `byteLength` but fails to write the data to `fd4`, the parser will hang indefinitely waiting for bytes, blocking all future canvas updates for that surface.
- **Leftover Data Edge Case:** `readExactBytes` attempts to slice data nicely using `this.dataLeftover`. However, if the underlying file stream yields small chunks, it can create a lot of temporary `Uint8Array` objects before combining them, which might create unnecessary GC pressure if transferring a massive 4K raw image.
- **Write Errors Silently Swallowed:** `EventWriter` catches write errors and simply returns `false` without logging. If the `fd5` pipe breaks (e.g., child process closes it but hasn't exited yet), debugging dropped UI events can become opaque to developers using the client libraries.