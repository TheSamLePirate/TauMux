import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { installViewportKeyboardTracking } from "../src/web-client/viewport-keyboard";

/**
 * iOS keyboard occlusion → --kbd-occlusion CSS var. The toolbar and
 * pane container consume the var; this tests the computation itself.
 */

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

interface FakeVV {
  height: number;
  offsetTop: number;
  listeners: Record<string, Array<() => void>>;
  addEventListener(kind: string, fn: () => void): void;
  fire(kind: string): void;
}

function fakeVisualViewport(height: number, offsetTop = 0): FakeVV {
  const vv: FakeVV = {
    height,
    offsetTop,
    listeners: {},
    addEventListener(kind, fn) {
      (vv.listeners[kind] ??= []).push(fn);
    },
    fire(kind) {
      for (const fn of vv.listeners[kind] ?? []) fn();
    },
  };
  return vv;
}

function withFakeViewport<T>(vv: FakeVV | null, innerHeight: number, fn: () => T): T {
  const w = window as unknown as {
    visualViewport: unknown;
    innerHeight: number;
  };
  const prevVV = w.visualViewport;
  const prevH = w.innerHeight;
  w.visualViewport = vv;
  w.innerHeight = innerHeight;
  try {
    return fn();
  } finally {
    w.visualViewport = prevVV;
    w.innerHeight = prevH;
    document.documentElement.style.removeProperty("--kbd-occlusion");
  }
}

const readVar = () =>
  document.documentElement.style.getPropertyValue("--kbd-occlusion");

describe("installViewportKeyboardTracking", () => {
  test("no visualViewport (older engine) → no-op, no var", () => {
    withFakeViewport(null, 800, () => {
      expect(() => installViewportKeyboardTracking()).not.toThrow();
      expect(readVar()).toBe("");
    });
  });

  test("full-height viewport (desktop / keyboard closed) → 0px", () => {
    withFakeViewport(fakeVisualViewport(800), 800, () => {
      installViewportKeyboardTracking();
      expect(readVar()).toBe("0px");
    });
  });

  test("shrunk viewport (keyboard open) → occluded strip in px", () => {
    const vv = fakeVisualViewport(450);
    withFakeViewport(vv, 800, () => {
      installViewportKeyboardTracking();
      expect(readVar()).toBe("350px");
    });
  });

  test("offsetTop is subtracted (visible pan shifted down)", () => {
    const vv = fakeVisualViewport(450, 50);
    withFakeViewport(vv, 800, () => {
      installViewportKeyboardTracking();
      expect(readVar()).toBe("300px");
    });
  });

  test("resize + scroll events re-publish; closing the keyboard returns to 0", () => {
    const vv = fakeVisualViewport(450);
    withFakeViewport(vv, 800, () => {
      installViewportKeyboardTracking();
      expect(readVar()).toBe("350px");
      // Keyboard animates further (scroll path).
      vv.height = 400;
      vv.fire("scroll");
      expect(readVar()).toBe("400px");
      // Keyboard closes.
      vv.height = 800;
      vv.fire("resize");
      expect(readVar()).toBe("0px");
    });
  });

  test("never negative (quirk guard)", () => {
    const vv = fakeVisualViewport(900); // taller than innerHeight
    withFakeViewport(vv, 800, () => {
      installViewportKeyboardTracking();
      expect(readVar()).toBe("0px");
    });
  });
});
