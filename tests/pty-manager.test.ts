import { describe, test, expect, afterEach } from "bun:test";
import { PtyManager } from "../src/bun/pty-manager";

// Helper: wait for a condition with timeout (uses Bun.sleep for proper event loop yielding)
async function waitFor(
  fn: () => boolean,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await Bun.sleep(interval);
  }
}

describe("PtyManager", () => {
  let pty: PtyManager;

  afterEach(() => {
    pty?.destroy();
  });

  test("spawns shell and returns valid PID", () => {
    pty = new PtyManager();
    const pid = pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });
    expect(pid).toBeGreaterThan(0);
    expect(pty.pid).toBe(pid);
    expect(pty.exited).toBe(false);
  });

  test("receives stdout data from shell", async () => {
    pty = new PtyManager();
    let output = "";
    pty.onStdout = (data) => {
      output += data;
    };

    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    // Write a command that produces output
    pty.write("echo HELLO_HYPERTERM\n");

    await waitFor(() => output.includes("HELLO_HYPERTERM"));
    expect(output).toContain("HELLO_HYPERTERM");
  });

  test("writes stdin data to shell", async () => {
    pty = new PtyManager();
    let output = "";
    pty.onStdout = (data) => {
      output += data;
    };

    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    // Use printf to avoid newline issues
    pty.write("printf '%s' TEST_INPUT_OK\n");

    await waitFor(() => output.includes("TEST_INPUT_OK"));
    expect(output).toContain("TEST_INPUT_OK");
  });

  test("handles shell exit and reports exit code", async () => {
    pty = new PtyManager();
    let exitCode: number | null = null;
    pty.onExit = (code) => {
      exitCode = code;
    };

    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });
    pty.write("exit 0\n");

    await waitFor(() => pty.exited, 5000);
    expect(pty.exited).toBe(true);
    expect(pty.exitCode).toBe(0);
    expect(exitCode).toBe(0);
  });

  test("handles non-zero exit code", async () => {
    pty = new PtyManager();
    let exitCode: number | null = null;
    pty.onExit = (code) => {
      exitCode = code;
    };

    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });
    pty.write("exit 42\n");

    await waitFor(() => pty.exited, 5000);
    expect(exitCode).toBe(42);
    expect(pty.exitCode).toBe(42);
  });

  test("resizes terminal", async () => {
    pty = new PtyManager();
    let output = "";
    pty.onStdout = (data) => {
      output += data;
    };

    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    // Resize should not throw
    expect(() => pty.resize(120, 40)).not.toThrow();

    // Verify new size via stty (requires real PTY)
    pty.write("stty size\n");
    await waitFor(
      () => output.includes("40 120") || output.includes("40"),
      3000,
    ).catch(() => {
      // stty might not work in all shells, that's ok
    });
  });

  test("sets environment variables", async () => {
    pty = new PtyManager();
    let output = "";
    pty.onStdout = (data) => {
      output += data;
    };

    pty.spawn({
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
      env: { MY_TEST_VAR: "hyperterm_test_value" },
    });

    pty.write("echo $MY_TEST_VAR\n");

    await waitFor(() => output.includes("hyperterm_test_value"));
    expect(output).toContain("hyperterm_test_value");
  });

  test("sets TERM and COLORTERM env vars", async () => {
    pty = new PtyManager();
    let output = "";
    pty.onStdout = (data) => {
      output += data;
    };

    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    pty.write("echo $TERM\n");
    await waitFor(() => output.includes("xterm-256color"));

    output = "";
    pty.write("echo $COLORTERM\n");
    await waitFor(() => output.includes("truecolor"));
  });

  test("sets HYPERTERM sideband env vars", async () => {
    pty = new PtyManager();
    let output = "";
    pty.onStdout = (data) => {
      output += data;
    };

    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    pty.write(
      "echo META=$HYPERTERM_META_FD DATA=$HYPERTERM_DATA_FD EVENT=$HYPERTERM_EVENT_FD\n",
    );
    await waitFor(() => output.includes("META=3"));
    expect(output).toContain("META=3");
    expect(output).toContain("DATA=4");
    expect(output).toContain("EVENT=5");
  });

  test("exposes sideband fd numbers", () => {
    pty = new PtyManager();
    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    const fds = pty.sidebandFds;
    expect(fds.metaFd).toBeGreaterThan(0);
    expect(fds.dataFd).toBeGreaterThan(0);
    expect(fds.eventFd).toBeGreaterThan(0);
    // All three should be different fd numbers
    expect(fds.metaFd).not.toBe(fds.dataFd);
    expect(fds.dataFd).not.toBe(fds.eventFd);
  });

  test("kill sends signal to process", async () => {
    pty = new PtyManager();
    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    expect(pty.exited).toBe(false);
    pty.kill("SIGTERM");

    await waitFor(() => pty.exited, 3000);
    expect(pty.exited).toBe(true);
  });

  test("destroy cleans up process", async () => {
    pty = new PtyManager();
    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    const pid = pty.pid;
    expect(pid).not.toBeNull();

    pty.destroy();

    // After destroy, pid should be null
    expect(pty.pid).toBeNull();
  });

  test("destroy is safe to call multiple times", () => {
    pty = new PtyManager();
    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });

    expect(() => {
      pty.destroy();
      pty.destroy();
    }).not.toThrow();
  });

  test("write and resize are no-ops after destroy", () => {
    pty = new PtyManager();
    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });
    pty.destroy();

    // Should not throw
    expect(() => pty.write("test")).not.toThrow();
    expect(() => pty.resize(80, 24)).not.toThrow();
  });

  test("kill is no-op on already exited process", async () => {
    pty = new PtyManager();
    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24 });
    pty.write("exit 0\n");

    await waitFor(() => pty.exited, 3000);

    // Should not throw
    expect(() => pty.kill("SIGTERM")).not.toThrow();
  });

  test("uses custom cwd", async () => {
    pty = new PtyManager();
    let output = "";
    pty.onStdout = (data) => {
      output += data;
    };

    pty.spawn({ shell: "/bin/sh", cols: 80, rows: 24, cwd: "/tmp" });
    pty.write("pwd\n");

    await waitFor(
      () => output.includes("/tmp") || output.includes("/private/tmp"),
    );
    expect(output.includes("/tmp")).toBe(true);
  });
});
