// Backend entry — runs inside the extension's Bun process. Drives τ-mux
// control surfaces over the unix socket and exchanges app-level messages with
// the frontend (the iframe) over stdin/stdout JSONL, all via @tau-mux/sdk.

import { createBackendSdk } from "@tau-mux/sdk/backend";

const sdk = createBackendSdk();

// --- Startup --------------------------------------------------------------
// Announce ourselves in the sidebar log + a notification. Both are
// best-effort; the process must stay up even if the host RPC isn't ready.
try {
  void sdk.sidebar.log({
    message: `three-demo backend up on ${sdk.surfaceId}`,
  });
} catch {
  /* best-effort */
}
try {
  void sdk.notification.create({
    title: "Three.js Demo",
    body: "Backend started",
  });
} catch {
  /* best-effort */
}

// --- Frontend ⇄ backend channel ------------------------------------------
// Echo whatever the frontend sends us back as a `pong`. The frontend pulses
// the cube's spin whenever a backend message arrives, so this round-trips
// visibly.
sdk.onMessage((data) => {
  try {
    sdk.send({ pong: data });
  } catch {
    /* best-effort */
  }
});

// --- Heartbeat ------------------------------------------------------------
// Periodically nudge the frontend so the scene reacts to its own backend even
// without user input. `process.stdin` (resumed by the SDK) keeps the event
// loop alive; this interval is just visible liveness.
const heartbeat = setInterval(() => {
  try {
    sdk.send({ tick: Date.now() });
  } catch {
    /* best-effort */
  }
}, 5000);

// --- Clean shutdown -------------------------------------------------------
function shutdown(): void {
  clearInterval(heartbeat);
  try {
    sdk.dispose();
  } catch {
    /* best-effort */
  }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
