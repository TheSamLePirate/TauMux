/**
 * OSC 133 command blocks.
 *
 * These are the facts the metadata poller structurally cannot give:
 * where a command began, where it ended, and what it returned. The
 * parser has to survive a stream that was never designed for it —
 * sequences split across PTY reads, prompt frameworks painting escape
 * codes over the echoed command, integrations that emit only some of
 * the marks.
 */
import { describe, test, expect } from "bun:test";
import {
  CommandBlockTracker,
  MAX_BLOCKS,
  MAX_BLOCK_OUTPUT,
  extractCommand,
} from "../src/bun/command-blocks";

const A = "\x1b]133;A\x07";
const B = "\x1b]133;B\x07";
const C = "\x1b]133;C\x07";
const D = (code: number | string = 0) => `\x1b]133;D;${code}\x07`;
const E = (cmd: string) => `\x1b]633;E;${cmd}\x07`;

/** A whole prompt→command→output→done cycle. */
function cycle(command: string, output: string, exit = 0): string {
  return `${A}$ ${B}${E(command)}${C}${output}${D(exit)}`;
}

describe("integration detection", () => {
  test("a stream with no marks produces nothing", () => {
    const t = new CommandBlockTracker();
    t.write("$ ls\r\nfile-a  file-b\r\n$ ");
    expect(t.integrationDetected).toBe(false);
    expect(t.list()).toEqual([]);
    expect(t.last()).toBeNull();
  });

  test("one mark is enough to say the shell is reporting", () => {
    // "No commands yet" and "not installed" must be distinguishable.
    const t = new CommandBlockTracker();
    t.write(A);
    expect(t.integrationDetected).toBe(true);
    expect(t.list()).toEqual([]);
  });
});

describe("a complete cycle", () => {
  test("captures command, exit code and output", () => {
    const t = new CommandBlockTracker();
    t.write(cycle("bun test", "3509 pass\r\n", 0));
    const b = t.last()!;
    expect(b.command).toBe("bun test");
    expect(b.exitCode).toBe(0);
    expect(b.output).toBe("3509 pass\r\n");
    expect(b.outputTruncated).toBe(false);
    expect(b.running).toBeUndefined();
  });

  test("a non-zero exit is reported as itself", () => {
    const t = new CommandBlockTracker();
    t.write(cycle("false", "", 1));
    expect(t.last()!.exitCode).toBe(1);
  });

  test("timing is recorded", () => {
    let now = 1000;
    const t = new CommandBlockTracker(() => now);
    t.write(`${A}$ ${B}${E("sleep 1")}${C}`);
    now = 4200;
    t.write(D(0));
    const b = t.last()!;
    expect(b.startedAt).toBe(1000);
    expect(b.endedAt).toBe(4200);
    expect(b.durationMs).toBe(3200);
  });

  test("several commands accumulate oldest-first", () => {
    const t = new CommandBlockTracker();
    t.write(cycle("one", "", 0));
    t.write(cycle("two", "", 1));
    t.write(cycle("three", "", 0));
    expect(t.list().map((b) => b.command)).toEqual(["one", "two", "three"]);
    expect(t.last()!.command).toBe("three");
  });
});

describe("the running command", () => {
  test("is exposed before it finishes", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("npm run dev")}${C}listening on 3000\r\n`);
    const cur = t.current()!;
    expect(cur.command).toBe("npm run dev");
    expect(cur.exitCode).toBeNull();
    expect(cur.output).toBe("listening on 3000\r\n");
    // Not finished, so not in the completed list yet.
    expect(t.list()).toEqual([]);
    expect(t.last()).toBeNull();
  });

  test("moves to the list when it finishes", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("x")}${C}out`);
    t.write(D(7));
    expect(t.current()).toBeNull();
    expect(t.last()!.exitCode).toBe(7);
  });
});

describe("incomplete integrations", () => {
  test("a new prompt closes a command that never reported D", () => {
    // A shell killed mid-command, or an integration emitting only A/B/C.
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("hang")}${C}partial`);
    t.write(A);
    const b = t.last()!;
    expect(b.command).toBe("hang");
    // Unknown is null — emphatically not 0.
    expect(b.exitCode).toBeNull();
    expect(b.output).toBe("partial");
  });

  test("D with no status reports null, not success", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("x")}${C}\x1b]133;D\x07`);
    expect(t.last()!.exitCode).toBeNull();
  });

  test("a non-numeric status is null", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("x")}${C}${D("oops")}`);
    expect(t.last()!.exitCode).toBeNull();
  });

  test("a duplicate C from a prompt framework does not split the block", () => {
    // Found against a real zsh: Powerlevel10k emits its own OSC 133, so
    // with our integration installed every command is announced twice.
    // Treating the second `C` as a new command produced two half-blocks
    // per command — one with the text and no exit code, one with the
    // output and exit code but no text.
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("echo hi")}${C}${C}hi\r\n${D(0)}`);
    expect(t.list().length).toBe(1);
    const b = t.last()!;
    expect(b.command).toBe("echo hi");
    expect(b.exitCode).toBe(0);
    expect(b.output).toBe("hi\r\n");
  });

  test("a duplicate C arriving mid-output is still a no-op", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("x")}${C}first ${C}second${D(0)}`);
    expect(t.list().length).toBe(1);
    expect(t.last()!.output).toBe("first second");
  });

  test("without OSC 633;E the command comes from the echoed region", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}git status --short${C}M  file\r\n${D(0)}`);
    expect(t.last()!.command).toBe("git status --short");
  });
});

describe("split across PTY reads", () => {
  test("a mark split mid-payload is still recognised", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("ls")}\x1b]133;`);
    t.write(`C\x07output${D(0)}`);
    expect(t.last()!.command).toBe("ls");
    expect(t.last()!.output).toBe("output");
  });

  test("a mark split immediately after ESC is recognised", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("ls")}${C}out\x1b`);
    t.write(`]133;D;3\x07`);
    expect(t.last()!.exitCode).toBe(3);
  });

  test("one byte at a time still yields a correct block", () => {
    const t = new CommandBlockTracker();
    for (const ch of cycle("echo hi", "hi\r\n", 0)) t.write(ch);
    const b = t.last()!;
    expect(b.command).toBe("echo hi");
    expect(b.output).toBe("hi\r\n");
    expect(b.exitCode).toBe(0);
  });

  test("output spanning several reads is concatenated", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("cat")}${C}`);
    t.write("part one ");
    t.write("part two ");
    t.write("part three");
    t.write(D(0));
    expect(t.last()!.output).toBe("part one part two part three");
  });

  test("ST-terminated marks work as well as BEL-terminated ones", () => {
    const t = new CommandBlockTracker();
    t.write("\x1b]133;A\x1b\\$ \x1b]133;B\x1b\\");
    t.write("\x1b]633;E;pwd\x1b\\\x1b]133;C\x1b\\/tmp\r\n");
    t.write("\x1b]133;D;0\x1b\\");
    const b = t.last()!;
    expect(b.command).toBe("pwd");
    expect(b.output).toBe("/tmp\r\n");
    expect(b.exitCode).toBe(0);
  });
});

describe("output is not captured outside a command", () => {
  test("prompt text is not treated as output", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}user@host ~/project $ ${B}${E("ls")}${C}real output${D(0)}`);
    expect(t.last()!.output).toBe("real output");
  });

  test("text before any mark is discarded", () => {
    const t = new CommandBlockTracker();
    t.write("motd banner\r\n");
    t.write(cycle("ls", "out", 0));
    expect(t.last()!.output).toBe("out");
  });
});

describe("bounds", () => {
  test("blocks are capped, oldest forgotten", () => {
    const t = new CommandBlockTracker();
    for (let i = 0; i < MAX_BLOCKS + 10; i++) t.write(cycle(`cmd${i}`, "", 0));
    expect(t.list().length).toBe(MAX_BLOCKS);
    expect(t.list()[0]!.command).toBe("cmd10");
    expect(t.last()!.command).toBe(`cmd${MAX_BLOCKS + 9}`);
  });

  test("per-block output is truncated, and says so", () => {
    const t = new CommandBlockTracker();
    t.write(`${A}$ ${B}${E("yes")}${C}`);
    t.write("x".repeat(MAX_BLOCK_OUTPUT * 2));
    t.write(D(0));
    const b = t.last()!;
    expect(b.output.length).toBe(MAX_BLOCK_OUTPUT);
    expect(b.outputTruncated).toBe(true);
  });

  test("the surface budget drops old output but keeps metadata", () => {
    // A week-old build log must not still be resident; knowing that
    // `bun test` exited 1 three hours ago must survive.
    const t = new CommandBlockTracker();
    for (let i = 0; i < 10; i++) {
      t.write(`${A}$ ${B}${E(`cmd${i}`)}${C}`);
      t.write("y".repeat(MAX_BLOCK_OUTPUT));
      t.write(D(i));
    }
    const blocks = t.list();
    expect(blocks.length).toBe(10);
    // Metadata intact for every one.
    expect(blocks.map((b) => b.command)).toEqual(
      Array.from({ length: 10 }, (_, i) => `cmd${i}`),
    );
    expect(blocks.map((b) => b.exitCode)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    // Total retained output is inside the budget.
    const total = blocks.reduce((n, b) => n + b.output.length, 0);
    expect(total).toBeLessThanOrEqual(64 * 1024);
    // …and the newest block is the one that kept its output.
    expect(blocks.at(-1)!.output.length).toBeGreaterThan(0);
    expect(blocks[0]!.output).toBe("");
    expect(blocks[0]!.outputTruncated).toBe(true);
  });

  test("reset clears everything", () => {
    const t = new CommandBlockTracker();
    t.write(cycle("ls", "out", 0));
    t.reset();
    expect(t.list()).toEqual([]);
    expect(t.last()).toBeNull();
    expect(t.current()).toBeNull();
  });
});

describe("extractCommand", () => {
  test("strips SGR a prompt framework painted over the line", () => {
    expect(extractCommand("\x1b[1;32mgit\x1b[0m \x1b[34mstatus\x1b[0m")).toBe(
      "git status",
    );
  });

  test("takes the last non-empty line", () => {
    // Multi-line prompts echo their tail last.
    expect(extractCommand("first\r\nsecond\r\n")).toBe("second");
  });

  test("strips cursor movement from autosuggestion erasure", () => {
    expect(extractCommand("ls -la\x1b[6D\x1b[K")).toBe("ls -la");
  });

  test("trims surrounding whitespace", () => {
    expect(extractCommand("   npm run build   ")).toBe("npm run build");
  });

  test("empty input gives an empty command, not a crash", () => {
    expect(extractCommand("")).toBe("");
    expect(extractCommand("\x1b[0m\r\n")).toBe("");
  });
});
