/**
 * Small safe subprocess helpers for shareBin utilities.
 *
 * The parsers in `show_ports`, `show_proc`, and `show_env` depend on
 * command output staying locale-stable. This helper centralises the
 * timeout + `LC_ALL=C`/`LANG=C` defaults and never throws for normal
 * command failures.
 */

export interface RunTextOptions {
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface RunTextResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
}

export async function runText(
  cmd: readonly string[],
  opts: RunTextOptions = {},
): Promise<RunTextResult> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  let timedOut = false;
  try {
    const proc = Bun.spawn([...cmd], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts.cwd,
      env: {
        ...process.env,
        LC_ALL: "C",
        LANG: "C",
        ...opts.env,
      },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* process may already be gone */
      }
    }, timeoutMs);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited.catch(() => null),
    ]);
    clearTimeout(timer);

    return { stdout, stderr, exitCode, timedOut };
  } catch (err) {
    return {
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut,
      error: (err as Error).message,
    };
  }
}

export async function firstSuccessfulText(
  commands: readonly (readonly string[])[],
  opts: RunTextOptions = {},
): Promise<RunTextResult> {
  let last: RunTextResult = {
    stdout: "",
    stderr: "",
    exitCode: null,
    timedOut: false,
    error: "no command attempted",
  };
  for (const cmd of commands) {
    const result = await runText(cmd, opts);
    last = result;
    if (result.exitCode === 0 && result.stdout.trim().length > 0) return result;
  }
  return last;
}
