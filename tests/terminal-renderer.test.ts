import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

/**
 * `attachRenderer`'s whole job is to never leave a pane without a
 * renderer. happy-dom has no WebGL, so these tests drive the decision by
 * stubbing `HTMLCanvasElement.getContext` and the addon module — what
 * matters is the branching, not real GPU output.
 */

// Stub the addon before the module under test imports it.
let addonBehaviour: "ok" | "throw-construct" | "throw-load" = "ok";
let lastAddon: StubAddon | null = null;

interface StubAddon {
  disposed: boolean;
  contextLossHandler: (() => void) | null;
  onContextLoss(handler: () => void): void;
  dispose(): void;
}

/** Constructed via `new WebglAddon()` by the module under test, so this
 *  has to be newable — but it records the instance through a closure
 *  rather than aliasing `this`. */
const WebglAddonStub = function WebglAddon(this: unknown): StubAddon {
  if (addonBehaviour === "throw-construct") {
    throw new Error("no webgl context");
  }
  const instance: StubAddon = {
    disposed: false,
    contextLossHandler: null,
    onContextLoss(handler) {
      instance.contextLossHandler = handler;
    },
    dispose() {
      instance.disposed = true;
    },
  };
  lastAddon = instance;
  return instance;
} as unknown as new () => StubAddon;

void mock.module("@xterm/addon-webgl", () => ({ WebglAddon: WebglAddonStub }));

const { attachRenderer, resetRendererWarningsForTest } =
  await import("../src/views/terminal/terminal-renderer");

/** Minimal `Terminal` stand-in — `attachRenderer` only calls loadAddon. */
function makeTerm(): { loadAddon: (a: unknown) => void; loaded: unknown[] } {
  const loaded: unknown[] = [];
  return {
    loaded,
    loadAddon(a: unknown) {
      if (addonBehaviour === "throw-load") throw new Error("load failed");
      loaded.push(a);
    },
  };
}

/** Pretend the platform does (or doesn't) have WebGL. */
function setWebglAvailable(available: boolean): void {
  HTMLCanvasElement.prototype.getContext = ((type: string) => {
    if (!available) return null;
    if (
      type === "webgl2" ||
      type === "webgl" ||
      type === "experimental-webgl"
    ) {
      return { getExtension: () => ({ loseContext() {} }) };
    }
    return null;
  }) as unknown as HTMLCanvasElement["getContext"];
}

afterEach(() => {
  addonBehaviour = "ok";
  lastAddon = null;
  resetRendererWarningsForTest();
});

describe("attachRenderer", () => {
  test("attaches the WebGL addon when the platform supports it", () => {
    setWebglAvailable(true);
    const term = makeTerm();

    const handle = attachRenderer(term as never, "webgl");

    expect(handle.active).toBe("webgl");
    expect(handle.fallbackReason).toBeNull();
    expect(term.loaded.length).toBe(1);
  });

  test("honours an explicit DOM request without touching WebGL", () => {
    setWebglAvailable(true);
    const term = makeTerm();

    const handle = attachRenderer(term as never, "dom");

    expect(handle.active).toBe("dom");
    expect(handle.fallbackReason).toBe("setting");
    expect(term.loaded.length).toBe(0);
  });

  test("falls back to DOM when the platform has no WebGL", () => {
    setWebglAvailable(false);
    const term = makeTerm();

    const handle = attachRenderer(term as never, "webgl");

    expect(handle.active).toBe("dom");
    expect(handle.fallbackReason).toBe("unsupported");
    expect(term.loaded.length).toBe(0);
  });

  test("falls back to DOM when the addon constructor throws", () => {
    setWebglAvailable(true);
    addonBehaviour = "throw-construct";
    const term = makeTerm();

    const handle = attachRenderer(term as never, "webgl");

    expect(handle.active).toBe("dom");
    expect(handle.fallbackReason).toBe("init-failed");
  });

  test("falls back to DOM — and disposes the addon — when loadAddon throws", () => {
    setWebglAvailable(true);
    addonBehaviour = "throw-load";
    const term = makeTerm();

    const handle = attachRenderer(term as never, "webgl");

    expect(handle.active).toBe("dom");
    expect(handle.fallbackReason).toBe("init-failed");
    // The half-attached addon must not leak its GPU context.
    expect(lastAddon?.disposed).toBe(true);
  });

  test("context loss disposes the addon and reports DOM afterwards", () => {
    setWebglAvailable(true);
    const term = makeTerm();

    const handle = attachRenderer(term as never, "webgl");
    expect(handle.active).toBe("webgl");

    // Simulate the driver yanking the context out from under us.
    lastAddon!.contextLossHandler!();

    expect(handle.active).toBe("dom");
    expect(handle.fallbackReason).toBe("context-lost");
    expect(lastAddon!.disposed).toBe(true);
  });

  test("dispose is idempotent and safe after context loss", () => {
    setWebglAvailable(true);
    const term = makeTerm();
    const handle = attachRenderer(term as never, "webgl");

    lastAddon!.contextLossHandler!();
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });

  test("disposing a DOM handle is a no-op", () => {
    setWebglAvailable(false);
    const handle = attachRenderer(makeTerm() as never, "webgl");
    expect(() => handle.dispose()).not.toThrow();
  });

  test("a failing platform is reported once, not once per pane", () => {
    setWebglAvailable(false);
    const warn = console.warn;
    let calls = 0;
    console.warn = () => {
      calls++;
    };
    try {
      for (let i = 0; i < 5; i++) attachRenderer(makeTerm() as never, "webgl");
    } finally {
      console.warn = warn;
    }
    expect(calls).toBe(1);
  });
});
