import { test, expect } from "bun:test";
import { mkdtempSync, cpSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionManager } from "../src/bun/extension-manager";

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
