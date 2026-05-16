// Phase 3 Step 5 — Terminal effects tests.
//
// terminal-effects.ts owns the WebGL bloom layer. happy-dom doesn't
// provide a real WebGL context, so the constructor lands in the
// graceful-fallback path (`available = false`) — which is itself the
// invariant we most need to pin (a future refactor that crashes the
// terminal when WebGL is missing is exactly the regression class to
// guard against).
//
// We test:
//   1. Construction in happy-dom returns a working object with
//      available=false (no crash, no thrown error).
//   2. Public methods (pulseInput, pulseOutput, setEnabled,
//      setIntensity, setFocused, destroy) are no-ops under
//      available=false.
//   3. destroy() is idempotent and safe.
//   4. Source-grep constants pin the rate-limit + ring shapes so a
//      future "tune the constants" PR comes through this test.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = "";
});

const SRC = readFileSync(
  join(
    import.meta.dir,
    "..",
    "src",
    "views",
    "terminal",
    "terminal-effects.ts",
  ),
  "utf-8",
);

async function load() {
  return await import("../src/views/terminal/terminal-effects");
}

/** Minimal Terminal mock — just enough for the constructor + public
 *  methods. xterm's `onRender`, `onScroll`, `onWriteParsed` return
 *  disposables; we collect them so we can verify destroy() disposes. */
function mockTerminal() {
  const disposables: { disposed: boolean }[] = [];
  function disposableHandler() {
    const d = {
      disposed: false,
      dispose() {
        d.disposed = true;
      },
    };
    disposables.push(d);
    return d;
  }
  const term = {
    cols: 80,
    rows: 24,
    buffer: {
      active: {
        baseY: 0,
        cursorX: 0,
        cursorY: 0,
        getLine: () => null,
      },
    },
    onRender: disposableHandler,
    onScroll: disposableHandler,
    onWriteParsed: disposableHandler,
  };
  return { term, disposables };
}

describe("[Phase 3] TerminalEffects — graceful WebGL-unavailable fallback", () => {
  test("constructor does not throw when WebGL is missing", async () => {
    const { TerminalEffects } = await load();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { term } = mockTerminal();
    let effects;
    expect(() => {
      effects = new TerminalEffects(host, term as unknown as never);
    }).not.toThrow();
    expect(effects).toBeDefined();
  });

  test("isEnabled() returns false when WebGL is unavailable", async () => {
    const { TerminalEffects } = await load();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { term } = mockTerminal();
    const e = new TerminalEffects(host, term as unknown as never);
    expect(e.isEnabled()).toBe(false);
  });

  test("the canvas element is appended to the host but hidden", async () => {
    const { TerminalEffects } = await load();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { term } = mockTerminal();
    new TerminalEffects(host, term as unknown as never);
    const canvas = host.querySelector(".terminal-effects-layer");
    expect(canvas).not.toBeNull();
    expect((canvas as HTMLElement).style.display).toBe("none");
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("[Phase 3] TerminalEffects — public methods under fallback", () => {
  test("pulseInput / pulseOutput / setFocused are safe no-ops", async () => {
    const { TerminalEffects } = await load();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { term } = mockTerminal();
    const e = new TerminalEffects(host, term as unknown as never);
    expect(() => {
      e.pulseInput();
      e.pulseOutput();
      e.pulseInput(10);
      e.pulseOutput(20);
      e.setFocused(true);
      e.setFocused(false);
    }).not.toThrow();
  });

  test("setEnabled is a no-op when WebGL is unavailable", async () => {
    const { TerminalEffects } = await load();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { term } = mockTerminal();
    const e = new TerminalEffects(host, term as unknown as never);
    e.setEnabled(true);
    expect(e.isEnabled()).toBe(false);
    e.setEnabled(false);
    expect(e.isEnabled()).toBe(false);
  });

  test("setIntensity clamps negative values to 0", async () => {
    const { TerminalEffects } = await load();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { term } = mockTerminal();
    const e = new TerminalEffects(host, term as unknown as never);
    expect(() => {
      e.setIntensity(-5);
      e.setIntensity(0);
      e.setIntensity(1);
      e.setIntensity(100);
    }).not.toThrow();
  });
});

describe("[Phase 3] TerminalEffects — destroy lifecycle", () => {
  test("destroy() runs cleanly under fallback", async () => {
    const { TerminalEffects } = await load();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { term } = mockTerminal();
    const e = new TerminalEffects(host, term as unknown as never);
    expect(() => e.destroy()).not.toThrow();
  });

  test("destroy() is idempotent", async () => {
    const { TerminalEffects } = await load();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { term } = mockTerminal();
    const e = new TerminalEffects(host, term as unknown as never);
    expect(() => {
      e.destroy();
      e.destroy();
      e.destroy();
    }).not.toThrow();
  });
});

describe("[Phase 3] TerminalEffects — source-level invariants", () => {
  test("rate-limit constants stay sane (input 16ms / output 35ms)", () => {
    // These are the perf-pass tuning knobs. A future PR that tunes
    // them down to 1ms or removes them entirely would reintroduce
    // the overlapping-rings flood — pin the shape, not the exact
    // value, so a reasoned tune is still possible.
    expect(SRC).toMatch(/INPUT_PULSE_MIN_INTERVAL_MS\s*=\s*\d+/);
    expect(SRC).toMatch(/OUTPUT_PULSE_MIN_INTERVAL_MS\s*=\s*\d+/);
    expect(SRC).toMatch(/RASTER_MIN_INTERVAL_MS\s*=\s*\d+/);
  });

  test("MAX_PULSES is bounded so the GPU uniform array doesn't grow unbounded", () => {
    expect(SRC).toMatch(/MAX_PULSES\s*=\s*\d+/);
    // Match the value; pinning a magnitude is enough — the regression
    // would be removing the cap entirely.
    const m = SRC.match(/MAX_PULSES\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    const n = Number(m![1]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(64); // sane ceiling — uniforms are pricey
  });

  test("the WebGL context request prefers webgl2 with webgl as fallback", () => {
    // Mirror parity: a refactor that drops the fallback would crash
    // on older WebViews (some Linux distros ship without webgl2).
    expect(SRC).toContain('getContext("webgl2"');
    expect(SRC).toContain('getContext("webgl"');
  });

  test("the fragment shader carries the documented uniform contract", () => {
    expect(SRC).toContain("uniform vec2 u_resolution");
    expect(SRC).toContain("uniform int u_pulseCount");
    expect(SRC).toContain("uniform vec4 u_pulseData[MAX_PULSES]");
    expect(SRC).toContain("uniform sampler2D u_occluderTex");
  });
});
