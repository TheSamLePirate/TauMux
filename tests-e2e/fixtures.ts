import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ESM-friendly __dirname. Playwright's workers run in strict ESM so
// the CommonJS globals aren't available.
const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerFixture {
  /** http://127.0.0.1:<port> (no trailing slash). */
  baseURL: string;
  port: number;
  /** Token the server requires, or "" for open access. */
  token: string;
  /** First surface created at boot. */
  surfaceId: string;
  /** Build a URL path with the token appended as `?t=` when configured. */
  urlWithToken: (path?: string) => string;
}

interface ServerOptions {
  token?: string;
}

const BOOT_SCRIPT = join(__dirname, "server-boot.ts");
const READY_RE = /^READY port=(\d+) token=([^\s]*) surfaceId=([^\s]+)$/;

/**
 * Spawn a Bun child running `server-boot.ts` and wait for its READY
 * line. The child owns the real WebServer + SessionManager; Node-side
 * tests talk to it over HTTP/WS like any ordinary client, which is the
 * production threat model we want to exercise.
 */
async function bootServer(opts: ServerOptions = {}): Promise<{
  fixture: ServerFixture;
  child: ChildProcess;
}> {
  const token = opts.token ?? "";
  const args = ["run", BOOT_SCRIPT];
  if (token) args.push(`--token=${token}`);

  const child = spawn("bun", args, {
    stdio: ["pipe", "pipe", "pipe"],
    // Don't inherit TTY into the subprocess — tests must never block on it.
    detached: false,
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutBuf += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderrBuf += chunk;
  });

  const info = await new Promise<{
    port: number;
    token: string;
    surfaceId: string;
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `server-boot timed out after 15s. stdout="${stdoutBuf.slice(0, 400)}" stderr="${stderrBuf.slice(0, 400)}"`,
        ),
      );
    }, 15_000);

    const onData = () => {
      for (const line of stdoutBuf.split("\n")) {
        const m = READY_RE.exec(line.trim());
        if (m) {
          clearTimeout(timer);
          child.stdout?.off("data", onData);
          resolve({
            port: Number(m[1]),
            token: m[2] ?? "",
            surfaceId: m[3] ?? "",
          });
          return;
        }
      }
    };
    child.stdout?.on("data", onData);

    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `server-boot exited early with code ${code}. stderr="${stderrBuf.slice(0, 400)}"`,
        ),
      );
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const baseURL = `http://127.0.0.1:${info.port}`;
  const fixture: ServerFixture = {
    baseURL,
    port: info.port,
    token: info.token,
    surfaceId: info.surfaceId,
    urlWithToken: (path = "/") => {
      const sep = path.includes("?") ? "&" : "?";
      return info.token
        ? `${baseURL}${path}${sep}t=${encodeURIComponent(info.token)}`
        : `${baseURL}${path}`;
    },
  };
  return { fixture, child };
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      // Escalate if SIGTERM didn't take within 2s.
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  });
}

export const test = base.extend<{
  serverCtx: ServerFixture;
  boot: (opts?: ServerOptions) => Promise<ServerFixture>;
}>({
  serverCtx: async ({}, use) => {
    const { fixture, child } = await bootServer();
    try {
      await use(fixture);
    } finally {
      await stopChild(child);
    }
  },

  boot: async ({}, use) => {
    const children: ChildProcess[] = [];
    const factory = async (opts: ServerOptions = {}) => {
      const { fixture, child } = await bootServer(opts);
      children.push(child);
      return fixture;
    };
    try {
      await use(factory);
    } finally {
      await Promise.all(children.map(stopChild));
    }
  },
});

export { expect };
