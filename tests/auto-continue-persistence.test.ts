// P7 S6 — auto-continue paused-surfaces persistence.
//
// Mirrors the shape of notification-persistence.test.ts: load + write
// + corruption + debounce coalesce.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPausedSurfacesPersister,
  loadPausedSurfaces,
} from "../src/bun/auto-continue-persistence";

describe("auto-continue-persistence", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tau-ac-paused-"));
    path = join(dir, "auto-continue-paused.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadPausedSurfaces returns [] when the file is absent", () => {
    expect(loadPausedSurfaces(path)).toEqual([]);
  });

  test("loadPausedSurfaces reads a v1 snapshot", () => {
    writeFileSync(
      path,
      JSON.stringify({ version: 1, paused: ["surface:1", "surface:2"] }),
    );
    expect(loadPausedSurfaces(path)).toEqual(["surface:1", "surface:2"]);
  });

  test("loadPausedSurfaces skips unknown versions (silent empty)", () => {
    writeFileSync(
      path,
      JSON.stringify({ version: 999, paused: ["surface:1"] }),
    );
    expect(loadPausedSurfaces(path)).toEqual([]);
  });

  test("loadPausedSurfaces swallows malformed JSON", () => {
    writeFileSync(path, "{ not json");
    expect(loadPausedSurfaces(path)).toEqual([]);
  });

  test("loadPausedSurfaces filters non-string entries from a tampered file", () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        paused: ["ok", 42, null, "also-ok"],
      }),
    );
    expect(loadPausedSurfaces(path)).toEqual(["ok", "also-ok"]);
  });

  test("persist debounces a burst into one write + round-trips", () => {
    const { persist, flush } = createPausedSurfacesPersister(path, 20);
    persist(["a"]);
    persist(["a", "b"]);
    persist(["a", "b", "c"]);
    expect(existsSync(path)).toBe(false); // debounced, nothing yet

    flush();
    expect(existsSync(path)).toBe(true);
    expect(loadPausedSurfaces(path)).toEqual(["a", "b", "c"]);
  });

  test("debounced write fires after the delay expires", async () => {
    const { persist } = createPausedSurfacesPersister(path, 20);
    persist(["only"]);
    await new Promise((r) => setTimeout(r, 50));
    expect(loadPausedSurfaces(path)).toEqual(["only"]);
  });
});
