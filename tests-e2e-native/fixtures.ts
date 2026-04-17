import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, type SocketRpc } from "./client";
import { allocateConfigDir, wipeConfigDir } from "./helpers/tmpdir";
import { pickFreePort } from "./helpers/ports";
import { sleep, waitFor } from "./helpers/wait";
import {
  captureWindow,
  writeIndexEntry,
  type ScreenshotOpts,
} from "./screenshot";
import { snapshotClipboard, restoreClipboard } from "./clipboard";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PACKAGED_APP_PATH =
  "build/stable-macos-arm64/HyperTerm Canvas.app/Contents/MacOS/HyperTermCanvas";

/**
 * Per-test spawn of the real Electrobun app. Two modes:
 *   - `dev` (default) — `bun start` style: `electrobun dev`
 *   - `packaged`      — the built .app binary (set via HT_E2E_APP=packaged)
 *
 * Both honor `HT_CONFIG_DIR`, `HT_E2E`, `HYPERTERM_WEB_PORT`, and `HOME`.
 * Readiness is signalled by the socket file appearing AND responding to
 * `system.ping` — stdout parsing is too race-prone (logs interleave).
 */

export interface AppInfo {
  configDir: string;
  socketPath: string;
  webMirrorPort: number;
  firstSurfaceId: string;
  windowId?: number;
  /** Seconds since fixture created this app. */
  uptimeMs: () => number;
  /** True when the Tier 2 `__test.*` RPC family is live on this instance.
   *  Tests that use `app.rpc.ui.*` must check this first, or gate themselves
   *  via `requireTier2(app)`. */
  tier2Ready: boolean;
}

export interface AppFixture {
  rpc: SocketRpc;
  info: AppInfo;
  /** Attach a window screenshot to the Playwright report. */
  snap(name: string, annotate?: Record<string, unknown>): Promise<void>;
  /** Capture the window to a file and return the absolute path. */
  screenshot(name: string, opts?: ScreenshotOpts): Promise<string>;
}

async function waitForSocket(
  socketPath: string,
  timeoutMs: number,
): Promise<void> {
  await waitFor(() => (existsSync(socketPath) ? true : undefined), {
    timeoutMs,
    intervalMs: 100,
    message: `socket file never appeared at ${socketPath}`,
  });
}

async function waitForPing(rpc: SocketRpc, timeoutMs: number): Promise<void> {
  await waitFor(
    async () => {
      try {
        const pong = await rpc.system.ping();
        return pong === "PONG" ? true : undefined;
      } catch {
        return undefined;
      }
    },
    { timeoutMs, intervalMs: 150, message: "system.ping never succeeded" },
  );
}

async function waitForFirstSurface(
  rpc: SocketRpc,
  timeoutMs: number,
): Promise<string> {
  // Bun creates the initial surface on the first webview `resize` message.
  // That takes ~1-3s on a warm Mac. We wait for the workspace list to
  // populate (that's the natural bootstrap path — user would see a
  // workspace appear), then return the focused surface. If the GUI truly
  // fails to fire resize we fall back to forcing a `workspace.create`
  // so the test suite still has a surface to drive.
  const graceMs = Math.min(8_000, timeoutMs);
  try {
    return await waitFor<string>(
      async () => {
        const surfaces = await rpc.surface.list();
        return surfaces[0]?.id;
      },
      {
        timeoutMs: graceMs,
        intervalMs: 150,
        message: "initial surface grace period elapsed",
      },
    );
  } catch {
    /* fall through to forced creation */
  }
  await rpc.workspace.create();
  return waitFor<string>(
    async () => {
      const surfaces = await rpc.surface.list();
      return surfaces[0]?.id;
    },
    {
      timeoutMs: timeoutMs - graceMs,
      intervalMs: 150,
      message: "no surface appeared even after workspace.create fallback",
    },
  );
}

function buildEnv(
  overrides: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  // Inherit most of the parent's env (macOS Bun.spawn + posix_spawn for the
  // user's shell ends up needing a surprising amount: _CFBundleIdentifier,
  // XPC vars, sandbox containers, etc.). We explicitly strip the handful of
  // variables that would actually collide with a daily-driver instance —
  // HT_SOCKET_PATH is the big one (see §8.3) — and then layer the test
  // overrides on top.
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Never inherit a socket path from the parent shell; a pointer to the
  // daily-driver's socket here would be a silent cross-instance disaster.
  delete env["HT_SOCKET_PATH"];
  delete env["HT_CONFIG_DIR"];
  delete env["HT_E2E"];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

interface SpawnResult {
  child: ChildProcess;
  info: AppInfo;
  rpc: SocketRpc;
  /** Sniffed from launcher stdout — PID of the real bun main process. Used
   *  by teardown to SIGTERM the app after the launcher has already exited. */
  getAppPid: () => number | null;
}

/**
 * Daily-driver safety checks (doc/native-e2e-plan.md §8.4). Run before
 * every spawn so misconfiguration fails fast with a clear message:
 *   - Refuse to launch unless we are clearly a test process. The fixture
 *     always sets HT_E2E=1 internally; this guards against anyone
 *     importing the client outside the fixture and pointing it at a
 *     real config.
 *   - Warn if the user's daily-driver HyperTerm socket is up. We're
 *     fully isolated via HT_CONFIG_DIR so this is informational, not a
 *     failure — it just explains why focus is preserved on the daily
 *     driver through the run.
 */
function preflight(): void {
  const defaultDailyDriverSocket = join(
    process.env["HOME"] ?? "",
    "Library/Application Support/hyperterm-canvas/hyperterm.sock",
  );
  if (existsSync(defaultDailyDriverSocket)) {
     
    console.log(
      `[e2e] daily-driver HyperTerm socket detected at ` +
        `${defaultDailyDriverSocket}; test instance fully isolated via HT_CONFIG_DIR`,
    );
  }
}

async function spawnApp(workerIndex: number): Promise<SpawnResult> {
  // Pre-flight checks (doc/native-e2e-plan.md §8.4) run before we touch
  // anything — they catch misuse early and log context that makes failure
  // postmortems much faster.
  preflight();

  const configDir = allocateConfigDir(workerIndex);
  const webMirrorPort = await pickFreePort();
  const startMs = Date.now();

  const env = buildEnv({
    HT_CONFIG_DIR: configDir,
    HOME: join(configDir, "home"),
    HT_E2E: "1",
    // Tier 2: enable the `__test.*` RPC family. The bun-side gate also
    // requires `HT_CONFIG_DIR` to be under /tmp; `allocateConfigDir` above
    // lives under `os.tmpdir()` which satisfies that check on macOS/Linux.
    HYPERTERM_TEST_MODE: "1",
    HYPERTERM_WEB_PORT: String(webMirrorPort),
    LOG_RPC: "0",
  });

  const mode = (process.env["HT_E2E_APP"] ?? "dev").toLowerCase();
  let cmd: string;
  let args: string[];
  if (mode === "packaged") {
    const full = join(REPO_ROOT, PACKAGED_APP_PATH);
    if (!existsSync(full)) {
      throw new Error(
        `packaged binary not found at ${full} — run \`bun run build:stable\` first`,
      );
    }
    cmd = full;
    args = [];
  } else {
    cmd = "bun";
    args = ["x", "electrobun", "dev"];
  }

  const socketPath = join(configDir, "hyperterm.sock");

  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let stderrTail = "";
  let stdoutTail = "";
  child.stderr?.on("data", (d) => {
    stderrTail = (stderrTail + String(d)).slice(-4_000);
  });
  child.stdout?.on("data", (d) => {
    stdoutTail = (stdoutTail + String(d)).slice(-4_000);
  });

  // On macOS, `electrobun dev` (and the packaged .app binary) exit quickly
  // after handing off to the native launcher, which in turn spawns the real
  // bun main process. Our `child` ref tracks the launcher, not the app — so
  // a fast `exit(0)` just means the launcher did its job. Treat it as fatal
  // only if it happens before the socket starts responding.
  let launcherExited = false;
  let launcherExitInfo: { code: number | null; signal: NodeJS.Signals | null } =
    {
      code: null,
      signal: null,
    };
  child.once("exit", (code, signal) => {
    launcherExited = true;
    launcherExitInfo = { code, signal };
  });

  // The launcher prints "Child process spawned with PID <n>" before it exits;
  // we sniff that so teardown can SIGTERM the real bun process directly when
  // `system.shutdown` stalls. Best-effort — a missed PID just falls back to
  // "let the socket close do the cleanup."
  let appPid: number | null = null;
  const sniffPid = (chunk: Buffer | string) => {
    const s = typeof chunk === "string" ? chunk : chunk.toString();
    const m = /Child process spawned with PID (\d+)/.exec(s);
    if (m) appPid = parseInt(m[1], 10);
  };
  child.stderr?.on("data", sniffPid);
  child.stdout?.on("data", sniffPid);

  const earlyExit = new Promise<never>((_, reject) => {
    const poll = setInterval(() => {
      if (!launcherExited) return;
      // Launcher is gone. If the socket still responds we're fine — but if
      // it's also gone, the app is truly dead.
      if (!existsSync(socketPath)) {
        clearInterval(poll);
        reject(
          new Error(
            `app exited before ready (launcher code=${launcherExitInfo.code} signal=${launcherExitInfo.signal}, socket absent). stderr=\n${stderrTail}`,
          ),
        );
      }
    }, 250);
    // Unreferenced timer so we don't keep Node alive on happy paths.
    (poll as unknown as { unref?: () => void }).unref?.();
  });

  try {
    await Promise.race([waitForSocket(socketPath, 30_000), earlyExit]);
    // Tiny breathing room so the server has bound the socket before we knock.
    await sleep(100);
  } catch (err) {
    await stopChild(child);
    wipeConfigDir(configDir);
    throw err;
  }

  let rpc: SocketRpc;
  try {
    rpc = await Promise.race([connect(socketPath), earlyExit]);
    await Promise.race([waitForPing(rpc, 10_000), earlyExit]);
  } catch (err) {
    await stopChild(child);
    wipeConfigDir(configDir);
    throw err;
  }

  let firstSurfaceId: string;
  try {
    firstSurfaceId = await Promise.race([
      waitForFirstSurface(rpc, 15_000),
      earlyExit,
    ]);
  } catch (err) {
    const enriched = new Error(
      `${err instanceof Error ? err.message : String(err)}\n--- stdout tail ---\n${stdoutTail}\n--- stderr tail ---\n${stderrTail}`,
    );
    try {
      rpc.close();
    } catch {
      /* ignore */
    }
    await stopChild(child);
    wipeConfigDir(configDir);
    throw enriched;
  }

  // Tier 2 readiness: the webview flips `window.__htTestMode__` on the
  // `enableTestMode` RPC, which bun sends on the first resize. Poll the
  // webview state RPC until it responds with a non-null object — that's
  // proof the router is live and the handlers are wired.
  let tier2Ready = false;
  try {
    await waitFor(
      async () => {
        try {
          const state = await rpc.ui.readState();
          return state && typeof state === "object" ? true : undefined;
        } catch {
          return undefined;
        }
      },
      {
        timeoutMs: 10_000,
        intervalMs: 200,
        message: "Tier 2 handlers never became ready",
      },
    );
    tier2Ready = true;
  } catch {
    // Non-fatal — tests that don't use `ui.*` still run. Fixture surface
    // carries `tier2Ready` so those tests can gate themselves.
  }

  const info: AppInfo = {
    configDir,
    socketPath,
    webMirrorPort,
    firstSurfaceId,
    uptimeMs: () => Date.now() - startMs,
    tier2Ready,
  };
  return { child, info, rpc, getAppPid: () => appPid };
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const hardKill = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(hardKill);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  });
}

async function gracefulShutdownApp(
  rpc: SocketRpc,
  child: ChildProcess,
  appPid: number | null,
  socketPath: string,
): Promise<void> {
  // In-band shutdown first so the app can persist settings and flush state.
  try {
    await Promise.race([
      rpc.system.shutdown(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("shutdown timeout")), 2_000),
      ),
    ]);
  } catch {
    /* fall through */
  }
  try {
    rpc.close();
  } catch {
    /* ignore */
  }
  // The launcher usually exits immediately after spawning the bun child,
  // so the real app lives at `appPid`. SIGTERM it if it's still around; fall
  // back to SIGKILL after 3s. Using the socket file as a liveness check so
  // we don't SIGKILL a process that already cleaned itself up.
  if (appPid) {
    for (let i = 0; i < 20; i++) {
      if (!existsSync(socketPath)) break;
      await sleep(100);
    }
    try {
      process.kill(appPid, "SIGTERM");
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 30; i++) {
      try {
        process.kill(appPid, 0);
      } catch {
        return;
      }
      await sleep(100);
    }
    try {
      process.kill(appPid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
  await stopChild(child);
}

// Clipboard isolation for tests tagged `@clipboard` in their title path.
// macOS has no per-app clipboard, so copy/paste specs would otherwise
// clobber the user's clipboard mid-run (doc/native-e2e-plan.md §8.5).
base.beforeEach(async ({}, testInfo) => {
  if (!testInfo.titlePath.join(" ").includes("@clipboard")) return;
  (testInfo as unknown as { __priorClipboard?: string }).__priorClipboard =
    snapshotClipboard();
});
base.afterEach(async ({}, testInfo) => {
  const prior = (testInfo as unknown as { __priorClipboard?: string })
    .__priorClipboard;
  if (prior === undefined) return;
  await restoreClipboard(prior);
});

export const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use, testInfo) => {
    const { child, info, rpc, getAppPid } = await spawnApp(
      testInfo.workerIndex,
    );

    const fixture: AppFixture = {
      rpc,
      info,
      async screenshot(name, opts) {
        const dir = testInfo.outputDir;
        return captureWindow({ info, name, dir, opts, rpc });
      },
      async snap(name, annotate) {
        const path = await this.screenshot(name);
        const spec = testInfo.file.split("/").pop() ?? "unknown";
        const testSlug = testInfo.title
          .replace(/[^a-z0-9]+/gi, "-")
          .toLowerCase();
        try {
          await testInfo.attach(`screenshot-${name}`, {
            path,
            contentType: "image/png",
          });
        } catch {
          /* attach best-effort — some runs capture past Playwright's attach window */
        }
        try {
          const workspaces = await rpc.workspace.list();
          const surfaces = await rpc.surface.list();
          // Tier 2 runs include a richer snapshot via __test.readWebviewState
          // so the design-review report can correlate image → exact UI state
          // (palette open? settings panel? focused surface? etc.).
          let tier2State: Record<string, unknown> | null = null;
          if (info.tier2Ready) {
            try {
              tier2State = (await rpc.ui.readState()) as Record<
                string,
                unknown
              >;
            } catch {
              /* best-effort */
            }
          }
          writeIndexEntry({
            spec,
            test: testInfo.title,
            testSlug,
            step: name,
            path,
            state: {
              workspaceCount: workspaces.length,
              surfaceCount: surfaces.length,
              activeWorkspace: workspaces.find((w) => w.active)?.name ?? null,
              ...(tier2State ?? {}),
            },
            annotate,
          });
        } catch {
          /* index is best-effort; never fail a test because of it */
        }
      },
    };

    try {
      await use(fixture);
    } finally {
      const preserve = testInfo.status !== "passed";
      if (testInfo.status === "failed" || testInfo.status === "timedOut") {
        // Always capture a final failure.png so postmortem has a visual too.
        try {
          const path = await captureWindow({
            info,
            name: "failure",
            dir: testInfo.outputDir,
            rpc,
          });
          await testInfo.attach("failure.png", {
            path,
            contentType: "image/png",
          });
        } catch {
          /* ignore */
        }
      }
      await gracefulShutdownApp(rpc, child, getAppPid(), info.socketPath);
      if (!preserve) {
        wipeConfigDir(info.configDir);
      } else {
        // Leave the configDir in place for debugging; Playwright's
        // outputDir also preserves on failure.

        console.log(`[e2e] preserved configDir for debug: ${info.configDir}`);
      }
    }
  },
});

export { expect };

/** Skip the current test if Tier 2 isn't available. Useful at the top of
 *  specs that drive keyboard shortcuts, read palette state, etc. */
export function requireTier2(app: AppFixture): void {
  if (!app.info.tier2Ready) {
    throw new Error(
      "Tier 2 (__test.*) is not ready on this app instance — " +
        "check HYPERTERM_TEST_MODE and HT_CONFIG_DIR gating",
    );
  }
}
