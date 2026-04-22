#!/usr/bin/env bun
/**
 * τ-mux animation audit — enforces design guideline §10.
 *
 *   "Animations: reserved for *state*, not ornament. Allowed:
 *     • tauBlink        — 1.1 s on cursors
 *     • tauPulse        — 1.4 s on running session dots
 *     • tauGlowPulse    — on the τ logo when τ-mux itself is processing
 *     • dashed-edge offset — on live graph edges in Atlas
 *     • ticker scroll   — linear, 60 s loop
 *    Nothing else animates."
 *
 * This script enumerates every `@keyframes` in src/views/terminal/
 * index.css and classifies it as:
 *   (1) §10 canonical   — one of the five approved keyframes
 *   (2) state-exception — spinners, dialog entrances, input-shake;
 *                         documented as state signals below
 *   (3) VIOLATION       — any keyframe not in either bucket
 *
 * Fails with a non-zero exit if (3) is non-empty. Pair with
 * `bun run audit:emoji` for the full §0 + §10 compliance gate.
 *
 * To add a new keyframe, either:
 *   - name it `tau<Something>` and cite the guideline section it
 *     implements (e.g. `tauAtlasHalo` maps to §9.3 active-node pulse),
 *     then add to CANONICAL below, OR
 *   - document the state signal it conveys in STATE_EXCEPTIONS below
 *     with a one-line rationale.
 *
 * Never add ornamental animations.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CSS_PATH = resolve(ROOT, "src/views/terminal/index.css");

/** §10-approved canonical keyframes + τ-mux extensions that follow
 *  the same naming convention and cite a specific guideline section. */
const CANONICAL = new Set([
  "tauBlink", // §10: 1.1 s cursor blink
  "tauPulse", // §10: 1.4 s running-session dot pulse
  "tauGlowPulse", // §10: τ logo processing pulse
  "tauDash", // §9.3: active graph edge stroke-dashoffset
  "tauTickerScroll", // §9.3: Atlas activity ticker, 60 s linear
  "tauAtlasHalo", // §9.3: active-node pulsing halo (r + opacity)
]);

/** Functional state animations that predate the revamp and convey a
 *  state signal per §10 ("reserved for state, not ornament"). Each
 *  entry is the keyframe name + the state it signals. Adding to this
 *  list requires a rationale — review carefully. */
const STATE_EXCEPTIONS: Record<string, string> = {
  // Spinners (indeterminate loading state — a user-facing "something
  // is happening" signal; removing them would leave the user without
  // progress feedback).
  "agent-spin":
    "Agent-panel indeterminate request spinner. State: awaiting LLM response.",
  "browser-spin":
    "Browser-pane page-load spinner. State: navigation in progress.",

  // Cursor blink — the agent-panel input uses its own variant
  // because xterm drives the terminal cursor separately.
  "agent-cursor-blink":
    "Agent-panel input cursor blink — mirrors §10 tauBlink semantics.",

  // Dialog / menu entrance transitions — visual state transitions on
  // overlay mount/unmount. Make appearance deterministic for the eye.
  "agent-dd-in": "Agent-panel dropdown entrance. State: menu just opened.",
  "agent-dialog-in":
    "Agent-panel dialog content entrance. State: modal opened.",
  "agent-dialog-bg-in":
    "Agent-panel dialog backdrop fade-in. State: modal opened.",
  "agent-fade-in": "Generic agent-panel content fade-in. State: view mounted.",
  "agent-msg-in": "New chat message entrance. State: message arrived.",
  "agent-slash-in": "Agent-panel slash-menu entrance. State: menu opened.",
  "agent-tc-body-in":
    "Agent-panel tool-call body entrance. State: tool call mounted.",
  "section-body-in": "Sidebar section body expansion. State: section unfolded.",

  // Functional pulses (agent chrome — these map to the same state
  // signals as tauPulse but with slight timing/shape differences
  // calibrated to the specific chrome they sit on).
  "agent-bar-sweep":
    "Agent-panel tool-call progress sweep. State: tool call running.",
  "agent-chip-pulse":
    "Agent-panel toolbar chip pulse. State: attention-worthy update.",
  "agent-glyph-pulse": "Agent-panel glyph pulse. State: active process.",
  "agent-think-pulse": "Agent-panel thinking indicator. State: LLM reasoning.",

  // Input validation shake — state signal for "invalid input".
  "prompt-input-shake":
    "Prompt-dialog validation shake. State: invalid entry, retry.",

  // Notification accent pulses — identity-aware variants kept after
  // the Phase-5 cyan/amber blend was removed.
  "notification-glow-pulse":
    "Sidebar notification attention pulse. State: new arrival.",
  "notify-bar-flash":
    "Pane-header flash on notification. State: new arrival on that pane.",
  "notify-glow-pulse":
    "Surface-container notification glow — default (amber) variant.",
  "notify-glow-pulse-human":
    "Surface-container notification glow — human (cyan) identity variant.",

  // Sidebar-v2 state signals.
  "sb-notif-glow":
    "Sidebar-v2 notification row attention. State: unread notification.",
  "sb-script-pulse":
    "Sidebar-v2 running-script dot pulse. State: script running.",
  "sb-server-dot-pulse":
    "Sidebar-v2 server dot pulse. State: connecting / retrying.",
};

interface AuditResult {
  canonical: string[];
  stateExceptions: string[];
  violations: string[];
}

function audit(): AuditResult {
  const css = readFileSync(CSS_PATH, "utf-8");
  const defined = new Set<string>();
  const re = /@keyframes\s+([a-zA-Z_][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) defined.add(m[1]!);

  const canonical: string[] = [];
  const stateExceptions: string[] = [];
  const violations: string[] = [];
  for (const name of Array.from(defined).sort()) {
    if (CANONICAL.has(name)) canonical.push(name);
    else if (name in STATE_EXCEPTIONS) stateExceptions.push(name);
    else violations.push(name);
  }
  return { canonical, stateExceptions, violations };
}

const r = audit();
console.log(`[animation-audit] scanning ${CSS_PATH}`);
console.log(`  canonical (§10):        ${r.canonical.length}`);
for (const n of r.canonical) console.log(`    · ${n}`);
console.log(`  state exceptions:        ${r.stateExceptions.length}`);
for (const n of r.stateExceptions) {
  const rationale = STATE_EXCEPTIONS[n] ?? "";
  console.log(`    · ${n} — ${rationale}`);
}

if (r.violations.length === 0) {
  console.log(`\n[animation-audit] clean — 0 violations.`);
  process.exit(0);
}

console.error(
  `\n[animation-audit] FAIL — ${r.violations.length} unlisted keyframe(s):`,
);
for (const n of r.violations) console.error(`    · ${n}`);
console.error(
  `\nAdd to CANONICAL (for tau-prefixed guideline-citing frames) or`,
);
console.error(`STATE_EXCEPTIONS (with a one-line state-signal rationale) in`);
console.error(`scripts/audit-animations.ts — or delete the keyframe.`);
process.exit(1);
