import { test, expect } from "bun:test";
import { mkdtempSync, cpSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExtensionManager,
  firstFreePort,
} from "../src/bun/extension-manager";

const EXAMPLES = join(import.meta.dir, "..", "examples", "extensions");
const HELLO_SRC = join(EXAMPLES, "hello");
const HELLO_ID = "com.taumux.hello";

function freshConfig(): string {
  return mkdtempSync(join(tmpdir(), "ht-ext-test-"));
}

function installHello(cfg: string): void {
  mkdirSync(join(cfg, "extensions"), { recursive: true });
  cpSync(HELLO_SRC, join(cfg, "extensions", HELLO_ID), { recursive: true });
}

test("registry discovers an installed extension (with a committed build)", () => {
  const cfg = freshConfig();
  installHello(cfg);
  const mgr = new ExtensionManager({
    configDir: cfg,
    socketPath: join(cfg, "s"),
  });
  try {
    const hello = mgr.get(HELLO_ID);
    expect(hello).toBeDefined();
    expect(hello!.manifest.name).toBe("Hello Extension");
    // dist/index.html is committed, so it resolves as a built bundle.
    expect(hello!.hasBuild).toBe(true);
    expect(mgr.list().some((d) => d.manifest.id === HELLO_ID)).toBe(true);
  } finally {
    mgr.dispose();
    rmSync(cfg, { recursive: true, force: true });
  }
});

test("scaffold clones a bundled template and registers it", () => {
  const cfg = freshConfig();
  const mgr = new ExtensionManager({
    configDir: cfg,
    socketPath: join(cfg, "s"),
    templatesDir: EXAMPLES,
  });
  try {
    const desc = mgr.scaffold({
      id: "com.test.copy",
      name: "Copy",
      template: "hello",
    });
    expect(desc.manifest.id).toBe("com.test.copy");
    expect(desc.manifest.name).toBe("Copy");
    expect(mgr.has("com.test.copy")).toBe(true);
  } finally {
    mgr.dispose();
    rmSync(cfg, { recursive: true, force: true });
  }
});

test("scaffold rejects an invalid id and a duplicate", () => {
  const cfg = freshConfig();
  const mgr = new ExtensionManager({
    configDir: cfg,
    socketPath: join(cfg, "s"),
    templatesDir: EXAMPLES,
  });
  try {
    expect(() =>
      mgr.scaffold({ id: "../escape", template: "hello" }),
    ).toThrow();
    mgr.scaffold({ id: "dup", template: "hello" });
    expect(() => mgr.scaffold({ id: "dup", template: "hello" })).toThrow();
  } finally {
    mgr.dispose();
    rmSync(cfg, { recursive: true, force: true });
  }
});

test("ensureBackend (built) serves the bundle over the static host", async () => {
  const cfg = freshConfig();
  installHello(cfg);
  const mgr = new ExtensionManager({
    configDir: cfg,
    socketPath: join(cfg, "s"),
  });
  try {
    const handle = await mgr.ensureBackend(HELLO_ID, "ext:test:1");
    expect(handle.extensionId).toBe(HELLO_ID);
    expect(handle.bundleUrl).toBeDefined();
    expect(handle.devUrl).toBeUndefined();
    const res = await fetch(handle.bundleUrl!);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Hello from a");
    expect(mgr.isExtensionSurface("ext:test:1")).toBe(true);
  } finally {
    mgr.stop("ext:test:1");
    mgr.dispose();
    rmSync(cfg, { recursive: true, force: true });
  }
});

test("static host rejects path traversal + unknown ids", async () => {
  const cfg = freshConfig();
  installHello(cfg);
  const mgr = new ExtensionManager({
    configDir: cfg,
    socketPath: join(cfg, "s"),
  });
  try {
    const handle = await mgr.ensureBackend(HELLO_ID, "ext:test:2");
    const base = new URL(handle.bundleUrl!);
    const origin = base.origin;
    const unknown = await fetch(`${origin}/ext/com.nope.missing/index.html`);
    expect(unknown.status).toBe(404);
    const traversal = await fetch(
      `${origin}/ext/${HELLO_ID}/..%2F..%2Fmanifest.json`,
    );
    expect([400, 404]).toContain(traversal.status);
  } finally {
    mgr.stop("ext:test:2");
    mgr.dispose();
    rmSync(cfg, { recursive: true, force: true });
  }
});

test("remove deletes the extension dir and deregisters it", () => {
  const cfg = freshConfig();
  installHello(cfg);
  const mgr = new ExtensionManager({
    configDir: cfg,
    socketPath: join(cfg, "s"),
  });
  try {
    expect(mgr.has(HELLO_ID)).toBe(true);
    mgr.remove(HELLO_ID);
    expect(mgr.has(HELLO_ID)).toBe(false);
  } finally {
    mgr.dispose();
    rmSync(cfg, { recursive: true, force: true });
  }
});

// ── §2.3 — `enabled` is enforced, not decorative ────────────────────────
//
// Before full_app_review_2026-08.md §2.3 this flag was loaded from the
// registry, reconciled back to disk and reported by `extension.list`, but
// no code path ever read it as a condition and nothing could set it. A
// "disabled" extension launched exactly like an enabled one.

test("setEnabled persists across a reload", () => {
  const cfg = freshConfig();
  installHello(cfg);
  const mgr = new ExtensionManager({
    configDir: cfg,
    socketPath: join(cfg, "s"),
  });
  try {
    expect(mgr.isEnabled(HELLO_ID)).toBe(true);

    mgr.setEnabled(HELLO_ID, false);
    expect(mgr.isEnabled(HELLO_ID)).toBe(false);

    // Re-scan reads the registry back off disk — the flag must survive.
    mgr.reload();
    expect(mgr.isEnabled(HELLO_ID)).toBe(false);

    // And a completely fresh manager over the same config dir.
    const mgr2 = new ExtensionManager({
      configDir: cfg,
      socketPath: join(cfg, "s"),
    });
    try {
      expect(mgr2.isEnabled(HELLO_ID)).toBe(false);
    } finally {
      mgr2.dispose();
    }

    mgr.setEnabled(HELLO_ID, true);
    expect(mgr.isEnabled(HELLO_ID)).toBe(true);
  } finally {
    mgr.dispose();
    rmSync(cfg, { recursive: true, force: true });
  }
});

test("ensureBackend refuses to start a disabled extension", async () => {
  const cfg = freshConfig();
  installHello(cfg);
  const mgr = new ExtensionManager({
    configDir: cfg,
    socketPath: join(cfg, "s"),
  });
  try {
    mgr.setEnabled(HELLO_ID, false);
    await expect(mgr.ensureBackend(HELLO_ID, "ext:1")).rejects.toThrow(
      /disabled/i,
    );
    // Nothing was registered for the surface, so no orphan instance.
    expect(mgr.isExtensionSurface("ext:1")).toBe(false);
    expect(mgr.backendCount).toBe(0);
  } finally {
    mgr.dispose();
    rmSync(cfg, { recursive: true, force: true });
  }
});

test("setEnabled(false) rejects an unknown id rather than inventing one", () => {
  const cfg = freshConfig();
  const mgr = new ExtensionManager({
    configDir: cfg,
    socketPath: join(cfg, "s"),
  });
  try {
    expect(() => mgr.setEnabled("com.test.nope", false)).toThrow(/unknown/i);
  } finally {
    mgr.dispose();
    rmSync(cfg, { recursive: true, force: true });
  }
});

// ── §3.4 — dev-server port collision ────────────────────────────────────
//
// `waitForPort` only proves SOMETHING accepts TCP. With every manifest
// defaulting to 5173, a second extension's `--strictPort` Vite failed to
// bind, the readiness probe saw the FIRST one, and the second pane loaded
// the first extension's UI. Same against any unrelated Vite project the
// user had running. So we now claim a known-free port before spawning.

test("firstFreePort skips a port that is already listening", async () => {
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const taken = server.port;
  try {
    const got = await firstFreePort(taken);
    expect(got).not.toBe(taken);
    expect(got).toBeGreaterThan(taken);

    // The port it picked must genuinely be bindable.
    const probe = Bun.listen({
      hostname: "127.0.0.1",
      port: got,
      socket: { data() {} },
    });
    probe.stop(true);
  } finally {
    server.stop(true);
  }
});

test("firstFreePort returns the requested port when it is free", async () => {
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const port = server.port;
  server.stop(true); // now known-free
  expect(await firstFreePort(port)).toBe(port);
});
