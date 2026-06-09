/**
 * Extension Manager — the host side of the "extension app" platform.
 *
 * Mirrors `PiAgentManager`: each *running* extension surface maps to an
 * `ExtensionBackendInstance` that owns a Bun child process (the extension's
 * backend, `bun run <entry>`) and, in dev mode, a Vite dev-server child. The
 * backend talks to τ-mux's control surfaces over the unix socket via
 * `@tau-mux/sdk` (env-injected `HT_SOCKET_PATH` / `HT_RPC_TOKEN`); the
 * frontend (an iframe) talks to the host via a postMessage bridge that the
 * host relays into the backend's stdin / out of its stdout (JSONL).
 *
 * The manager also owns a tiny always-on static server that serves built
 * frontend bundles at `http://127.0.0.1:<port>/ext/<id>/…` so the iframe has
 * a real loopback origin in "installed" mode (no dependency on the optional
 * web mirror). Dev mode points the iframe at the extension's own Vite server.
 *
 * Never spawns with `terminal: true` — extensions are plain child processes,
 * not PTYs (CLAUDE.md). On failure every method degrades gracefully and never
 * throws from a callback. See doc/design_extension_platform.md.
 */

import { join } from "node:path";
import { connect } from "node:net";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { writeFileAtomic } from "./atomic-write";
import { rpcTokenPathForSocket } from "../shared/rpc-token";
import {
  isValidExtensionId,
  type ExtensionDescriptor,
  type ExtensionHostPayload,
  type ExtensionManifest,
  type ExtensionRegistry,
  type ExtensionRegistryEntry,
  type ExtensionSurfaceHandle,
} from "../shared/extension-types";

// ── Bun binary resolution (mirrors pi-agent-manager's resolvePiBinary) ─────
// A packaged .app inherits a minimal PATH; resolve `bun` from the user's
// login shell so nvm / brew / volta installs are found.
let _resolvedBun: string | null = null;
function resolveBunBinary(): string {
  if (_resolvedBun) return _resolvedBun;
  const direct = Bun.spawnSync(["which", "bun"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  if (direct.exitCode === 0) {
    const p = new TextDecoder().decode(direct.stdout).trim();
    if (p) return (_resolvedBun = p);
  }
  const shell = process.env["SHELL"] || "/bin/zsh";
  const login = Bun.spawnSync([shell, "-ilc", "which bun"], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: process.env["HOME"] ?? "",
      LC_ALL: "C",
      LANG: "C",
    },
  });
  if (login.exitCode === 0) {
    const p = new TextDecoder().decode(login.stdout).trim();
    if (p) return (_resolvedBun = p);
  }
  const home = process.env["HOME"] ?? "";
  for (const c of [
    `${home}/.bun/bin/bun`,
    "/usr/local/bin/bun",
    "/opt/homebrew/bin/bun",
  ]) {
    try {
      if (existsSync(c)) return (_resolvedBun = c);
    } catch {
      /* skip */
    }
  }
  return "bun"; // hope it's on PATH at runtime
}

/** Resolve the user's login-shell PATH so spawned children find their tools. */
let _loginPath: string | null = null;
function loginShellPath(): string {
  if (_loginPath) return _loginPath;
  let shellPath = process.env["PATH"] ?? "";
  try {
    const shell = process.env["SHELL"] || "/bin/zsh";
    const r = Bun.spawnSync([shell, "-ilc", "echo $PATH"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
    if (r.exitCode === 0) {
      const p = new TextDecoder().decode(r.stdout).trim();
      if (p) shellPath = p;
    }
  } catch {
    /* keep existing PATH */
  }
  return (_loginPath = shellPath);
}

/** Resolve once a TCP port is accepting connections on `host`, or `false` on
 *  timeout. Used to hold the iframe back until a freshly-spawned Vite dev
 *  server is actually listening (otherwise the first load races the spawn and
 *  shows a blank pane). Polls every 200 ms. */
function waitForPort(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 20000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = connect({ port, host });
      const cleanup = () => {
        sock.removeAllListeners();
        sock.destroy();
      };
      sock.once("connect", () => {
        cleanup();
        resolve(true);
      });
      sock.once("error", () => {
        cleanup();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

export interface ExtensionManagerDeps {
  configDir: string;
  /** Absolute unix-socket path the SocketServer is bound to. */
  socketPath: string;
  /** Absolute path to the bundled scaffold templates dir (each subdir is a
   *  template the manage overlay / `ht extension new` can clone). */
  templatesDir?: string;
  /** Absolute path to the in-repo `@tau-mux/sdk` package. Extensions declare
   *  it as a relative `file:` dependency that breaks once they are copied out
   *  of the repo into the config dir, so before `bun install` we rewrite that
   *  dependency to this absolute path. */
  sdkDir?: string;
  /** Push a host→frontend payload to the webview (relayed into the iframe). */
  onHostPayload?: (surfaceId: string, payload: ExtensionHostPayload) => void;
  /** Log sink (stderr lines + manager diagnostics). */
  onLog?: (line: string) => void;
}

interface ExtensionBackendInstance {
  surfaceId: string;
  extensionId: string;
  mode: "dev" | "installed";
  backendProc: ReturnType<typeof Bun.spawn> | null;
  devProc: ReturnType<typeof Bun.spawn> | null;
  buffer: string;
  dead: boolean;
}

export class ExtensionManager {
  private readonly extensionsDir: string;
  private readonly registryPath: string;
  private descriptors = new Map<string, ExtensionDescriptor>();
  private instances = new Map<string, ExtensionBackendInstance>();
  private staticServer: ReturnType<typeof Bun.serve> | null = null;
  private staticPort = 0;

  constructor(private deps: ExtensionManagerDeps) {
    this.extensionsDir = join(deps.configDir, "extensions");
    this.registryPath = join(deps.configDir, "extensions-registry.json");
    try {
      mkdirSync(this.extensionsDir, { recursive: true });
    } catch {
      /* best-effort */
    }
    this.reload();
  }

  // ── Registry / discovery ────────────────────────────────────────────────

  private log(line: string): void {
    this.deps.onLog?.(`[ext] ${line}`);
  }

  private loadRegistry(): ExtensionRegistry {
    try {
      const raw = readFileSync(this.registryPath, "utf-8");
      const parsed = JSON.parse(raw) as ExtensionRegistry;
      if (parsed && Array.isArray(parsed.extensions)) return parsed;
    } catch {
      /* missing / corrupt → empty */
    }
    return { version: 1, extensions: [] };
  }

  private saveRegistry(reg: ExtensionRegistry): void {
    try {
      writeFileAtomic(this.registryPath, JSON.stringify(reg, null, 2));
    } catch (err) {
      this.log(`registry write failed: ${String(err)}`);
    }
  }

  private readManifest(dir: string): ExtensionManifest | null {
    try {
      const raw = readFileSync(join(dir, "manifest.json"), "utf-8");
      const m = JSON.parse(raw) as ExtensionManifest;
      if (m && typeof m.id === "string" && isValidExtensionId(m.id)) return m;
    } catch {
      /* not an extension dir */
    }
    return null;
  }

  /** Re-scan the extensions dir + registry and rebuild the descriptor map. */
  reload(): void {
    const reg = this.loadRegistry();
    const enabledById = new Map(reg.extensions.map((e) => [e.id, e.enabled]));
    const next = new Map<string, ExtensionDescriptor>();
    let entries: string[] = [];
    try {
      entries = readdirSync(this.extensionsDir);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      const dir = join(this.extensionsDir, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifest = this.readManifest(dir);
      if (!manifest) continue;
      const distDir = manifest.frontend?.dist ?? "dist";
      const hasBuild = existsSync(
        join(dir, distDir, manifest.frontend?.entry ?? "index.html"),
      );
      next.set(manifest.id, {
        manifest,
        path: dir,
        enabled: enabledById.get(manifest.id) ?? true,
        hasBuild,
      });
    }
    this.descriptors = next;
    // Reconcile registry with what's actually on disk.
    const reconciled: ExtensionRegistryEntry[] = [];
    for (const desc of next.values()) {
      const existing = reg.extensions.find((e) => e.id === desc.manifest.id);
      reconciled.push({
        id: desc.manifest.id,
        path: desc.path,
        enabled: desc.enabled,
        installedAt: existing?.installedAt ?? 0,
      });
    }
    this.saveRegistry({ version: 1, extensions: reconciled });
  }

  list(): ExtensionDescriptor[] {
    return [...this.descriptors.values()].sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name),
    );
  }

  has(id: string): boolean {
    return this.descriptors.has(id);
  }

  get(id: string): ExtensionDescriptor | undefined {
    return this.descriptors.get(id);
  }

  // ── Static bundle host ──────────────────────────────────────────────────

  private ensureStaticServer(): number {
    if (this.staticServer) return this.staticPort;
    const extensionsDir = this.extensionsDir;
    const getDescriptor = (id: string) => this.descriptors.get(id);
    this.staticServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0, // ephemeral
      async fetch(req) {
        const url = new URL(req.url);
        // /ext/<id>/<path...>
        const m = url.pathname.match(/^\/ext\/([^/]+)\/(.*)$/);
        if (!m) return new Response("not found", { status: 404 });
        const id = decodeURIComponent(m[1]);
        if (!isValidExtensionId(id))
          return new Response("bad id", { status: 400 });
        const desc = getDescriptor(id);
        if (!desc) return new Response("unknown extension", { status: 404 });
        const distDir = desc.manifest.frontend?.dist ?? "dist";
        const rel = m[2] || desc.manifest.frontend?.entry || "index.html";
        // Block path traversal.
        if (rel.includes(".."))
          return new Response("bad path", { status: 400 });
        const base = join(extensionsDir, id, distDir);
        let filePath = join(base, rel);
        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
          // SPA fallback to index.html
          filePath = join(base, desc.manifest.frontend?.entry ?? "index.html");
        }
        try {
          const file = Bun.file(filePath);
          if (await file.exists()) {
            return new Response(file, {
              headers: { "Cache-Control": "no-store" },
            });
          }
        } catch {
          /* fall through */
        }
        return new Response("not found", { status: 404 });
      },
    });
    this.staticPort = this.staticServer.port ?? 0;
    this.log(`static bundle host on 127.0.0.1:${this.staticPort}`);
    return this.staticPort;
  }

  // ── Backend lifecycle ───────────────────────────────────────────────────

  /** Ensure a backend (and dev server, in dev mode) is running for this
   *  surface, returning the handle the webview needs to mount the iframe. */
  async ensureBackend(
    extensionId: string,
    surfaceId: string,
    opts: { dev?: boolean } = {},
  ): Promise<ExtensionSurfaceHandle> {
    const desc = this.descriptors.get(extensionId);
    if (!desc) throw new Error(`unknown extension: ${extensionId}`);

    // Already running for this surface? Return its existing handle.
    const existing = this.instances.get(surfaceId);
    if (existing && !existing.dead) {
      return this.handleFor(desc, existing.mode);
    }

    // Decide mode: explicit dev override, else dev if no build but a dev cmd.
    const mode: "dev" | "installed" =
      opts.dev || (!desc.hasBuild && !!desc.manifest.frontend?.dev)
        ? "dev"
        : "installed";

    const inst: ExtensionBackendInstance = {
      surfaceId,
      extensionId,
      mode,
      backendProc: null,
      devProc: null,
      buffer: "",
      dead: false,
    };
    this.instances.set(surfaceId, inst);
    this.emit(surfaceId, { kind: "lifecycle", state: "starting" });

    // Install deps once (best-effort) before spawning anything.
    await this.ensureDeps(desc.path);

    // Spawn the backend process if the manifest declares one.
    const backendEntry = desc.manifest.backend?.entry;
    if (backendEntry) {
      this.spawnBackend(inst, desc, backendEntry);
    }

    // Dev mode → spawn the Vite dev server and wait for it to listen before
    // the iframe loads its URL (otherwise the first load races the spawn and
    // the pane shows blank). Built mode → start the static bundle host.
    if (mode === "dev" && desc.manifest.frontend?.dev) {
      this.spawnDevServer(inst, desc);
      const port = desc.manifest.frontend?.devPort ?? 5173;
      const ready = await waitForPort(port);
      if (!ready)
        this.log(
          `dev server for ${desc.manifest.id} not listening on :${port} yet — the pane may need a reload`,
        );
    } else if (mode === "installed") {
      this.ensureStaticServer();
    }

    this.emit(surfaceId, { kind: "lifecycle", state: "ready" });
    return this.handleFor(desc, mode);
  }

  private handleFor(
    desc: ExtensionDescriptor,
    mode: "dev" | "installed",
  ): ExtensionSurfaceHandle {
    const handle: ExtensionSurfaceHandle = {
      extensionId: desc.manifest.id,
      title: desc.manifest.name,
      icon: desc.manifest.icon,
    };
    if (mode === "dev") {
      const port = desc.manifest.frontend?.devPort ?? 5173;
      handle.devUrl = `http://127.0.0.1:${port}`;
    } else {
      const port = this.ensureStaticServer();
      handle.bundleUrl = `http://127.0.0.1:${port}/ext/${encodeURIComponent(desc.manifest.id)}/`;
    }
    return handle;
  }

  /** Point the extension's `@tau-mux/sdk` dependency at the absolute SDK path.
   *  Extensions ship a relative `file:../../../packages/tau-mux-sdk` that only
   *  resolves inside the repo; once copied into the config dir it breaks and
   *  `bun install` fails. Rewrite it in place before installing. */
  private repairSdkDependency(dir: string): void {
    const sdkDir = this.deps.sdkDir;
    if (!sdkDir || !existsSync(sdkDir)) return;
    const pkgPath = join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      let changed = false;
      for (const field of ["dependencies", "devDependencies"] as const) {
        const deps = pkg[field];
        const cur = deps?.["@tau-mux/sdk"];
        if (
          deps &&
          typeof cur === "string" &&
          /^(file:|link:|workspace:)/.test(cur) &&
          cur !== `file:${sdkDir}`
        ) {
          deps["@tau-mux/sdk"] = `file:${sdkDir}`;
          changed = true;
        }
      }
      if (changed) {
        writeFileAtomic(pkgPath, JSON.stringify(pkg, null, 2));
        this.log(`rewired @tau-mux/sdk → file:${sdkDir} for install`);
      }
    } catch (err) {
      this.log(`sdk dependency repair failed: ${String(err)}`);
    }
  }

  private async ensureDeps(dir: string): Promise<void> {
    try {
      if (!existsSync(join(dir, "package.json"))) return;
      // Skip only when node_modules looks COMPLETE. A prior failed install can
      // leave a partial tree; re-run if the declared @tau-mux/sdk link is
      // missing (bun install is idempotent, so a no-op when already complete).
      if (existsSync(join(dir, "node_modules"))) {
        const declaresSdk = (() => {
          try {
            const pkg = JSON.parse(
              readFileSync(join(dir, "package.json"), "utf-8"),
            ) as {
              dependencies?: Record<string, string>;
              devDependencies?: Record<string, string>;
            };
            return !!(
              pkg.dependencies?.["@tau-mux/sdk"] ??
              pkg.devDependencies?.["@tau-mux/sdk"]
            );
          } catch {
            return false;
          }
        })();
        const sdkLinked = existsSync(
          join(dir, "node_modules", "@tau-mux", "sdk"),
        );
        if (!declaresSdk || sdkLinked) return;
      }
      this.repairSdkDependency(dir);
      this.log(`bun install in ${dir}…`);
      const proc = Bun.spawn([resolveBunBinary(), "install"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PATH: loginShellPath() },
      });
      const code = await proc.exited;
      if (code !== 0) {
        // Surface the failure so a broken install doesn't silently leave the
        // pane blank. Read stderr best-effort for the diagnostic.
        let err = "";
        try {
          err = await new Response(proc.stderr as ReadableStream).text();
        } catch {
          /* ignore */
        }
        this.log(`bun install exited ${code}: ${err.trim().slice(0, 500)}`);
      }
    } catch (err) {
      this.log(`bun install failed: ${String(err)}`);
    }
  }

  private spawnBackend(
    inst: ExtensionBackendInstance,
    desc: ExtensionDescriptor,
    entry: string,
  ): void {
    let token = "";
    try {
      token = readFileSync(
        rpcTokenPathForSocket(this.deps.socketPath),
        "utf-8",
      ).trim();
    } catch {
      /* token disabled */
    }
    try {
      inst.backendProc = Bun.spawn([resolveBunBinary(), "run", entry], {
        cwd: desc.path,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PATH: loginShellPath(),
          HT_SOCKET_PATH: this.deps.socketPath,
          HT_RPC_TOKEN: token,
          HT_SURFACE_ID: inst.surfaceId,
          HT_EXTENSION_ID: desc.manifest.id,
          NO_COLOR: "1",
        },
      });
    } catch (err) {
      this.log(`backend spawn failed (${desc.manifest.id}): ${String(err)}`);
      inst.dead = true;
      this.emit(inst.surfaceId, {
        kind: "lifecycle",
        state: "exited",
        code: 1,
      });
      return;
    }
    this.readBackendStdout(inst);
    this.readBackendStderr(inst);
    inst.backendProc.exited.then((code) => {
      if (inst.dead) return;
      this.log(`backend exited (${desc.manifest.id}) code=${code}`);
      this.emit(inst.surfaceId, {
        kind: "lifecycle",
        state: "exited",
        code: code ?? 0,
      });
    });
  }

  private spawnDevServer(
    inst: ExtensionBackendInstance,
    desc: ExtensionDescriptor,
  ): void {
    const devCmd = desc.manifest.frontend?.dev;
    if (!devCmd) return;
    const port = desc.manifest.frontend?.devPort ?? 5173;
    const [bin, ...rest] = devCmd.split(" ");
    // Prefer the locally-installed binary (node_modules/.bin/<bin>) run via
    // bun — reliable and offline. Fall back to `bun x <bin>` only if it isn't
    // installed locally (which would fetch it).
    const localBin = join(desc.path, "node_modules", ".bin", bin);
    const argv = existsSync(localBin)
      ? [
          resolveBunBinary(),
          localBin,
          ...rest,
          "--port",
          String(port),
          "--strictPort",
        ]
      : [
          resolveBunBinary(),
          "x",
          bin,
          ...rest,
          "--port",
          String(port),
          "--strictPort",
        ];
    try {
      inst.devProc = Bun.spawn(argv, {
        cwd: desc.path,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PATH: loginShellPath(), NO_COLOR: "1" },
      });
      this.pipeLog(inst.devProc, `dev:${desc.manifest.id}`);
    } catch (err) {
      this.log(`dev server spawn failed (${desc.manifest.id}): ${String(err)}`);
    }
  }

  private async pipeLog(
    proc: ReturnType<typeof Bun.spawn>,
    tag: string,
  ): Promise<void> {
    const streams = [proc.stdout, proc.stderr].filter(Boolean);
    for (const s of streams) {
      void (async () => {
        try {
          const reader = (s as ReadableStream<Uint8Array>).getReader();
          const dec = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const t = dec.decode(value, { stream: true }).trim();
            if (t) this.log(`${tag}: ${t}`);
          }
        } catch {
          /* stream closed */
        }
      })();
    }
  }

  private async readBackendStdout(
    inst: ExtensionBackendInstance,
  ): Promise<void> {
    const stream = inst.backendProc?.stdout as
      | ReadableStream<Uint8Array>
      | undefined;
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        inst.buffer += decoder.decode(value, { stream: true });
        this.processBackendBuffer(inst);
      }
    } catch {
      /* closed */
    }
  }

  private async readBackendStderr(
    inst: ExtensionBackendInstance,
  ): Promise<void> {
    const stream = inst.backendProc?.stderr as
      | ReadableStream<Uint8Array>
      | undefined;
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const t = decoder.decode(value, { stream: true }).trim();
        if (t) this.log(`${inst.extensionId} stderr: ${t}`);
      }
    } catch {
      /* closed */
    }
  }

  /** Backend stdout is JSONL. Each line is forwarded to the frontend as a
   *  `backend-message` host payload. Non-JSON lines are treated as logs. */
  private processBackendBuffer(inst: ExtensionBackendInstance): void {
    while (true) {
      const nl = inst.buffer.indexOf("\n");
      if (nl === -1) break;
      let line = inst.buffer.slice(0, nl);
      inst.buffer = inst.buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        this.emit(inst.surfaceId, { kind: "backend-message", data });
      } catch {
        this.log(`${inst.extensionId}: ${line}`);
      }
    }
  }

  /** Forward an app-level message from the frontend to the extension's
   *  backend process stdin (JSONL). */
  forwardToBackend(surfaceId: string, data: unknown): void {
    const inst = this.instances.get(surfaceId);
    if (!inst || inst.dead || !inst.backendProc?.stdin) return;
    try {
      const writer = inst.backendProc.stdin as Bun.FileSink;
      writer.write(JSON.stringify(data) + "\n");
      writer.flush();
    } catch {
      /* backend gone */
    }
  }

  private emit(surfaceId: string, payload: ExtensionHostPayload): void {
    try {
      this.deps.onHostPayload?.(surfaceId, payload);
    } catch {
      /* never throw from a callback */
    }
  }

  /** Stop the backend (and dev server) for a surface. SIGTERM then SIGKILL. */
  stop(surfaceId: string): void {
    const inst = this.instances.get(surfaceId);
    if (!inst) return;
    inst.dead = true;
    for (const proc of [inst.backendProc, inst.devProc]) {
      if (!proc) continue;
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
    }
    this.instances.delete(surfaceId);
  }

  /** True when a surface id is a running extension backend. */
  isExtensionSurface(surfaceId: string): boolean {
    return this.instances.has(surfaceId);
  }

  // ── Authoring: scaffold / install / remove ──────────────────────────────

  /** Names of the available bundled scaffold templates. */
  listTemplates(): string[] {
    const dir = this.deps.templatesDir;
    if (!dir || !existsSync(dir)) return [];
    try {
      return readdirSync(dir).filter((n) => {
        try {
          return (
            statSync(join(dir, n)).isDirectory() &&
            existsSync(join(dir, n, "manifest.json"))
          );
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }

  /** Copy a template into a new extension dir, rewriting the manifest
   *  id/name. `template` is a bundled template name (resolved under
   *  `templatesDir`) or an absolute path to a template dir. */
  scaffold(opts: {
    id: string;
    name?: string;
    template: string;
  }): ExtensionDescriptor {
    if (!isValidExtensionId(opts.id))
      throw new Error(`invalid extension id: ${opts.id}`);
    const dest = join(this.extensionsDir, opts.id);
    if (existsSync(dest))
      throw new Error(`extension already exists: ${opts.id}`);
    const templateDir = opts.template.startsWith("/")
      ? opts.template
      : join(this.deps.templatesDir ?? "", opts.template);
    if (!existsSync(templateDir))
      throw new Error(`template not found: ${opts.template}`);
    cpSync(templateDir, dest, { recursive: true });
    // Rewrite manifest id/name.
    const manifestPath = join(dest, "manifest.json");
    let manifest: ExtensionManifest;
    try {
      manifest = JSON.parse(
        readFileSync(manifestPath, "utf-8"),
      ) as ExtensionManifest;
    } catch {
      manifest = { id: opts.id, name: opts.name ?? opts.id, version: "0.1.0" };
    }
    manifest.id = opts.id;
    if (opts.name) manifest.name = opts.name;
    writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
    this.reload();
    const desc = this.descriptors.get(opts.id);
    if (!desc) throw new Error(`scaffold failed to register: ${opts.id}`);
    return desc;
  }

  /** Register an external extension directory (copies it into the store). */
  install(srcDir: string): ExtensionDescriptor {
    const manifest = this.readManifest(srcDir);
    if (!manifest) throw new Error(`no valid manifest.json in ${srcDir}`);
    const dest = join(this.extensionsDir, manifest.id);
    if (existsSync(dest))
      throw new Error(`extension already installed: ${manifest.id}`);
    cpSync(srcDir, dest, { recursive: true });
    this.reload();
    const desc = this.descriptors.get(manifest.id);
    if (!desc) throw new Error(`install failed to register: ${manifest.id}`);
    return desc;
  }

  /** Stop any running surfaces for this extension and delete it from disk. */
  remove(id: string): void {
    for (const [sid, inst] of this.instances) {
      if (inst.extensionId === id) this.stop(sid);
    }
    const dir = join(this.extensionsDir, id);
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      this.log(`remove failed (${id}): ${String(err)}`);
    }
    this.reload();
  }

  /** Kill every backend + the static server on app shutdown. */
  dispose(): void {
    for (const [sid] of this.instances) this.stop(sid);
    try {
      this.staticServer?.stop(true);
    } catch {
      /* ignore */
    }
    this.staticServer = null;
  }

  get backendCount(): number {
    return this.instances.size;
  }

  get extensionsRoot(): string {
    return this.extensionsDir;
  }
}
