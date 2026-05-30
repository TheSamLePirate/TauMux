// C1 (full_app_review_2026-05.md): the web mirror's auto-start and
// port-change paths constructed `new WebServer(...)` WITHOUT the user's
// configured `webMirrorBind` / `webMirrorAuthToken`, so they fell through to
// the constructor's unsafe defaults (0.0.0.0 / no-auth) — silently defeating
// a configured loopback bind + token on the exact path that runs at launch.
//
// The fix routes ALL construction through a single `createWebServer()`
// factory that always threads both settings, and makes the constructor's
// bind/authToken params required (no defaults) so a forgotten arg is a
// typecheck error in src/. These tests are a source-level guard that the
// regression can't silently come back: any new raw `new WebServer(` in
// index.ts, or a factory that stops threading the settings, fails here.

import { describe, test, expect } from "bun:test";

const indexSrc = await Bun.file(
  new URL("../src/bun/index.ts", import.meta.url),
).text();
const serverSrc = await Bun.file(
  new URL("../src/bun/web/server.ts", import.meta.url),
).text();

describe("[C1] web-mirror construction threads bind + auth token", () => {
  test("index.ts constructs WebServer exactly once (inside the factory)", () => {
    const rawCtors = indexSrc.match(/new WebServer\(/g) ?? [];
    // Exactly one raw constructor call — the one inside createWebServer().
    // Auto-start and applyWebMirrorPort must go through the factory, never
    // a bespoke `new WebServer(...)` that could drop the security args.
    expect(rawCtors.length).toBe(1);
  });

  test("the factory threads webMirrorBind + webMirrorAuthToken", () => {
    const start = indexSrc.indexOf("function createWebServer");
    expect(start).toBeGreaterThan(-1);
    // Slice the factory body (up to the next top-level `function`/`}` block
    // is overkill; the next ~25 lines contain the whole construction).
    const body = indexSrc.slice(start, start + 800);
    expect(body).toContain("new WebServer(");
    expect(body).toContain("webMirrorBind");
    expect(body).toContain("webMirrorAuthToken");
  });

  test("auto-start and port-change use the factory, not a raw constructor", () => {
    // Both call sites assign the factory result. If someone re-inlines a
    // `new WebServer(` at either site, the count assertion above also trips.
    const factoryUses =
      indexSrc.match(/app\.webServer = createWebServer\(\)/g) ?? [];
    // toggle + auto-start + applyWebMirrorPort = 3 uses.
    expect(factoryUses.length).toBe(3);
  });

  test("WebServer constructor has no default for bind/authToken (no unsafe fallback)", () => {
    // The footgun was `bind: ... = "0.0.0.0"` and `authToken: string = ""`.
    // Pin that those defaults are gone so the params stay required.
    expect(serverSrc).not.toMatch(/bind:[^,\n]*=\s*"0\.0\.0\.0"/);
    expect(serverSrc).not.toMatch(/authToken:\s*string\s*=\s*""/);
  });
});
