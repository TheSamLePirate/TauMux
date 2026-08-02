#!/usr/bin/env bun
/**
 * Test double for `ht` used by tests/claude-permission.test.ts.
 *
 * Behavior is selected via FAKE_HT_MODE:
 *   allow    → `ask choice` prints "allow", exit 0
 *   deny     → prints "deny", exit 0
 *   terminal → prints "terminal", exit 0 (user chose the fallback)
 *   timeout  → exit 2 with nothing on stdout (ask timed out)
 *   hang     → never answers (bridge watchdog must kill us)
 *   error    → exit 1 (τ-mux unreachable)
 *
 * Every non-`ask` invocation (`claude event …`) is recorded to the file
 * named by FAKE_HT_LOG so the test can assert the shadow events.
 */
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = process.env["FAKE_HT_MODE"] ?? "allow";
const log = process.env["FAKE_HT_LOG"];

if (args[0] === "claude" && args[1] === "event") {
  if (log) appendFileSync(log, args[3] + "\n");
  process.exit(0);
}

if (args[0] === "ask") {
  switch (mode) {
    case "allow":
      console.log("allow");
      process.exit(0);
      break;
    case "deny":
      console.log("deny");
      process.exit(0);
      break;
    case "terminal":
      console.log("terminal");
      process.exit(0);
      break;
    case "timeout":
      process.exit(2);
      break;
    case "hang":
      setTimeout(() => process.exit(0), 60_000);
      break;
    default:
      process.exit(1);
  }
}
