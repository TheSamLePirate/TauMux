#!/usr/bin/env bun
/**
 * Tier 2 build-output assertion (doc/native-e2e-plan.md §6.5 / M11).
 *
 * Two checks, both required:
 *
 *   1. **Static gate check.** Every `__test.*` registration site must be
 *      wrapped in the dual-fact runtime gate (HYPERTERM_TEST_MODE=1 +
 *      HT_CONFIG_DIR under tmp). If a future refactor accidentally drops
 *      the gate, this fires.
 *
 *   2. **Runtime gate check.** Boot the app WITHOUT the gate and assert
 *      that `system.capabilities` does not advertise any `__test.*` method.
 *      This is the strongest assurance that production binaries, even
 *      when they contain the strings in their bundle, never expose the
 *      handlers on the socket.
 *
 * A third, nice-to-have check is bundle string elimination — greping the
 * compressed production bundle for the literal `"__test.` token. Current
 * Electrobun builds do not tree-shake the test handler module (that's a
 * future build-config change), so we emit a WARNING rather than failing
 * on that front. Flip `--strict-bundle` once the tree-shake lands.
 *
 * Usage:
 *   bun scripts/audit-test-hooks.ts                  # static + socket check
 *   bun scripts/audit-test-hooks.ts --bundle         # + bundle grep (warn)
 *   bun scripts/audit-test-hooks.ts --strict-bundle  # + bundle grep (fail)
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");

const args = process.argv.slice(2);
const auditBundle =
  args.includes("--bundle") || args.includes("--strict-bundle");
const strictBundle = args.includes("--strict-bundle");

let failures = 0;
let warnings = 0;

function fail(msg: string): void {
  console.error(`[audit][FAIL] ${msg}`);
  failures++;
}
function warn(msg: string): void {
  console.warn(`[audit][WARN] ${msg}`);
  warnings++;
}
function ok(msg: string): void {
  console.log(`[audit][ OK ] ${msg}`);
}

// ── Check 1: static gate ─────────────────────────────────────────────────
{
  const bunTestHandler = readFileSync(
    join(REPO_ROOT, "src/bun/rpc-handlers/__test.ts"),
    "utf8",
  );
  if (!/if \(!options\.enabled\) return \{\}/.test(bunTestHandler)) {
    fail(
      "src/bun/rpc-handlers/__test.ts: early-return gate missing. " +
        "Every registration must short-circuit when options.enabled is false.",
    );
  } else {
    ok("bun-side __test handlers gate on options.enabled");
  }

  const webviewHandlers = readFileSync(
    join(REPO_ROOT, "src/views/terminal/__test-handlers.ts"),
    "utf8",
  );
  if (!/if \(!window\.__htTestMode__\) return false/.test(webviewHandlers)) {
    fail(
      "src/views/terminal/__test-handlers.ts: window.__htTestMode__ " +
        "gate missing in createTestActionRouter.",
    );
  } else {
    ok("webview __test router gates on window.__htTestMode__");
  }

  // Compile-time gate in the webview entry — used by stable builds (via
  // HYPERTERM_INCLUDE_TEST_HOOKS=0) to dead-code-eliminate the router.
  const webviewIndex = readFileSync(
    join(REPO_ROOT, "src/views/terminal/index.ts"),
    "utf8",
  );
  if (!/TEST_HOOKS_COMPILED_IN/.test(webviewIndex)) {
    fail(
      "src/views/terminal/index.ts: TEST_HOOKS_COMPILED_IN compile-time gate missing",
    );
  } else {
    ok("webview entry has TEST_HOOKS_COMPILED_IN compile-time gate");
  }

  const bunIndex = readFileSync(join(REPO_ROOT, "src/bun/index.ts"), "utf8");
  const gateMatch =
    /HT_TEST_MODE =\s*process\.env\["HYPERTERM_TEST_MODE"\] === "1" &&/.test(
      bunIndex,
    );
  const pathCheck = /process\.env\["HT_CONFIG_DIR"\]!\.startsWith/.test(
    bunIndex,
  );
  if (!gateMatch || !pathCheck) {
    fail(
      "src/bun/index.ts: dual-fact gate (HYPERTERM_TEST_MODE=1 AND " +
        "HT_CONFIG_DIR under tmp) not detected — check the HT_TEST_MODE const.",
    );
  } else {
    ok("bun main applies dual-fact gate");
  }

  if (!/if \(HT_TEST_MODE\) \{\s*rpc\.send\("enableTestMode"/.test(bunIndex)) {
    fail("src/bun/index.ts: enableTestMode is not conditioned on HT_TEST_MODE");
  } else {
    ok("enableTestMode only sent when HT_TEST_MODE passes");
  }
}

// ── Check 2: runtime — boot app WITHOUT gate, assert no __test.* in caps ─
await runtimeGateCheck();

async function runtimeGateCheck(): Promise<void> {
  const configDir = mkdtempSync(join(tmpdir(), "ht-audit-"));
  mkdirSync(join(configDir, "home"), { recursive: true });
  try {
    const env = { ...process.env };
    delete env["HT_SOCKET_PATH"];
    // DELIBERATELY OMIT HYPERTERM_TEST_MODE — this is the whole point of
    // the check. HT_CONFIG_DIR is still set so the app boots with an
    // isolated socket, but the dual-fact gate fails (only one fact).
    env["HT_CONFIG_DIR"] = configDir;
    env["HOME"] = join(configDir, "home");
    env["HT_E2E"] = "1";
    env["HYPERTERM_WEB_PORT"] = String(
      52000 + Math.floor(Math.random() * 1000),
    );
    env["LOG_RPC"] = "0";

    const child = spawn("bun", ["x", "electrobun", "dev"], {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.stdout?.on("data", () => {
      /* ignore */
    });

    const socketPath = join(configDir, "hyperterm.sock");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (existsSync(socketPath)) break;
      await sleep(150);
    }
    if (!existsSync(socketPath)) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      fail(
        `runtime check: app never bound socket. stderr=${stderr.slice(-200)}`,
      );
      return;
    }
    await sleep(300);
    const sock = netConnect({ path: socketPath });
    await new Promise<void>((r, rej) => {
      sock.once("connect", () => r());
      sock.once("error", rej);
    });
    sock.setEncoding("utf8");
    let buf = "";
    let next = 1;
    const pending = new Map<number, (v: unknown) => void>();
    sock.on("data", (chunk) => {
      buf += chunk;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
      }
    });
    const call = <T>(method: string): Promise<T> => {
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, (v) => {
          const m = v as { result?: T; error?: string };
          if (m.error) reject(new Error(m.error));
          else resolve(m.result as T);
        });
        sock.write(JSON.stringify({ id, method, params: {} }) + "\n");
        setTimeout(
          () =>
            pending.has(id) &&
            (pending.delete(id), reject(new Error("rpc timeout"))),
          5_000,
        );
      });
    };

    const caps = await call<{ methods: string[] }>("system.capabilities");
    const leaks = caps.methods.filter((m) => m.startsWith("__test."));
    if (leaks.length > 0) {
      fail(
        `runtime check: ${leaks.length} __test.* methods exposed without the gate: ${leaks.join(", ")}`,
      );
    } else {
      ok("runtime check: zero __test.* methods exposed without the gate");
    }
    try {
      sock.end();
      child.kill("SIGTERM");
      await sleep(300);
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  } finally {
    try {
      rmSync(configDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// ── Check 3 (optional): bundle grep ──────────────────────────────────────
if (auditBundle) {
  const stableDir = join(REPO_ROOT, "build/stable-macos-arm64");
  if (!existsSync(stableDir)) {
    warn(
      `stable build not found at ${stableDir} — run \`bun run build:stable\` first`,
    );
  } else {
    // Walk the .app's Resources dir for .js bundles. On stable, the JS is
    // often packed into a .tar.zst — extract to a temp dir and scan.
    const tmp = mkdtempSync(join(tmpdir(), "ht-bundle-audit-"));
    try {
      // Find any tar.zst under the stable bundle
      const tarGlob = spawn("sh", [
        "-c",
        `find "${stableDir}" -name '*.tar.zst' | head -1`,
      ]);
      const tarPath = await readAll(tarGlob.stdout!);
      const resolvedTar = tarPath.trim();
      if (resolvedTar) {
        await run("sh", [
          "-c",
          `zstd -d < "${resolvedTar}" | tar -x -C "${tmp}"`,
        ]);
      }
      // Also copy any loose .js that's already on disk
      await run("sh", [
        "-c",
        `find "${stableDir}" -name '*.js' -exec cp {} "${tmp}"/ \\;`,
      ]);

      const hits = await grepDir(tmp, '"__test\\.');
      if (hits === 0) {
        ok("stable bundle contains no '\"__test.' strings");
      } else if (strictBundle) {
        fail(
          `stable bundle contains ${hits} occurrence(s) of '\"__test.' — ` +
            "tree-shake gate has regressed",
        );
      } else {
        warn(
          `stable bundle contains ${hits} occurrence(s) of '\"__test.' — ` +
            "runtime gate is still in place, but bundle tree-shaking has not " +
            "been implemented yet (see doc/native-e2e-plan.md §11 Risks).",
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

console.log(`\n[audit] done — ${failures} failure(s), ${warnings} warning(s).`);
process.exit(failures > 0 ? 1 : 0);

// ── helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    stream.on("data", (c) => (buf += String(c)));
    stream.on("end", () => resolve(buf));
  });
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: "ignore" });
    c.once("exit", () => resolve());
    c.once("error", () => resolve());
  });
}

async function grepDir(dir: string, pattern: string): Promise<number> {
  const child = spawn(
    "sh",
    [
      "-c",
      `grep -r -c --include='*.js' --include='*.ts' "${pattern}" "${dir}" || true`,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const out = await readAll(child.stdout!);
  let total = 0;
  for (const line of out.split("\n")) {
    const m = /:(\d+)$/.exec(line);
    if (m) total += parseInt(m[1], 10);
  }
  return total;
}
