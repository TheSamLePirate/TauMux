/**
 * OSC 133 — semantic prompt marks, and the command blocks they define.
 *
 * ## What this buys
 *
 * τ-mux's design boast has always been "no shell integration": the
 * metadata poller reads real pids through libSystem, so cwd, foreground
 * command and ports work in any shell with zero config. That stays true
 * and stays the baseline.
 *
 * What it cannot give you is *boundaries*. The poller sees a process
 * exist and stop existing; it never learns that a command started at
 * this byte, ended at that one, and returned 2. The auto-continue engine
 * and Claude auto-approve currently infer those from patterns in a byte
 * stream, which is guesswork over a lossy channel.
 *
 * OSC 133 turns the guesses into facts, from the one component that
 * actually knows — the shell. So this is an *optional enhancement
 * layer*, installed the way the `ht` CLI is, never a requirement.
 *
 * ## The marks
 *
 * | Sequence | Meaning |
 * |---|---|
 * | `OSC 133 ; A ST` | prompt starts |
 * | `OSC 133 ; B ST` | prompt ends — what follows is what the user typed |
 * | `OSC 133 ; C ST` | command starts executing; what follows is its output |
 * | `OSC 133 ; D ; <exit> ST` | command finished with this exit status |
 *
 * We also read `OSC 633 ; E ; <commandline> ST`, VS Code's extension for
 * stating the command line explicitly. Our own integration script emits
 * it, because reading the command back out of the echoed region means
 * un-styling whatever the user's prompt framework painted over it.
 * Third-party OSC 133-only integrations still work — the echoed region
 * is the fallback.
 *
 * ## Memory
 *
 * Blocks are capped by count; captured output is capped by a per-surface
 * byte budget, oldest output dropped first. A terminal that has been
 * open for a week must not hold a week of build logs.
 */

/** Marks we understand, and the OSC numbers they arrive under. */
const OSC_SEMANTIC_PROMPT = 133;
const OSC_VSCODE = 633;

/** Blocks retained per surface. Beyond this the oldest are forgotten. */
export const MAX_BLOCKS = 50;

/** Total captured output retained per surface, across all blocks. */
export const MAX_OUTPUT_BUDGET = 64 * 1024;

/** Per-block output cap, so one `yes` cannot evict everything else. */
export const MAX_BLOCK_OUTPUT = 16 * 1024;

/** Longest partial escape sequence carried between PTY reads. OSC
 *  payloads can be long (a command line); this bounds what a truncated
 *  one can cost us. */
const MAX_CARRY = 4096;

export interface CommandBlock {
  /** Monotonic per-surface id. */
  id: number;
  /** The command line, when known. Empty when the integration reported
   *  boundaries but not text and nothing was echoed. */
  command: string;
  /** Exit status, or null while the command is still running. */
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  /** Captured stdout/stderr, possibly truncated or dropped entirely
   *  once the surface's output budget needed the space. */
  output: string;
  outputTruncated: boolean;
}

type Phase = "idle" | "prompt" | "input" | "running";

/**
 * Consumes the raw PTY stream and maintains the block list.
 *
 * Pure with respect to the terminal: it never writes, and it tolerates a
 * stream with no integration at all (in which case it simply never
 * produces a block).
 */
export class CommandBlockTracker {
  private readonly done: CommandBlock[] = [];
  private running: CommandBlock | null = null;
  private phase: Phase = "idle";
  private counter = 0;
  private carry = "";
  /** Text echoed between `B` and `C` — the fallback command source. */
  private echoed = "";
  /** Command line stated explicitly via OSC 633;E, which wins. */
  private declared: string | null = null;
  private outputBudget = MAX_OUTPUT_BUDGET;

  constructor(private readonly now: () => number = Date.now) {}

  /** True once any OSC 133 mark has been seen — i.e. the shell in this
   *  surface actually has the integration installed. Lets callers say
   *  "not installed" instead of "no commands yet". */
  integrationDetected = false;

  write(chunk: string): void {
    if (!chunk) return;

    // Fast path: no ESC at all means no marks and no partial sequence to
    // carry, so the whole chunk is output. Tests for `ESC` rather than
    // `ESC ]` on purpose — a read can end on a bare ESC whose `]` is in
    // the next one, and treating that as text loses the byte and with it
    // the whole sequence.
    if (this.carry.length === 0 && chunk.indexOf("\x1b") === -1) {
      this.consumeText(chunk);
      return;
    }

    const buf = this.carry + chunk;
    let cursor = 0;
    const re = /\x1b\](\d+);([^\x07\x1b]*)(\x07|\x1b\\)/g;
    for (let m = re.exec(buf); m !== null; m = re.exec(buf)) {
      this.consumeText(buf.slice(cursor, m.index));
      this.handleOsc(Number(m[1]), m[2] ?? "");
      cursor = m.index + m[0].length;
    }

    // Everything after the last complete sequence is either plain text
    // or the start of a sequence split across this read.
    const rest = buf.slice(cursor);
    const start = carryStart(rest);
    if (start === -1 || rest.length - start > MAX_CARRY) {
      this.consumeText(rest);
      this.carry = "";
    } else {
      this.consumeText(rest.slice(0, start));
      this.carry = rest.slice(start);
    }
  }

  private handleOsc(osc: number, payload: string): void {
    if (osc === OSC_VSCODE) {
      // `E;<commandline>` — the explicit form. Other 633 sub-commands
      // overlap with 133 and are ignored rather than double-counted.
      if (payload.startsWith("E;")) this.declared = payload.slice(2);
      return;
    }
    if (osc !== OSC_SEMANTIC_PROMPT) return;

    this.integrationDetected = true;
    const kind = payload[0];
    switch (kind) {
      case "A":
        // A new prompt implies the previous command ended, even if we
        // never saw its `D` — a shell killed mid-command, or an
        // integration that only emits some marks.
        this.finishRunning(null);
        this.phase = "prompt";
        this.echoed = "";
        this.declared = null;
        break;
      case "B":
        this.phase = "input";
        this.echoed = "";
        break;
      case "C":
        // Idempotent. Prompt frameworks emit their own OSC 133 —
        // Powerlevel10k does — so with our integration installed a
        // command is announced twice. Treating the second `C` as a new
        // command splits every block in half: one carrying the command
        // text with no exit code, one carrying the output and exit code
        // with no command. A repeated "output starts here" is a no-op.
        if (this.phase !== "running") this.startRunning();
        break;
      case "D":
        this.finishRunning(parseExitCode(payload));
        this.phase = "idle";
        break;
      default:
        break;
    }
  }

  private consumeText(text: string): void {
    if (!text) return;
    if (this.phase === "input") {
      // Bounded: a paste into the prompt should not be retained whole.
      if (this.echoed.length < MAX_BLOCK_OUTPUT) this.echoed += text;
      return;
    }
    if (this.phase === "running" && this.running) {
      const block = this.running;
      if (block.output.length >= MAX_BLOCK_OUTPUT) {
        block.outputTruncated = true;
        return;
      }
      const room = MAX_BLOCK_OUTPUT - block.output.length;
      if (text.length > room) {
        block.output += text.slice(0, room);
        block.outputTruncated = true;
      } else {
        block.output += text;
      }
    }
  }

  private startRunning(): void {
    this.finishRunning(null);
    this.running = {
      id: ++this.counter,
      command: this.declared ?? extractCommand(this.echoed),
      exitCode: null,
      startedAt: this.now(),
      endedAt: null,
      durationMs: null,
      output: "",
      outputTruncated: false,
    };
    this.phase = "running";
    this.echoed = "";
    this.declared = null;
  }

  private finishRunning(exitCode: number | null): void {
    const block = this.running;
    if (!block) return;
    this.running = null;
    block.exitCode = exitCode;
    block.endedAt = this.now();
    block.durationMs = block.endedAt - block.startedAt;
    this.done.push(block);
    while (this.done.length > MAX_BLOCKS) this.done.shift();
    this.enforceOutputBudget();
  }

  /** Drop the oldest captured output until the surface is back inside
   *  its budget. Metadata (command, exit code, timing) is kept — it is
   *  tiny and it is what `ht blocks` is mostly for. */
  private enforceOutputBudget(): void {
    let total = 0;
    for (const b of this.done) total += b.output.length;
    for (let i = 0; i < this.done.length && total > this.outputBudget; i++) {
      const b = this.done[i]!;
      if (!b.output) continue;
      total -= b.output.length;
      b.output = "";
      b.outputTruncated = true;
    }
  }

  /** Completed blocks, oldest first. */
  list(): readonly CommandBlock[] {
    return this.done;
  }

  /** The most recently *completed* block, or null. */
  last(): CommandBlock | null {
    return this.done.at(-1) ?? null;
  }

  /** The command currently executing, or null. */
  current(): CommandBlock | null {
    return this.running;
  }

  /** Forget everything — the surface's shell exited and a new one will
   *  start from a clean slate. */
  reset(): void {
    this.done.length = 0;
    this.running = null;
    this.phase = "idle";
    this.carry = "";
    this.echoed = "";
    this.declared = null;
  }
}

/**
 * An OSC that has begun but not terminated: `ESC ]`, optional number,
 * optional `;payload`, optionally a trailing `ESC` that may turn out to
 * be the first half of an `ESC \` terminator.
 */
const INCOMPLETE_OSC = /^\x1b\](\d*(;[^\x07\x1b]*)?)?\x1b?$/;

/**
 * Where in `rest` a partial escape sequence begins, or -1 if all of it
 * is plain text.
 *
 * The subtle case, and the one that broke the first implementation: a
 * read can end on a bare `ESC`, before the `]` that would identify it as
 * an OSC. Treating that as text loses the byte, and the sequence never
 * matches when its remainder arrives in the next read — which is
 * exactly what a one-byte-at-a-time stream looks like.
 *
 * A bare `ESC` that turns out to start something else (a CSI, say) is
 * carried harmlessly for one write and then flushed as text.
 */
function carryStart(rest: string): number {
  const oscIdx = rest.lastIndexOf("\x1b]");
  if (oscIdx !== -1 && INCOMPLETE_OSC.test(rest.slice(oscIdx))) return oscIdx;
  if (rest.endsWith("\x1b")) return rest.length - 1;
  return -1;
}

/** `D;2` / `D;2;whatever` → 2. `D` alone means "finished, status
 *  unknown", which is not the same as 0 and must not be reported as it. */
function parseExitCode(payload: string): number | null {
  const parts = payload.split(";");
  if (parts.length < 2) return null;
  const n = Number(parts[1]);
  return Number.isInteger(n) ? n : null;
}

/**
 * Recover the command line from the region the shell echoed between the
 * `B` and `C` marks.
 *
 * Only a fallback — our own integration states it outright — because
 * this region contains whatever the user's prompt framework painted:
 * syntax-highlighting SGR, autosuggestion ghost text erased with cursor
 * moves, right-hand prompts. Strip escapes, take the last line, and
 * accept that a heavily-themed zsh may still give an imperfect answer.
 */
export function extractCommand(echoed: string): string {
  const stripped = echoed
    // CSI
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // OSC (already consumed upstream, but be defensive)
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    // Two-byte escapes
    .replace(/\x1b[()][A-Za-z0-9]/g, "")
    .replace(/\x1b[=>]/g, "");
  const lines = stripped.split(/\r?\n|\r/).filter((l) => l.trim().length > 0);
  return (lines.at(-1) ?? "").trim();
}
