// Plan #03 §A — coverage for the notification overlay's pure
// composition logic + the DOM behaviour exposed via happy-dom.
//
// `composeStack` is pure data → trivially hermetic. The DOM tests
// exercise show / dismiss / overflow / hover-pause via the public
// `NotificationOverlay` class without spinning up the real webview.

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

async function loadOverlay() {
  return await import("../src/views/terminal/notification-overlay");
}

// ── pure compose ──────────────────────────────────────────────

describe("composeStack", () => {
  test("empty input returns empty + 0 overflow", async () => {
    const { composeStack } = await loadOverlay();
    expect(composeStack([])).toEqual({ visible: [], overflow: 0 });
  });

  test("under the cap → all visible, 0 overflow", async () => {
    const { composeStack } = await loadOverlay();
    expect(composeStack(["a", "b"], 3)).toEqual({
      visible: ["a", "b"],
      overflow: 0,
    });
  });

  test("at the cap → all visible, 0 overflow", async () => {
    const { composeStack } = await loadOverlay();
    expect(composeStack(["a", "b", "c"], 3)).toEqual({
      visible: ["a", "b", "c"],
      overflow: 0,
    });
  });

  test("over the cap → keeps the newest N, overflow counts the rest", async () => {
    const { composeStack } = await loadOverlay();
    expect(composeStack(["a", "b", "c", "d", "e"], 3)).toEqual({
      visible: ["c", "d", "e"],
      overflow: 2,
    });
  });

  test("respects the default cap (3) when max is omitted", async () => {
    const { composeStack } = await loadOverlay();
    const out = composeStack(["1", "2", "3", "4"]);
    expect(out.visible.length).toBe(3);
    expect(out.overflow).toBe(1);
  });
});

// ── DOM behaviour ─────────────────────────────────────────────

describe("NotificationOverlay (DOM)", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<div id="surface"></div>`;
    host = document.getElementById("surface") as HTMLElement;
  });

  test("show appends a card to the surface container", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    overlay.show(host, basePayload({ id: "n:1" }));
    const card = host.querySelector(".tau-notif-overlay-card");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".tau-notif-overlay-title")?.textContent).toBe(
      "test",
    );
  });

  test("show is a no-op when disabled", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    overlay.setOptions({ enabled: false });
    overlay.show(host, basePayload({ id: "n:1" }));
    expect(host.querySelector(".tau-notif-overlay-card")).toBeNull();
  });

  test("show is idempotent on duplicate ids", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    overlay.show(host, basePayload({ id: "n:1", title: "first" }));
    overlay.show(host, basePayload({ id: "n:1", title: "second" }));
    const cards = host.querySelectorAll(".tau-notif-overlay-card");
    expect(cards.length).toBe(1);
    // First-write-wins — duplicates don't overwrite the live card.
    expect(
      cards[0]!.querySelector(".tau-notif-overlay-title")?.textContent,
    ).toBe("first");
  });

  test("more than 3 overlays produce a +N more pill", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    for (let i = 0; i < 5; i++) {
      overlay.show(host, basePayload({ id: `n:${i}` }));
    }
    const cards = host.querySelectorAll(".tau-notif-overlay-card");
    expect(cards.length).toBe(3);
    const overflow = host.querySelector<HTMLElement>(
      ".tau-notif-overlay-overflow",
    );
    expect(overflow).not.toBeNull();
    expect(overflow!.textContent).toBe("+2 more");
  });

  test("dismiss removes the matching card and updates overflow", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    for (let i = 0; i < 4; i++) {
      overlay.show(host, basePayload({ id: `n:${i}` }));
    }
    expect(host.querySelector(".tau-notif-overlay-overflow")?.textContent).toBe(
      "+1 more",
    );
    overlay.dismiss("surface:1", "n:0"); // already in overflow — should drop it
    expect(host.querySelector(".tau-notif-overlay-overflow")).toBeNull();
    overlay.dismiss("surface:1", "n:1");
    expect(host.querySelectorAll(".tau-notif-overlay-card").length).toBe(2);
  });

  test("close button click fires onCardDismiss", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const dismissed: string[] = [];
    const overlay = new NotificationOverlay({
      ...noopHooks(),
      onCardDismiss: ({ id }) => dismissed.push(id),
    });
    overlay.show(host, basePayload({ id: "n:1" }));
    const close = host.querySelector<HTMLElement>(".tau-notif-overlay-close");
    close!.click();
    expect(dismissed).toEqual(["n:1"]);
  });

  test("body click fires onCardActivate, not onCardDismiss", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const events: string[] = [];
    const overlay = new NotificationOverlay({
      onCardActivate: ({ id }) => events.push(`activate:${id}`),
      onCardDismiss: ({ id }) => events.push(`dismiss:${id}`),
      onOverflowClick: () => events.push("overflow"),
    });
    overlay.show(host, basePayload({ id: "n:1" }));
    const card = host.querySelector<HTMLElement>(".tau-notif-overlay-card");
    card!.click();
    expect(events).toEqual(["activate:n:1"]);
  });

  test("overflow pill click fires onOverflowClick", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const events: string[] = [];
    const overlay = new NotificationOverlay({
      ...noopHooks(),
      onOverflowClick: () => events.push("overflow"),
    });
    for (let i = 0; i < 5; i++) {
      overlay.show(host, basePayload({ id: `n:${i}` }));
    }
    const pill = host.querySelector<HTMLElement>(".tau-notif-overlay-overflow");
    pill!.click();
    expect(events).toEqual(["overflow"]);
  });

  test("setOptions({enabled:false}) tears down every live card", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    overlay.show(host, basePayload({ id: "n:1" }));
    overlay.show(host, basePayload({ id: "n:2" }));
    expect(host.querySelectorAll(".tau-notif-overlay-card").length).toBe(2);
    overlay.setOptions({ enabled: false });
    expect(host.querySelectorAll(".tau-notif-overlay-card").length).toBe(0);
  });

  test("dismissAll drops every overlay across every surface", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    document.body.insertAdjacentHTML("beforeend", `<div id="surface2"></div>`);
    const host2 = document.getElementById("surface2") as HTMLElement;
    overlay.show(host, basePayload({ id: "n:1", surfaceId: "surface:1" }));
    overlay.show(host2, basePayload({ id: "n:2", surfaceId: "surface:2" }));
    expect(document.querySelectorAll(".tau-notif-overlay-card").length).toBe(2);
    overlay.dismissAll();
    expect(document.querySelectorAll(".tau-notif-overlay-card").length).toBe(0);
  });

  test("forgetSurface drops a single surface's stack root", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    overlay.show(host, basePayload({ id: "n:1", surfaceId: "surface:1" }));
    expect(host.querySelector(".tau-notif-overlay-stack")).not.toBeNull();
    overlay.forgetSurface("surface:1");
    expect(host.querySelector(".tau-notif-overlay-stack")).toBeNull();
  });

  test("auto-dismiss clears the card after its duration elapses", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const dismissed: string[] = [];
    const overlay = new NotificationOverlay({
      ...noopHooks(),
      onCardDismiss: ({ id }) => dismissed.push(id),
    });
    overlay.setOptions({ autoDismissMs: 30 });
    overlay.show(host, basePayload({ id: "n:1" }));
    await Bun.sleep(80);
    expect(dismissed).toContain("n:1");
  });

  test("autoDismissMs=0 leaves the card visible indefinitely", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const dismissed: string[] = [];
    const overlay = new NotificationOverlay({
      ...noopHooks(),
      onCardDismiss: ({ id }) => dismissed.push(id),
    });
    overlay.setOptions({ autoDismissMs: 0 });
    overlay.show(host, basePayload({ id: "n:1" }));
    await Bun.sleep(50);
    expect(dismissed).toEqual([]);
  });

  // I12 — destroy() must remove every card DOM node, cancel every
  // auto-dismiss timer, and stop responding to follow-up `show()` calls.
  test("destroy removes every card DOM node", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    overlay.show(host, basePayload({ id: "n:1" }));
    overlay.show(host, basePayload({ id: "n:2" }));
    expect(host.querySelectorAll(".tau-notif-overlay-card").length).toBe(2);
    overlay.destroy();
    expect(host.querySelectorAll(".tau-notif-overlay-card").length).toBe(0);
    expect(host.querySelector(".tau-notif-overlay-stack")).toBeNull();
  });

  test("destroy cancels pending auto-dismiss timers (no late dismiss)", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const dismissed: string[] = [];
    const overlay = new NotificationOverlay({
      ...noopHooks(),
      onCardDismiss: ({ id }) => dismissed.push(id),
    });
    overlay.setOptions({ autoDismissMs: 30 });
    overlay.show(host, basePayload({ id: "n:1" }));
    overlay.destroy();
    await Bun.sleep(80);
    // No card → no late dismiss callback should have fired.
    expect(dismissed).toEqual([]);
  });

  test("destroy ignores follow-up show calls", async () => {
    const { NotificationOverlay } = await loadOverlay();
    const overlay = new NotificationOverlay(noopHooks());
    overlay.destroy();
    overlay.show(host, basePayload({ id: "n:after" }));
    expect(host.querySelector(".tau-notif-overlay-card")).toBeNull();
  });
});

// ── helpers ───────────────────────────────────────────────────

function noopHooks(): Parameters<
  typeof import("../src/views/terminal/notification-overlay").NotificationOverlay extends new (
    h: infer H,
  ) => unknown
    ? unknown
    : never
> extends never
  ? never
  : never;
function noopHooks(): {
  onCardActivate: () => void;
  onCardDismiss: () => void;
  onOverflowClick: () => void;
} {
  return {
    onCardActivate: () => {},
    onCardDismiss: () => {},
    onOverflowClick: () => {},
  };
}

function basePayload(overrides: {
  id: string;
  title?: string;
  surfaceId?: string;
}): {
  id: string;
  surfaceId: string;
  title: string;
  body?: string;
  time: number;
} {
  return {
    id: overrides.id,
    surfaceId: overrides.surfaceId ?? "surface:1",
    title: overrides.title ?? "test",
    body: "body",
    time: Date.now(),
  };
}
