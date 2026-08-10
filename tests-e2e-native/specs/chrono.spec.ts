import { test, expect, requireTier2 } from "../fixtures";
import type { AppFixture } from "../fixtures";
import { sleep } from "../helpers/wait";

/**
 * CHRONO — the ⌘G time field, driven in the real app.
 *
 * The unit tests prove the lease and the anchor maths in isolation. What
 * they cannot prove is the thing that actually matters: that a *live*
 * `.surface-container`, with a real xterm and a real PTY behind it, goes
 * into a lane and comes back — laid out, fitted, and still typed into —
 * on every path out of the view.
 *
 * So these specs are about the handover rather than about pixels: open,
 * confirm the panes moved, close, confirm they went home and still work.
 */

/**
 * CHRONO is the Atlas variant's ⌘G, so every spec here needs it.
 *
 * Waits for the column to actually be mounted rather than guessing at a
 * duration: ⌘G falls through to a no-op until the panel exists, and a
 * spec that raced it failed five seconds later somewhere unrelated.
 */
async function enterAtlas(app: AppFixture): Promise<void> {
  await app.rpc.ui.setSettingsField("layoutVariant", "atlas");
  await expect
    .poll(async () => (await app.rpc.ui.readChrono()).atlasReady, {
      timeout: 5_000,
    })
    .toBe(true);
}

async function openChrono(app: AppFixture): Promise<void> {
  await app.rpc.ui.keydown({ key: "g", meta: true });
  // Wait for the field to have *rendered*, not merely to exist. The
  // overlay is in the DOM synchronously and paints on the next frame, so
  // polling `open` alone catches a state with no lanes in it — which is
  // real, brief, and not what any of these specs mean by "open".
  await expect
    .poll(
      async () => {
        const state = await app.rpc.ui.readChrono();
        return state.open && state.lanes > 0;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  // One more frame for the second, measured layout pass to settle.
  await sleep(400);
}

async function expectClosed(app: AppFixture): Promise<void> {
  await expect
    .poll(async () => (await app.rpc.ui.readChrono()).open, { timeout: 5_000 })
    .toBe(false);
}

test.describe("chrono", () => {
  test.beforeEach(async ({ app }) => {
    requireTier2(app);
    await enterAtlas(app);
  });

  test("⌘G opens the field and borrows every live pane", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(700);

    const before = await app.rpc.ui.readChrono();
    expect(before.open).toBe(false);
    expect(before.homePanes).toBeGreaterThanOrEqual(2);

    await openChrono(app);

    const during = await app.rpc.ui.readChrono();
    // The heads are the panes themselves, not a copy of them.
    expect(during.leased).toBe(before.homePanes);
    expect(during.homePanes).toBe(0);
    expect(during.lanes).toBeGreaterThanOrEqual(2);
    // Present in the DOM at zero pixels would pass a naive count.
    expect(during.minLaneHeight).toBeGreaterThan(60);
  });

  test("Escape gives every pane back where it was found", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(700);
    const before = await app.rpc.ui.readChrono();

    await openChrono(app);
    await app.rpc.ui.keydown({ key: "Escape" });
    await expectClosed(app);
    await sleep(500);

    const after = await app.rpc.ui.readChrono();
    expect(after.homePanes).toBe(before.homePanes);
    expect(after.leased).toBe(0);
    // A pane that came home 0 px wide is the failure the lease exists to
    // stop, and it is invisible to a count.
    expect(after.minHomeWidth).toBeGreaterThan(40);
  });

  test("⌘G closes it again, and the terminal still takes input", async ({
    app,
  }) => {
    const surfaces = await app.rpc.surface.list();
    const id = surfaces[0]?.id;
    expect(id).toBeTruthy();

    await openChrono(app);
    await app.rpc.ui.keydown({ key: "g", meta: true });
    await expectClosed(app);

    await app.rpc.surface.send_text({
      surface_id: id!,
      text: "echo chrono-round-trip\n",
    });
    await expect
      .poll(
        async () => {
          const screen = await app.rpc.surface.read_text({
            surface_id: id!,
          });
          return screen.includes("chrono-round-trip");
        },
        { timeout: 6_000 },
      )
      .toBe(true);
  });

  test("a pane closed while borrowed does not strand the others", async ({
    app,
  }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(700);
    const surfaces = await app.rpc.surface.list();
    const victim = surfaces[surfaces.length - 1]?.id;
    expect(victim).toBeTruthy();

    await openChrono(app);
    await app.rpc.surface.close({ surface_id: victim! });
    await sleep(800);

    // Closing a pane makes SurfaceManager focus its neighbour, which
    // lands inside a lane head. CHRONO must not read that as "the user
    // is typing in here now" and hand Escape to the terminal.
    await app.rpc.ui.keydown({ key: "Escape" });
    await expectClosed(app);
    await sleep(500);

    // The survivors are home and sized; the closed one is not resurrected.
    const after = await app.rpc.ui.readChrono();
    expect(after.homePanes).toBe(surfaces.length - 1);
    expect(after.minHomeWidth).toBeGreaterThan(40);
  });

  test("a terminal pane's head is the live screen, not a card", async ({
    app,
  }) => {
    await openChrono(app);
    const state = await app.rpc.ui.readChrono();
    expect(state.headKinds).toContain("screen");
    await app.rpc.ui.keydown({ key: "Escape" });
    await expectClosed(app);
  });

  test("↑ and ↓ walk the lanes and keep the keyboard", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(700);
    await openChrono(app);

    // CHRONO opens on the focused pane, which is the one the split just
    // created — the last lane. So ↑ is the move that has somewhere to go.
    const first = (await app.rpc.ui.readChrono()).selectedLane;
    expect(first).toBeTruthy();

    await app.rpc.ui.keydown({ key: "ArrowUp" });
    await expect
      .poll(async () => (await app.rpc.ui.readChrono()).selectedLane, {
        timeout: 3_000,
      })
      .not.toBe(first);

    // Arrow navigation selects; it must not step *into* the pane, or
    // Escape would silently stop closing the view.
    expect((await app.rpc.ui.readChrono()).entered).toBe(false);

    await app.rpc.ui.keydown({ key: "ArrowDown" });
    await expect
      .poll(async () => (await app.rpc.ui.readChrono()).selectedLane, {
        timeout: 3_000,
      })
      .toBe(first);

    // …and the ends clamp rather than wrapping: a field you can fall off
    // the bottom of is a field you lose your place in.
    await app.rpc.ui.keydown({ key: "ArrowDown" });
    await sleep(250);
    expect((await app.rpc.ui.readChrono()).selectedLane).toBe(first);

    await app.rpc.ui.keydown({ key: "Escape" });
    await expectClosed(app);
  });

  test("Enter goes to the selected pane and closes", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(700);
    await openChrono(app);

    await app.rpc.ui.keydown({ key: "ArrowUp" });
    await sleep(300);
    const target = (await app.rpc.ui.readChrono()).selectedLane;
    expect(target).toBeTruthy();

    await app.rpc.ui.keydown({ key: "Enter" });
    await expectClosed(app);
    await sleep(400);

    // Going to the pane is the whole point of Enter — landing back on
    // the old one would make the key a no-op with extra steps.
    await expect
      .poll(async () => (await app.rpc.ui.readState()).focusedSurfaceId, {
        timeout: 3_000,
      })
      .toBe(target);
  });

  test("a browser pane stands by instead of being reparented", async ({
    app,
  }) => {
    await app.rpc.browser.open({ url: "about:blank" });
    await sleep(2_000);

    await openChrono(app);
    const state = await app.rpc.ui.readChrono();
    // A native webview survives neither reparenting nor clipping, so its
    // lane renders a card and its container stays put.
    expect(state.headKinds).toContain("standby");
    expect(state.leased).toBeLessThan(state.lanes);

    await app.rpc.ui.keydown({ key: "Escape" });
    await expectClosed(app);
  });
});
