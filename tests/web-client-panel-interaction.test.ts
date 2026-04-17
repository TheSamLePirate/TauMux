import {
  afterAll,
  beforeAll,
  beforeEach,
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

async function loadModule() {
  return await import("../src/web-client/panel-interaction");
}

function makePanel(opts: { width?: number; height?: number } = {}) {
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.left = "10px";
  el.style.top = "20px";
  el.style.width = `${opts.width ?? 200}px`;
  el.style.height = `${opts.height ?? 100}px`;
  document.body.appendChild(el);
  // happy-dom doesn't compute layout, so mock getBoundingClientRect.
  el.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      right: 10 + (opts.width ?? 200),
      bottom: 20 + (opts.height ?? 100),
      width: opts.width ?? 200,
      height: opts.height ?? 100,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(el, "offsetWidth", {
    configurable: true,
    get: () => opts.width ?? 200,
  });
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    get: () => opts.height ?? 100,
  });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("setupPanelMouse", () => {
  test("mousedown forwards panelMouseEvent with rect-relative x,y", async () => {
    const { setupPanelMouse } = await loadModule();
    const el = makePanel();
    const send = mock(() => {});
    setupPanelMouse(el, "pid", "sid", send);
    el.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 50,
        clientY: 60,
        button: 0,
        buttons: 1,
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    const [type, payload] = send.mock.calls[0]!;
    expect(type).toBe("panelMouseEvent");
    expect(payload).toMatchObject({
      surfaceId: "sid",
      id: "pid",
      event: "mousedown",
      x: 40,
      y: 40,
      button: 0,
      buttons: 1,
    });
  });

  test("mouseup reports buttons=0 regardless of native value", async () => {
    const { setupPanelMouse } = await loadModule();
    const el = makePanel();
    const send = mock(() => {});
    setupPanelMouse(el, "pid", "sid", send);
    el.dispatchEvent(
      new MouseEvent("mouseup", { clientX: 50, clientY: 60, buttons: 1 }),
    );
    expect(send.mock.calls[0]![1]).toMatchObject({
      event: "mouseup",
      buttons: 0,
    });
  });

  test("mousemove is throttled to ~60fps", async () => {
    const { setupPanelMouse } = await loadModule();
    const el = makePanel();
    const send = mock(() => {});
    setupPanelMouse(el, "pid", "sid", send);
    for (let i = 0; i < 10; i++) {
      el.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 50 + i, clientY: 60 }),
      );
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("click fires panelMouseEvent", async () => {
    const { setupPanelMouse } = await loadModule();
    const el = makePanel();
    const send = mock(() => {});
    setupPanelMouse(el, "pid", "sid", send);
    el.dispatchEvent(new MouseEvent("click", { clientX: 30, clientY: 40 }));
    expect(send.mock.calls[0]![1]).toMatchObject({
      event: "click",
      x: 20,
      y: 20,
    });
  });

  test("wheel event includes deltaX/deltaY", async () => {
    const { setupPanelMouse } = await loadModule();
    const el = makePanel();
    const send = mock(() => {});
    setupPanelMouse(el, "pid", "sid", send);
    // happy-dom's WheelEvent doesn't pick up clientX/clientY from init,
    // so dispatch a plain Event with the fields we assert on attached.
    const evt = new Event("wheel") as unknown as WheelEvent;
    Object.assign(evt, { clientX: 30, clientY: 40, deltaX: 5.7, deltaY: 9.2 });
    el.dispatchEvent(evt);
    expect(send.mock.calls[0]![1]).toMatchObject({
      event: "wheel",
      x: 20,
      y: 20,
      deltaX: 6,
      deltaY: 9,
    });
  });

  test("mouseenter/mouseleave propagate", async () => {
    const { setupPanelMouse } = await loadModule();
    const el = makePanel();
    const send = mock(() => {});
    setupPanelMouse(el, "pid", "sid", send);
    el.dispatchEvent(
      new MouseEvent("mouseenter", { clientX: 30, clientY: 40 }),
    );
    el.dispatchEvent(
      new MouseEvent("mouseleave", { clientX: 30, clientY: 40 }),
    );
    const events = send.mock.calls.map((c: any[]) => c[1].event);
    expect(events).toEqual(["mouseenter", "mouseleave"]);
  });
});

describe("setupPanelDrag", () => {
  test("dragging updates left/top, release emits dragend with final pos", async () => {
    const { setupPanelDrag } = await loadModule();
    const el = makePanel();
    const handle = document.createElement("div");
    el.appendChild(handle);
    const send = mock(() => {});
    setupPanelDrag(el, handle, "pid", "sid", send);

    handle.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 100, clientY: 100 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 150, clientY: 140 }),
    );
    expect(el.style.left).toBe("60px"); // 10 + (150 - 100)
    expect(el.style.top).toBe("60px"); // 20 + (140 - 100)

    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toMatchObject({
      event: "dragend",
      x: 60,
      y: 60,
    });
  });

  test("mouseup tears down document listeners", async () => {
    const { setupPanelDrag } = await loadModule();
    const el = makePanel();
    const handle = document.createElement("div");
    el.appendChild(handle);
    const send = mock(() => {});
    setupPanelDrag(el, handle, "pid", "sid", send);

    handle.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 0, clientY: 0 }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));

    // Further document moves should not update the element anymore.
    const beforeLeft = el.style.left;
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 999, clientY: 999 }),
    );
    expect(el.style.left).toBe(beforeLeft);
  });
});

describe("setupPanelResize", () => {
  test("dragging changes width/height respecting minimums", async () => {
    const { setupPanelResize } = await loadModule();
    const el = makePanel({ width: 200, height: 100 });
    const handle = document.createElement("div");
    el.appendChild(handle);
    const send = mock(() => {});
    setupPanelResize(el, handle, "pid", "sid", send);

    handle.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 100, clientY: 100 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 150, clientY: 120 }),
    );
    expect(el.style.width).toBe("250px"); // 200 + 50
    expect(el.style.height).toBe("120px"); // 100 + 20
  });

  test("minimum width 120 / height 72 is enforced", async () => {
    const { setupPanelResize } = await loadModule();
    const el = makePanel({ width: 150, height: 90 });
    const handle = document.createElement("div");
    el.appendChild(handle);
    const send = mock(() => {});
    setupPanelResize(el, handle, "pid", "sid", send);

    handle.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 200, clientY: 200 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 0, clientY: 0 }),
    );
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("72px");
  });

  test("mouseup emits resize event with final dims", async () => {
    const { setupPanelResize } = await loadModule();
    const el = makePanel({ width: 200, height: 100 });
    const handle = document.createElement("div");
    el.appendChild(handle);
    const send = mock(() => {});
    setupPanelResize(el, handle, "pid", "sid", send);

    handle.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 100, clientY: 100 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 150, clientY: 120 }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(send.mock.calls[0]![1]).toMatchObject({
      event: "resize",
    });
  });
});
