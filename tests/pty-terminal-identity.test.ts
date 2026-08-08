/**
 * What a PTY child is told about the terminal it is running in.
 *
 * Two separate contracts:
 *
 *   1. We announce ourselves — `TERM_PROGRAM=tau-mux` plus a version.
 *      Programs branch on this; Claude Code uses it to decide which
 *      terminal's Shift+Enter setup to offer.
 *
 *   2. We do NOT pass on someone else's identity. `PtyManager` copies
 *      `process.env` wholesale, so a dev build launched from iTerm2 used
 *      to hand every pane `ITERM_SESSION_ID` — and programs that found
 *      it went on to offer (and perform) iTerm2-specific setup against
 *      preference files for an app the user was not looking at.
 *
 * (2) is asserted end-to-end against a real shell, because the failure
 * mode was precisely that the unit-level intent ("we set TERM_PROGRAM")
 * was true while the shipped environment still said iTerm2.
 */
import { describe, test, expect, afterEach } from "bun:test";
import {
  INHERITED_TERMINAL_IDENTITY_VARS,
  PtyManager,
  scrubInheritedTerminalIdentity,
} from "../src/bun/pty-manager";
import { APP_VERSION, TERM_PROGRAM_NAME } from "../src/shared/brand";

async function waitFor(
  fn: () => boolean,
  timeout = 8000,
  interval = 25,
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await Bun.sleep(interval);
  }
}

describe("scrubInheritedTerminalIdentity", () => {
  test("removes every known foreign identity variable", () => {
    const env: Record<string, string> = {};
    for (const k of INHERITED_TERMINAL_IDENTITY_VARS) env[k] = "leaked";
    scrubInheritedTerminalIdentity(env);
    expect(Object.keys(env)).toEqual([]);
  });

  test("leaves our own identity and unrelated variables alone", () => {
    const env: Record<string, string> = {
      TERM_PROGRAM: "tau-mux",
      TERM_PROGRAM_VERSION: "1.2.3",
      TERM: "xterm-256color",
      PATH: "/usr/bin",
      HOME: "/Users/x",
      ITERM_SESSION_ID: "w0t0p0",
    };
    scrubInheritedTerminalIdentity(env);
    expect(env).toEqual({
      TERM_PROGRAM: "tau-mux",
      TERM_PROGRAM_VERSION: "1.2.3",
      TERM: "xterm-256color",
      PATH: "/usr/bin",
      HOME: "/Users/x",
    });
  });

  test("is a no-op on a clean environment", () => {
    const env = { PATH: "/usr/bin" };
    scrubInheritedTerminalIdentity(env);
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  test("covers the terminals whose identity vars are commonly inherited", () => {
    // Guards against someone trimming the list back to just iTerm2.
    for (const k of [
      "TERM_SESSION_ID",
      "ITERM_SESSION_ID",
      "LC_TERMINAL",
      "KITTY_WINDOW_ID",
      "GHOSTTY_RESOURCES_DIR",
      "WEZTERM_PANE",
      "ALACRITTY_WINDOW_ID",
      "WT_SESSION",
      "VTE_VERSION",
    ]) {
      expect(INHERITED_TERMINAL_IDENTITY_VARS).toContain(k);
    }
  });
});

describe("PTY environment (live shell)", () => {
  let pty: PtyManager;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    pty?.destroy();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("announces tau-mux and drops the launcher's identity", async () => {
    // Simulate being launched from iTerm2 (`bun start` from a terminal).
    for (const k of ["TERM_PROGRAM", "ITERM_SESSION_ID", "LC_TERMINAL"]) {
      saved[k] = process.env[k];
    }
    process.env["TERM_PROGRAM"] = "iTerm.app";
    process.env["ITERM_SESSION_ID"] = "w0t0p0:LEAKED";
    process.env["LC_TERMINAL"] = "iTerm2";

    pty = new PtyManager();
    let out = "";
    pty.onStdout = (data) => {
      out += data;
    };
    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    await waitFor(() => out.includes("$ ") || out.includes("% "));
    pty.write(
      'echo "P=[$TERM_PROGRAM] V=[$TERM_PROGRAM_VERSION] ' +
        'I=[$ITERM_SESSION_ID] L=[$LC_TERMINAL] T=[$TERM] C=[$COLORTERM]"\n',
    );
    await waitFor(() => /P=\[[^\]]*\] V=/.test(out.split("echo").pop() ?? ""));

    // Read the echoed *result* line, not the command line the shell
    // echoed back — the latter contains the unexpanded `$VAR` text.
    const result = out
      .split(/\r?\n/)
      .reverse()
      .find((l) => l.includes("P=[") && !l.includes("$TERM_PROGRAM"));
    expect(result).toBeDefined();

    expect(result).toContain(`P=[${TERM_PROGRAM_NAME}]`);
    expect(result).toContain(`V=[${APP_VERSION}]`);
    // The launcher's identity is gone, not merely overwritten.
    expect(result).toContain("I=[]");
    expect(result).toContain("L=[]");
    // And the colour contract Claude Code reads for 24-bit support.
    expect(result).toContain("T=[xterm-256color]");
    expect(result).toContain("C=[truecolor]");
  }, 20000);
});
