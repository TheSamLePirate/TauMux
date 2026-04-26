/**
 * OSC 9;4 — terminal progress reporting (de-facto standard from
 * ConEmu, now supported by Windows Terminal, WezTerm, Ghostty, modern
 * iTerm2, and most CI build tools).
 *
 * Wire format: `ESC ] 9 ; 4 ; <state> ; <progress> ESC \`
 *
 * State values:
 *   0  remove (clear progress)
 *   1  normal — progress 0..100 ints
 *   2  error  — progress optional; renders red
 *   3  indeterminate — progress ignored
 *   4  paused — progress optional; renders amber
 *
 * The `progress` field is optional for states 0/3 and may be empty
 * for 2/4. We accept any of these forms and clamp `progress` to
 * `[0..100]` when present.
 *
 * The xterm.js OSC parser strips the leading `9;`, so the payload
 * we see starts directly at the body — `4;1;42` for "normal 42%".
 * `parseOsc94Payload(body)` returns null for any payload that does
 * not match the OSC 9;4 sub-command — letting us share a single
 * OSC 9 handler with future sub-commands without colliding.
 */

export type Osc94State =
  | "remove"
  | "normal"
  | "error"
  | "indeterminate"
  | "paused";

export interface Osc94Update {
  state: Osc94State;
  /** 0..100 percent, or null when state is `remove` / `indeterminate`
   *  / state-without-value. Always integer (we round) so downstream
   *  consumers can treat it as a fixed-precision percent. */
  value: number | null;
}

const STATE_BY_CODE: Record<string, Osc94State> = {
  "0": "remove",
  "1": "normal",
  "2": "error",
  "3": "indeterminate",
  "4": "paused",
};

/** Parse the body of an OSC 9 payload (after the leading `9;`).
 *  Returns null if the body is not an OSC 9;4 progress message. */
export function parseOsc94Payload(body: string): Osc94Update | null {
  // The body's first segment must be `4` for the progress sub-command.
  // Anything else is a different OSC 9 dialect (notifications etc.) —
  // we leave those for the default xterm handlers by returning null.
  if (!body.startsWith("4;") && body !== "4") return null;
  const parts = body.split(";");
  if (parts[0] !== "4") return null;

  const stateRaw = parts[1] ?? "";
  const state = STATE_BY_CODE[stateRaw];
  if (!state) return null;

  // States that don't carry a meaningful value: ignore the progress
  // field even if it's present so callers can rely on a null sentinel.
  if (state === "remove" || state === "indeterminate") {
    return { state, value: null };
  }

  const valueRaw = parts[2];
  if (valueRaw === undefined || valueRaw === "") {
    // State emitted without a value (legal for 2/4) — render the
    // semantic colour but leave the bar at whatever level it was.
    return { state, value: null };
  }
  const n = Number(valueRaw);
  if (!Number.isFinite(n)) return null;
  return { state, value: clamp(Math.round(n), 0, 100) };
}

/** Map an OSC 9;4 state to a sidebar label so the user sees *why*
 *  the bar is the colour it is. Pass-through for `normal` lets the
 *  workspace card show the configured label instead. */
export function describeOsc94State(state: Osc94State): string | null {
  switch (state) {
    case "normal":
      return null; // let the workspace use whatever label was set
    case "remove":
      return null;
    case "error":
      return "error";
    case "indeterminate":
      return "working…";
    case "paused":
      return "paused";
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
