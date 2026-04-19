import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  mock,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function load() {
  return await import("../src/shared/sidebar-resize");
}

type MakePointerEventOpts = {
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel";
  clientX: number;
  pointerId?: number;
  pointerType?: string;
  button?: number;
};

function firePointer(handle: HTMLElement, opts: MakePointerEventOpts) {
  const init = {
    bubbles: true,
    cancelable: true,
    pointerId: opts.pointerId ?? 1,
    clientX: opts.clientX,
    button: opts.button ?? 0,
    pointerType: opts.pointerType ?? "mouse",
  };
  // happy-dom ships PointerEvent; happy-dom < x might fall back to MouseEvent.
  const Ctor =
    (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
    MouseEvent;
  const ev = new Ctor(opts.type, init);
  handle.dispatchEvent(ev);
}

function makeHandle(): HTMLElement {
  document.body.innerHTML = `<div id="handle"></div>`;
  const el = document.getElementById("handle") as HTMLElement;
  // setPointerCapture/releasePointerCapture are no-ops on happy-dom
  // detached nodes; patch them so the helper doesn't throw.
  (
    el as unknown as { setPointerCapture: (id: number) => void }
  ).setPointerCapture = () => {};
  (
    el as unknown as { releasePointerCapture: (id: number) => void }
  ).releasePointerCapture = () => {};
  return el;
}

describe("attachSidebarResize", () => {
  beforeEach(() => {
    // Make rAF synchronous so we can assert onLive was called without
    // awaiting repaint ticks.
    (
      globalThis as { requestAnimationFrame: (cb: () => void) => number }
    ).requestAnimationFrame = (cb) => {
      cb();
      return 1;
    };
    (
      globalThis as { cancelAnimationFrame: (id: number) => void }
    ).cancelAnimationFrame = () => {};
  });
  afterEach(() => {
    document.body.className = "";
  });

  test("pointer-move emits clamped width via onLive", async () => {
    const { attachSidebarResize } = await load();
    const onLive = mock((_: number) => {});
    const handle = makeHandle();
    attachSidebarResize({
      handle,
      min: 200,
      max: 600,
      defaultWidth: 320,
      getSidebarLeft: () => 0,
      onLive,
      onCommit: () => {},
    });

    firePointer(handle, { type: "pointerdown", clientX: 100 });

    // Moves land on the rAF cadence the helper installed. With our
    // synchronous rAF stub, each pointermove that follows a flush gets
    // its own onLive call; consecutive moves inside the same frame
    // coalesce to the latest value. Commit the drag so pending work
    // flushes deterministically and then assert on the collected set.
    firePointer(handle, { type: "pointermove", clientX: 150 }); // below min
    firePointer(handle, { type: "pointerup", clientX: 150 });
    firePointer(handle, { type: "pointerdown", clientX: 100 });
    firePointer(handle, { type: "pointermove", clientX: 350 });
    firePointer(handle, { type: "pointerup", clientX: 350 });
    firePointer(handle, { type: "pointerdown", clientX: 100 });
    firePointer(handle, { type: "pointermove", clientX: 9999 }); // above max
    firePointer(handle, { type: "pointerup", clientX: 9999 });

    const widths = onLive.mock.calls.map((c) => c[0]);
    expect(widths).toContain(200); // min clamp
    expect(widths).toContain(350); // mid-range
    expect(widths).toContain(600); // max clamp
  });

  test("pointer-up fires onCommit once with the final width", async () => {
    const { attachSidebarResize } = await load();
    const onCommit = mock((_: number) => {});
    const handle = makeHandle();
    attachSidebarResize({
      handle,
      min: 100,
      max: 500,
      defaultWidth: 300,
      getSidebarLeft: () => 0,
      onCommit,
    });

    firePointer(handle, { type: "pointerdown", clientX: 100 });
    firePointer(handle, { type: "pointermove", clientX: 280 });
    firePointer(handle, { type: "pointerup", clientX: 280 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(280);
  });

  test("sidebar-resizing class is toggled on body for the drag window", async () => {
    const { attachSidebarResize } = await load();
    const handle = makeHandle();
    attachSidebarResize({
      handle,
      min: 100,
      max: 500,
      defaultWidth: 300,
      getSidebarLeft: () => 0,
      onCommit: () => {},
    });

    firePointer(handle, { type: "pointerdown", clientX: 100 });
    expect(document.body.classList.contains("sidebar-resizing")).toBe(true);

    firePointer(handle, { type: "pointerup", clientX: 200 });
    expect(document.body.classList.contains("sidebar-resizing")).toBe(false);
  });

  test("double-click restores the default width via both callbacks", async () => {
    const { attachSidebarResize } = await load();
    const onLive = mock((_: number) => {});
    const onCommit = mock((_: number) => {});
    const handle = makeHandle();
    attachSidebarResize({
      handle,
      min: 100,
      max: 500,
      defaultWidth: 320,
      getSidebarLeft: () => 0,
      onLive,
      onCommit,
    });

    const ev = new MouseEvent("dblclick", { bubbles: true });
    handle.dispatchEvent(ev);

    expect(onLive).toHaveBeenCalledWith(320);
    expect(onCommit).toHaveBeenCalledWith(320);
  });

  test("getSidebarLeft is subtracted from clientX", async () => {
    const { attachSidebarResize } = await load();
    const onLive = mock((_: number) => {});
    const handle = makeHandle();
    attachSidebarResize({
      handle,
      min: 100,
      max: 500,
      defaultWidth: 300,
      // Simulate a window chrome frame that shifts the sidebar 8 px
      // right of the viewport edge.
      getSidebarLeft: () => 8,
      onLive,
      onCommit: () => {},
    });

    firePointer(handle, { type: "pointerdown", clientX: 100 });
    firePointer(handle, { type: "pointermove", clientX: 308 });
    expect(onLive).toHaveBeenLastCalledWith(300);
  });

  test("teardown removes listeners", async () => {
    const { attachSidebarResize } = await load();
    const onLive = mock((_: number) => {});
    const onCommit = mock((_: number) => {});
    const handle = makeHandle();
    const detach = attachSidebarResize({
      handle,
      min: 100,
      max: 500,
      defaultWidth: 300,
      getSidebarLeft: () => 0,
      onLive,
      onCommit,
    });

    detach();

    firePointer(handle, { type: "pointerdown", clientX: 100 });
    firePointer(handle, { type: "pointermove", clientX: 250 });
    firePointer(handle, { type: "pointerup", clientX: 250 });
    expect(onLive).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.body.classList.contains("sidebar-resizing")).toBe(false);
  });
});
