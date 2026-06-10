import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeApi } from "../packages/tau-mux-sdk/src/protocol";

/**
 * Regression guard for the @tau-mux/sdk method table (the `sidebar.setStatus`
 * → `sidebar.set_status` bug class, v0.4.4).
 *
 * Direction 1 — no phantom methods: every wire name the SDK's typed facade
 * emits must be a method actually registered in `src/bun/rpc-handlers/`.
 * A typo in the SDK table would otherwise fail silently at runtime.
 *
 * Direction 2 — full coverage: every method registered in the handlers must
 * be reachable through a typed SDK namespace (extensions are fully trusted;
 * "access to everything" is the contract). `__test.*` is excluded (Tier-2
 * test mode only).
 */

const HANDLERS_DIR = join(import.meta.dir, "..", "src", "bun", "rpc-handlers");

/** Method names registered as object keys: `"domain.name": (params) =>`. */
function registeredMethods(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(HANDLERS_DIR)) {
    if (!f.endsWith(".ts")) continue;
    const src = readFileSync(join(HANDLERS_DIR, f), "utf-8");
    for (const m of src.matchAll(/^\s*"([a-z]+\.[a-z_]+)":/gm)) {
      out.add(m[1]);
    }
  }
  out.delete("__proto__.x"); // defensive; regex can't actually produce this
  return out;
}

/** Wire names the SDK facade can emit, collected by invoking every generated
 *  method against a recording `call`. */
function sdkMethods(): Set<string> {
  const seen = new Set<string>();
  const api = makeApi((method) => {
    seen.add(method);
    return Promise.resolve(undefined);
  });
  for (const [key, value] of Object.entries(api)) {
    if (key === "call" || typeof value !== "object" || value === null) continue;
    for (const fn of Object.values(value as Record<string, unknown>)) {
      if (typeof fn === "function") void (fn as () => Promise<unknown>)();
    }
  }
  return seen;
}

test("every SDK method maps to a registered RPC method (no phantom names)", () => {
  const registered = registeredMethods();
  const phantom = [...sdkMethods()].filter((m) => !registered.has(m));
  expect(phantom).toEqual([]);
});

test("every registered RPC method is reachable through a typed SDK namespace", () => {
  const sdk = sdkMethods();
  const missing = [...registeredMethods()].filter(
    (m) => !m.startsWith("__test.") && !sdk.has(m),
  );
  expect(missing).toEqual([]);
});
