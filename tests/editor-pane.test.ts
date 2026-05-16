// Phase 3 Step 3 — Editor pane DOM-level tests.
//
// Lifts editor-pane.ts from "zero direct unit tests" (T1 in
// triple_a_analysis.md) to "lifecycle + snapshot apply + save state
// covered". CodeMirror itself runs under happy-dom; we don't assert
// its internals — we assert the pane's own surface (chips, status
// chrome, save/reload callbacks).

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { EditorFileSnapshot, EditorSaveResult } from "../src/shared/types";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = "";
});

async function load() {
  return await import("../src/views/terminal/editor-pane");
}

interface Spies {
  reads: { surfaceId: string; path: string; create?: boolean }[];
  saves: {
    surfaceId: string;
    path: string;
    content: string;
    expectedMtimeMs: number | null;
  }[];
  reloads: { surfaceId: string; path: string }[];
  closes: string[];
  focuses: string[];
  splits: { surfaceId: string; direction: "horizontal" | "vertical" }[];
}

function spies(): Spies {
  return {
    reads: [],
    saves: [],
    reloads: [],
    closes: [],
    focuses: [],
    splits: [],
  };
}

function callbacks(s: Spies) {
  return {
    onRead: (surfaceId: string, path: string, create?: boolean) => {
      s.reads.push({ surfaceId, path, create });
    },
    onSave: (
      surfaceId: string,
      path: string,
      content: string,
      expectedMtimeMs: number | null,
    ) => {
      s.saves.push({ surfaceId, path, content, expectedMtimeMs });
    },
    onReload: (surfaceId: string, path: string) => {
      s.reloads.push({ surfaceId, path });
    },
    onClose: (surfaceId: string) => {
      s.closes.push(surfaceId);
    },
    onFocus: (surfaceId: string) => {
      s.focuses.push(surfaceId);
    },
    onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => {
      s.splits.push({ surfaceId, direction });
    },
  };
}

function tsSnapshot(
  surfaceId: string,
  overrides: Partial<EditorFileSnapshot> = {},
): EditorFileSnapshot {
  return {
    surfaceId,
    path: "/tmp/example.ts",
    content: "const a: number = 1;\n",
    exists: true,
    size: 22,
    mtimeMs: 1_000_000,
    language: "typescript",
    ...overrides,
  };
}

describe("Editor pane — construction", () => {
  test("mounts a hidden surface container with the right data attributes", async () => {
    const ed = await load();
    const s = spies();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/foo.ts",
      callbacks(s),
    );
    expect(view.surfaceType).toBe("editor");
    expect(view.id).toBe("editor:1");
    expect(view.container.dataset["surfaceId"]).toBe("editor:1");
    expect(view.container.dataset["surfaceType"]).toBe("editor");
    expect(view.container.style.display).toBe("none");
    expect(view.titleEl.textContent).toBe("foo.ts");
    expect(view.titleEl.title).toBe("/tmp/foo.ts");
  });

  test('titleEl falls back to "Editor" when no initial path', async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:noopath",
      undefined,
      callbacks(spies()),
    );
    // titleEl.textContent comes from `basename(path) ?? "Editor"`; the
    // title attribute is "No file open" once `renderEmptyState` runs
    // (the constructor calls it when there's no initial path).
    expect(view.titleEl.textContent).toBe("Editor");
    expect(view.titleEl.title).toBe("No file open");
    expect(view.pathPillEl.textContent).toBe("no file");
    expect(view.path).toBe(null);
  });

  test("dirty pill starts hidden", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/a.ts",
      callbacks(spies()),
    );
    expect(view.dirtyPillEl.classList.contains("hidden")).toBe(true);
    expect(view.dirty).toBe(false);
  });
});

describe("Editor pane — apply snapshot", () => {
  test("ignores snapshots for a different surface", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/a.ts",
      callbacks(spies()),
    );
    const before = {
      path: view.path,
      language: view.language,
      mtimeMs: view.mtimeMs,
      fileSize: view.fileSize,
    };
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:OTHER"));
    expect(view.path).toBe(before.path);
    expect(view.language).toBe(before.language);
    expect(view.mtimeMs).toBe(before.mtimeMs);
    expect(view.fileSize).toBe(before.fileSize);
  });

  test("loads a TypeScript snapshot and updates pane metadata", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/example.ts",
      callbacks(spies()),
    );
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    expect(view.path).toBe("/tmp/example.ts");
    expect(view.language).toBe("typescript");
    expect(view.mtimeMs).toBe(1_000_000);
    expect(view.fileSize).toBe(22);
    expect(view.lineEnding).toBe("LF");
    expect(view.dirty).toBe(false);
    expect(view.editor).not.toBeNull();
    // The save-state chip flips to "saved" / "loaded" on a loaded snapshot.
    expect(view.saveStateEl.textContent).toBe("loaded");
  });

  test('snapshot for a new (non-existing) file shows "idle" / "new"', async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/new.ts",
      callbacks(spies()),
    );
    ed.editorPaneApplySnapshot(
      view,
      tsSnapshot("editor:1", {
        exists: false,
        content: "",
        size: 0,
        mtimeMs: null,
      }),
    );
    expect(view.saveStateEl.textContent).toBe("new");
    expect(view.mtimeMs).toBe(null);
  });

  test("snapshot with error renders an error state instead of an editor", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/a.ts",
      callbacks(spies()),
    );
    ed.editorPaneApplySnapshot(
      view,
      tsSnapshot("editor:1", { error: "EACCES" }),
    );
    expect(view.editor).toBeNull();
    // The error message should be rendered into the host element.
    const text = view.editorHostEl.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("Editor pane — save / reload callbacks", () => {
  test("saveEditor() invokes onSave with the current path + content + mtime", async () => {
    const ed = await load();
    const s = spies();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/example.ts",
      callbacks(s),
    );
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    ed.saveEditor(view);
    expect(s.saves.length).toBe(1);
    expect(s.saves[0].surfaceId).toBe("editor:1");
    expect(s.saves[0].path).toBe("/tmp/example.ts");
    expect(s.saves[0].expectedMtimeMs).toBe(1_000_000);
    expect(s.saves[0].content).toBe("const a: number = 1;\n");
  });

  test("reloadEditor() invokes onReload with the current path", async () => {
    const ed = await load();
    const s = spies();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/example.ts",
      callbacks(s),
    );
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    ed.reloadEditor(view);
    expect(s.reloads.length).toBe(1);
    expect(s.reloads[0].surfaceId).toBe("editor:1");
    expect(s.reloads[0].path).toBe("/tmp/example.ts");
  });

  test("save without a path is a no-op", async () => {
    const ed = await load();
    const s = spies();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(s));
    ed.saveEditor(view);
    expect(s.saves).toEqual([]);
  });
});

describe("Editor pane — apply save result", () => {
  test("a successful save flips dirty to false and updates mtime", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/example.ts",
      callbacks(spies()),
    );
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));

    const result: EditorSaveResult = {
      surfaceId: "editor:1",
      path: "/tmp/example.ts",
      ok: true,
      mtimeMs: 2_000_000,
      size: 30,
    };
    ed.editorPaneApplySaveResult(view, result);
    expect(view.mtimeMs).toBe(2_000_000);
    expect(view.fileSize).toBe(30);
    expect(view.dirty).toBe(false);
  });

  test("a save result for a different surface is ignored", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:1",
      "/tmp/example.ts",
      callbacks(spies()),
    );
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    const original = view.mtimeMs;
    ed.editorPaneApplySaveResult(view, {
      surfaceId: "editor:OTHER",
      path: "/tmp/example.ts",
      ok: true,
      mtimeMs: 9_999_999,
      size: 9999,
    });
    expect(view.mtimeMs).toBe(original);
  });
});

describe("Editor pane — destroy", () => {
  test("destroyEditorPaneView() is safe to call when no editor is loaded", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:1",
      undefined,
      callbacks(spies()),
    );
    expect(() => ed.destroyEditorPaneView(view)).not.toThrow();
  });

  test("destroyEditorPaneView() runs every registered _cleanup hook", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView(
      "editor:1",
      undefined,
      callbacks(spies()),
    );
    let cleaned = 0;
    view._cleanup.push(() => {
      cleaned++;
    });
    view._cleanup.push(() => {
      cleaned++;
    });
    ed.destroyEditorPaneView(view);
    expect(cleaned).toBe(2);
  });
});
