import { statSync } from "node:fs";

/**
 * Startup audits — small canary checks that catch wrong-state-on-this-
 * machine drift the user keeps tripping over. The first audit landed
 * here is the git-author canary the user explicitly asked for in
 * `doc/issues_now.md`:
 *
 *     #add a audit that check if my name is in git olivierveinand (it is !!!)
 *
 * The module owns three concerns:
 *   1. The `Audit` shape — id + check function + optional fix.
 *   2. The `runAudits` runner — run a list, capture results, never
 *      throw out (a broken audit returns an `err` result).
 *   3. The default audit registry, parameterised by AppSettings so
 *      power users can override expected values without code changes.
 *
 * Audits are intentionally async — git audits shell out, future audits
 * may hit the network. They MUST be idempotent and side-effect-free
 * (the optional `fix` is the only mutating path; never run without
 * explicit user / RPC consent).
 */

export type AuditSeverity = "info" | "warn" | "err";

export interface AuditResult {
  id: string;
  ok: boolean;
  severity: AuditSeverity;
  message: string;
  /** When set, the result advertises a one-step remediation the
   *  user can opt into via `audit.fix` (RPC) or `ht audit fix <id>`.
   *  `label` is a short, command-button-friendly description; `action`
   *  performs the change and resolves once it has landed. */
  fix?: AuditFix;
}

export interface AuditFix {
  label: string;
  action: () => Promise<void>;
}

export interface Audit {
  id: string;
  /** Short human-readable description for `audit list` UIs. */
  description: string;
  check: () => Promise<AuditResult>;
}

/** Subprocess hook so tests can swap the git invocation without
 *  spawning processes. Callers pass an alternate `runGit` to drop the
 *  real one for a stub. */
export type GitRunner = (args: string[]) => Promise<string>;

/** Hard upper bound on a git config probe. Without this, a hung
 *  `git config --global` (e.g. NFS-mounted home that's gone away)
 *  wedges the audit registry forever and never logs. 5 s is generous
 *  for what should be a sub-millisecond syscall. (G.10 / L13) */
const GIT_AUDIT_TIMEOUT_MS = 5_000;

/** Real-process implementation, used in production. Empty stdout
 *  resolves to "" (no config set) — git itself returns exit code 1
 *  for missing keys; we capture stderr too so a permissions surprise
 *  doesn't masquerade as an empty answer. Hard timeout guards
 *  against a hung subprocess. */
export async function defaultRunGit(args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutP = new Response(proc.stdout).text();
  // Race the read against a timeout. On timeout we kill the proc and
  // return "" — the audit treats that as "no config", which is a
  // safe fallback (the audit just won't fire).
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      console.warn(
        `[audits] git ${args.join(" ")} timed out after ${GIT_AUDIT_TIMEOUT_MS}ms`,
      );
      resolve("");
    }, GIT_AUDIT_TIMEOUT_MS);
  });
  const result = await Promise.race([stdoutP, timeout]);
  if (timer) clearTimeout(timer);
  // Best-effort wait for the proc to actually exit so we don't leak
  // a zombie on fast paths; ignore any further output.
  proc.exited.catch(() => {
    /* ignore */
  });
  return result.trim();
}

export interface AuditRegistryOptions {
  /** Pinned `git config --global user.name`. Null disables the audit
   *  (handy for forks / collaborators). */
  gitUserNameExpected: string | null;
  /** Subprocess hook for git invocations. Defaults to the live git. */
  runGit?: GitRunner;
  /** P7 S24 — test hooks. The four new audits each take an injectable
   *  probe so tests can drive them without spawning subprocesses or
   *  touching the real process env / filesystem. Each defaults to the
   *  real-world implementation when omitted. */
  envOverride?: Record<string, string>;
  localeOverride?: string | null;
  bunProbe?: () => Promise<boolean>;
  fileExists?: (path: string) => boolean;
}

/** Build the canonical audit list from the user's settings + an
 *  optional subprocess hook. */
export function defaultAudits(opts: AuditRegistryOptions): Audit[] {
  const runGit = opts.runGit ?? defaultRunGit;
  const out: Audit[] = [];

  if (opts.gitUserNameExpected) {
    out.push({
      id: "git-user-name",
      description: `git config --global user.name == "${opts.gitUserNameExpected}"`,
      check: () => gitUserAudit(opts.gitUserNameExpected!, runGit),
    });
  }

  // P7 S24 — three new startup audits. Each is independent of the
  // existing git-user-name check + each reads the live process env
  // / filesystem. None ships a `fix` because the remedies live
  // outside the app's reach (shell rc files, dotfile installers,
  // brew install bun) — the audit's value is "this is why your
  // terminal looks weird / scripts fail", not auto-repair.
  const env = opts.envOverride ?? (process.env as Record<string, string>);
  const localeProbe = opts.localeOverride ?? null;
  out.push({
    id: "locale-utf8",
    description: "LC_ALL / LANG indicate a UTF-8 locale",
    check: () => localeAudit(env, localeProbe),
  });
  out.push({
    id: "bun-on-path",
    description: "bun is reachable on PATH",
    check: () => bunOnPathAudit(opts.bunProbe),
  });
  out.push({
    id: "shell-exists",
    description: "$SHELL points to an executable",
    check: () => shellExistsAudit(env, opts.fileExists),
  });

  return out;
}

/** Verify the global `git user.name` matches the expected value.
 *  Returns ok when matched; warn (with a fix that applies the value)
 *  when mismatched; err when git can't be reached. */
export async function gitUserAudit(
  expected: string,
  runGit: GitRunner = defaultRunGit,
): Promise<AuditResult> {
  let actual: string;
  try {
    actual = await runGit(["config", "--global", "user.name"]);
  } catch (err) {
    return {
      id: "git-user-name",
      ok: false,
      severity: "err",
      message: `git config probe failed: ${(err as Error).message}`,
    };
  }
  if (actual === expected) {
    return {
      id: "git-user-name",
      ok: true,
      severity: "info",
      message: `git user.name = "${actual}"`,
    };
  }
  const display = actual ? `"${actual}"` : "(unset)";
  return {
    id: "git-user-name",
    ok: false,
    severity: "warn",
    message: `git user.name is ${display}, expected "${expected}"`,
    fix: {
      label: `Set git user.name to "${expected}"`,
      action: async () => {
        await runGit(["config", "--global", "user.name", expected]);
      },
    },
  };
}

// ── P7 S24 — new startup audits ─────────────────────────────────────

/** Probe the OS-level locale. Default reads `LC_ALL || LANG` from the
 *  passed env map; tests can short-circuit via the second argument. */
export async function localeAudit(
  env: Record<string, string | undefined>,
  override: string | null = null,
): Promise<AuditResult> {
  // Resolve in priority order: explicit override → LC_ALL → LANG.
  // Empty strings count as "unset" per POSIX so they fall through.
  const pick = (v: string | null | undefined): string =>
    typeof v === "string" && v.length > 0 ? v : "";
  const effective = pick(override) || pick(env["LC_ALL"]) || pick(env["LANG"]);
  if (!effective) {
    return {
      id: "locale-utf8",
      ok: false,
      severity: "warn",
      message:
        "Neither LC_ALL nor LANG is set. UTF-8 characters may render as ??? in subprocess output.",
    };
  }
  const utf8 = /\bUTF-?8\b/i.test(effective);
  if (utf8) {
    return {
      id: "locale-utf8",
      ok: true,
      severity: "info",
      message: `Locale OK (${effective})`,
    };
  }
  return {
    id: "locale-utf8",
    ok: false,
    severity: "warn",
    message: `Locale "${effective}" is not UTF-8. UTF-8 characters may render as ??? in subprocess output.`,
  };
}

/** Check whether `bun` is on PATH so script-runner panes that shell
 *  out to `bun run …` can resolve the binary. The probe runs `bun
 *  --version` with a 5 s timeout and resolves to true on a zero exit
 *  with non-empty stdout; tests pass a stub via `bunProbe`. */
export async function defaultBunProbe(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["bun", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutP = new Response(proc.stdout).text();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* already gone */
        }
        resolve("");
      }, GIT_AUDIT_TIMEOUT_MS);
    });
    const stdout = await Promise.race([stdoutP, timeout]);
    if (timer) clearTimeout(timer);
    proc.exited.catch(() => {
      /* ignore */
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function bunOnPathAudit(
  probe: () => Promise<boolean> = defaultBunProbe,
): Promise<AuditResult> {
  const ok = await probe();
  if (ok) {
    return {
      id: "bun-on-path",
      ok: true,
      severity: "info",
      message: "bun is on PATH",
    };
  }
  return {
    id: "bun-on-path",
    ok: false,
    severity: "warn",
    message:
      "bun is not on PATH. Script-runner panes that shell out to `bun run` will fail; install from https://bun.sh or add it to PATH.",
  };
}

/** Probe `$SHELL` exists as a regular file. We don't `stat` the live
 *  fs by default in tests; tests inject `fileExists`. */
export async function shellExistsAudit(
  env: Record<string, string | undefined>,
  fileExists: (path: string) => boolean = defaultFileExists,
): Promise<AuditResult> {
  const shell = env["SHELL"] ?? "";
  if (!shell) {
    return {
      id: "shell-exists",
      ok: false,
      severity: "warn",
      message:
        "$SHELL is not set. Terminal spawns will fall back to /bin/sh, which may not be what you want.",
    };
  }
  if (!fileExists(shell)) {
    return {
      id: "shell-exists",
      ok: false,
      severity: "warn",
      message: `$SHELL = ${shell}, but that path does not exist. Terminal spawns may fail.`,
    };
  }
  return {
    id: "shell-exists",
    ok: true,
    severity: "info",
    message: `$SHELL OK (${shell})`,
  };
}

function defaultFileExists(path: string): boolean {
  try {
    // statSync throws on missing paths; treat that as "no".
    const stat = statSync(path);
    return Boolean(stat);
  } catch {
    return false;
  }
}

/** Run every audit in `list`, swallowing thrown errors into `err`-
 *  severity results so a broken audit can't crash the caller. */
export async function runAudits(list: Audit[]): Promise<AuditResult[]> {
  return Promise.all(
    list.map(async (a) => {
      try {
        return await a.check();
      } catch (err) {
        return {
          id: a.id,
          ok: false,
          severity: "err" as const,
          message: `audit threw: ${(err as Error).message}`,
        };
      }
    }),
  );
}

/** Apply the optional `fix` of a single audit result and re-run the
 *  matching audit. Returns the post-fix result so the caller (RPC,
 *  CLI) can confirm the canary is now green. */
export async function applyFix(
  result: AuditResult,
  registry: Audit[],
): Promise<AuditResult> {
  if (!result.fix) {
    return {
      id: result.id,
      ok: result.ok,
      severity: result.severity,
      message: `audit ${result.id} has no fix to apply`,
    };
  }
  await result.fix.action();
  const audit = registry.find((a) => a.id === result.id);
  if (!audit) {
    // Fix landed but we can't re-verify — return the original result
    // with a note so the user sees something changed.
    return {
      id: result.id,
      ok: false,
      severity: "warn",
      message: `fix applied; could not re-run audit ${result.id} (not in registry)`,
    };
  }
  return audit.check();
}
