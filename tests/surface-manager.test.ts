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

// Stub xterm before SurfaceManager loads. The Terminal constructor
// inside createSurfaceView pulls in canvas / renderer code that
// happy-dom cannot serve; substituting a minimal stub lets us exercise
// the state transitions without wiring a real terminal.

interface StubTerm {
  cols: number;
  rows: number;
  open: ReturnType<typeof mock>;
  focus: ReturnType<typeof mock>;
  loadAddon: ReturnType<typeof mock>;
  onData: ReturnType<typeof mock>;
  onBinary: ReturnType<typeof mock>;
  onResize: ReturnType<typeof mock>;
  onScroll: ReturnType<typeof mock>;
  write: ReturnType<typeof mock>;
  dispose: ReturnType<typeof mock>;
  resize: ReturnType<typeof mock>;
  clear: ReturnType<typeof mock>;
  getSelection: ReturnType<typeof mock>;
  clearSelection: ReturnType<typeof mock>;
  selectAll: ReturnType<typeof mock>;
  hasSelection: ReturnType<typeof mock>;
  reset: ReturnType<typeof mock>;
  scrollToBottom: ReturnType<typeof mock>;
  buffer: {
    active: {
      baseY: number;
      cursorY: number;
      viewportY: number;
      length: number;
      getLine: ReturnType<typeof mock>;
    };
  };
  element: HTMLElement | null;
}

function makeStubTerm(): StubTerm {
  return {
    cols: 80,
    rows: 24,
    open: mock(() => {}),
    focus: mock(() => {}),
    loadAddon: mock(() => {}),
    onData: mock(() => ({ dispose: () => {} })),
    onBinary: mock(() => ({ dispose: () => {} })),
    onResize: mock(() => ({ dispose: () => {} })),
    onScroll: mock(() => ({ dispose: () => {} })),
    write: mock(() => {}),
    dispose: mock(() => {}),
    resize: mock(() => {}),
    clear: mock(() => {}),
    getSelection: mock(() => ""),
    clearSelection: mock(() => {}),
    selectAll: mock(() => {}),
    hasSelection: mock(() => false),
    reset: mock(() => {}),
    scrollToBottom: mock(() => {}),
    buffer: {
      active: {
        baseY: 0,
        cursorY: 0,
        viewportY: 0,
        length: 0,
        getLine: mock(() => null),
      },
    },
    element: null,
  };
}

const termInstances: StubTerm[] = [];

mock.module("xterm", () => ({
  Terminal: class {
    constructor() {
      const t = makeStubTerm();
      termInstances.push(t);
      Object.assign(this, t);
    }
  },
}));

mock.module("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = mock(() => {});
    proposeDimensions = mock(() => ({ cols: 80, rows: 24 }));
    activate = mock(() => {});
    dispose = mock(() => {});
  },
}));

mock.module("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate = mock(() => {});
    dispose = mock(() => {});
  },
}));

mock.module("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = mock(() => {});
    findPrevious = mock(() => {});
    clearDecorations = mock(() => {});
    activate = mock(() => {});
    dispose = mock(() => {});
  },
}));

async function loadSurfaceManager() {
  return await import("../src/views/terminal/surface-manager");
}

function mkContainers() {
  document.body.innerHTML = "";
  const terminalContainer = document.createElement("div");
  terminalContainer.id = "terminal-container";
  const sidebarContainer = document.createElement("div");
  sidebarContainer.id = "sidebar";
  document.body.appendChild(terminalContainer);
  document.body.appendChild(sidebarContainer);
  // happy-dom doesn't compute layout; stub offset dimensions so
  // applyLayout has something numeric to hand off to PaneLayout.
  Object.defineProperty(terminalContainer, "clientWidth", {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(terminalContainer, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(terminalContainer, "offsetWidth", {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(terminalContainer, "offsetHeight", {
    configurable: true,
    get: () => 600,
  });
  return { terminalContainer, sidebarContainer };
}

beforeEach(() => {
  termInstances.length = 0;
});

describe("SurfaceManager — workspace lifecycle", () => {
  test("addSurface creates a workspace and focuses the new surface", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    sm.addSurface("s1", "first");
    expect(sm.getActiveSurfaceId()).toBe("s1");
    expect(sm.getActiveSurfaceType()).toBe("terminal");
    expect(sm.getSurfaceTitle("s1")).toBe("first");
  });

  test("removeSurface on the only surface clears active id", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    sm.addSurface("s1", "first");
    sm.removeSurface("s1");
    expect(sm.getActiveSurfaceId()).toBeNull();
  });

  test("second addSurface creates a second workspace and switches to it", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    sm.addSurface("s1", "first");
    sm.addSurface("s2", "second");
    expect(sm.getActiveSurfaceId()).toBe("s2");
  });

  test("focusSurface changes the active surface id", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    sm.addSurface("s1", "first");
    sm.addSurface("s2", "second");
    // Switch back to workspace 1 then focus its surface.
    sm.focusWorkspaceByIndex(0);
    expect(sm.getActiveSurfaceId()).toBe("s1");
    sm.focusWorkspaceByIndex(1);
    expect(sm.getActiveSurfaceId()).toBe("s2");
  });

  test("focusSurface dispatches ht-surface-focused event", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    sm.addSurface("s1", "first");
    const spy = mock(() => {});
    window.addEventListener("ht-surface-focused", spy as EventListener);
    sm.focusSurface("s1");
    expect(spy).toHaveBeenCalled();
    window.removeEventListener("ht-surface-focused", spy as EventListener);
  });
});

describe("SurfaceManager — titles and metadata", () => {
  test("renameSurface updates getSurfaceTitle", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    sm.addSurface("s1", "first");
    sm.renameSurface("s1", "new title");
    expect(sm.getSurfaceTitle("s1")).toBe("new title");
  });

  test("getSurfaceTitle returns null for unknown id", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    expect(sm.getSurfaceTitle("nope")).toBeNull();
  });

  test("getActiveSurfaceType reports 'terminal' for a normal surface", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    sm.addSurface("s1", "first");
    expect(sm.getActiveSurfaceType()).toBe("terminal");
  });

  test("getActiveSurfaceType returns null before any surface is added", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    expect(sm.getActiveSurfaceType()).toBeNull();
  });
});

describe("SurfaceManager — sidebar toggle", () => {
  test("toggleSidebar flips visibility", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    const initial = sm.isSidebarVisible();
    sm.toggleSidebar();
    expect(sm.isSidebarVisible()).toBe(!initial);
  });

  test("setSidebarVisible is idempotent", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
    );
    sm.setSidebarVisible(true);
    sm.setSidebarVisible(true);
    expect(sm.isSidebarVisible()).toBe(true);
  });
});

describe("SurfaceManager — font size", () => {
  test("setFontSize / getFontSize roundtrip", async () => {
    const { SurfaceManager } = await loadSurfaceManager();
    const { terminalContainer, sidebarContainer } = mkContainers();
    const sm = new SurfaceManager(
      terminalContainer,
      sidebarContainer,
      () => {},
      () => {},
      () => {},
      13,
    );
    sm.setFontSize(16);
    expect(sm.getFontSize()).toBe(16);
  });
});
