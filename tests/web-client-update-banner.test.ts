// D.3 — DOM coverage for the SW update-available banner. Service-
// worker behaviour itself can only be exercised in a real browser
// (see doc/tracking_deferred_items.md for the manual recipe), but the
// banner is plain DOM and worth pinning at the unit level so its
// rendering, idempotence, and click handling don't regress silently.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function loadModule() {
  return await import("../src/web-client/update-banner");
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("update-banner — show / hide", () => {
  test("showUpdateBanner mounts a single banner with Reload + Later", async () => {
    const { showUpdateBanner } = await loadModule();
    showUpdateBanner({ getWaitingWorker: () => null });

    const banner = document.getElementById("tau-mux-update-banner");
    expect(banner).not.toBeNull();
    const buttons = banner!.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    const labels = Array.from(buttons).map((b) => b.textContent);
    expect(labels).toContain("Reload");
    expect(labels).toContain("Later");
    // role=status announces to AT users without stealing focus.
    expect(banner!.getAttribute("role")).toBe("status");
  });

  test("calling showUpdateBanner twice is a no-op (idempotent)", async () => {
    const { showUpdateBanner } = await loadModule();
    showUpdateBanner({ getWaitingWorker: () => null });
    showUpdateBanner({ getWaitingWorker: () => null });
    const banners = document.querySelectorAll("#tau-mux-update-banner");
    expect(banners.length).toBe(1);
    // Style block is also single-instance.
    const styles = document.querySelectorAll("#tau-mux-update-banner-style");
    expect(styles.length).toBe(1);
  });

  test("hideUpdateBanner removes the banner without crashing on missing", async () => {
    const { showUpdateBanner, hideUpdateBanner } = await loadModule();
    hideUpdateBanner(); // no-op when nothing mounted
    showUpdateBanner({ getWaitingWorker: () => null });
    expect(document.getElementById("tau-mux-update-banner")).not.toBeNull();
    hideUpdateBanner();
    expect(document.getElementById("tau-mux-update-banner")).toBeNull();
  });
});

describe("update-banner — Reload click", () => {
  test("posts SKIP_WAITING to the waiting worker when present", async () => {
    const { showUpdateBanner } = await loadModule();
    const messages: unknown[] = [];
    const fakeWorker = {
      postMessage(data: unknown) {
        messages.push(data);
      },
    } as unknown as ServiceWorker;

    showUpdateBanner({ getWaitingWorker: () => fakeWorker });

    const reloadBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "#tau-mux-update-banner button",
      ),
    ).find((b) => b.textContent === "Reload")!;
    reloadBtn.click();

    expect(messages).toEqual([{ type: "SKIP_WAITING" }]);
    // Banner stays up — the page reload is driven by the
    // controllerchange listener in pwa.ts, not by the click handler.
    expect(document.getElementById("tau-mux-update-banner")).not.toBeNull();
  });

  test("falls back to a hard reload when the waiting worker is gone", async () => {
    const { showUpdateBanner } = await loadModule();
    let reloadCalled = 0;
    const originalReload = window.location.reload;
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      value: () => {
        reloadCalled += 1;
      },
    });

    try {
      showUpdateBanner({ getWaitingWorker: () => null });
      const reloadBtn = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          "#tau-mux-update-banner button",
        ),
      ).find((b) => b.textContent === "Reload")!;
      reloadBtn.click();
      expect(reloadCalled).toBe(1);
    } finally {
      Object.defineProperty(window.location, "reload", {
        configurable: true,
        value: originalReload,
      });
    }
  });

  test("custom onReload override skips both postMessage and reload", async () => {
    const { showUpdateBanner } = await loadModule();
    let onReloadCalls = 0;
    const fakeWorker = {
      postMessage() {
        throw new Error("must not be called when onReload is provided");
      },
    } as unknown as ServiceWorker;

    showUpdateBanner({
      getWaitingWorker: () => fakeWorker,
      onReload: () => {
        onReloadCalls += 1;
      },
    });
    const reloadBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "#tau-mux-update-banner button",
      ),
    ).find((b) => b.textContent === "Reload")!;
    reloadBtn.click();
    expect(onReloadCalls).toBe(1);
  });
});

describe("update-banner — Later click", () => {
  test("dismisses the banner without notifying the SW", async () => {
    const { showUpdateBanner } = await loadModule();
    const messages: unknown[] = [];
    const fakeWorker = {
      postMessage(data: unknown) {
        messages.push(data);
      },
    } as unknown as ServiceWorker;

    showUpdateBanner({ getWaitingWorker: () => fakeWorker });
    const laterBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "#tau-mux-update-banner button",
      ),
    ).find((b) => b.textContent === "Later")!;
    laterBtn.click();
    expect(document.getElementById("tau-mux-update-banner")).toBeNull();
    expect(messages.length).toBe(0);
  });
});
