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

// ── File-pane content kinds ────────────────────────────────────────
//
// The pane is no longer only an editor: a clicked `.png` in terminal
// output opens here too. These pin the three renderers apart, since
// picking the wrong one is immediately visible to the user (a
// broken-image icon, or "binary files cannot be edited" on a picture).

const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function imageSnapshot(
  surfaceId: string,
  overrides: Partial<EditorFileSnapshot> = {},
): EditorFileSnapshot {
  return {
    surfaceId,
    path: "/tmp/shot.png",
    content: "",
    exists: true,
    size: 4096,
    mtimeMs: 1_000_000,
    kind: "image",
    imageMime: "image/png",
    imageDataUri: PNG_DATA_URI,
    ...overrides,
  };
}

describe("Editor pane — images", () => {
  test("renders an <img> from the data URI instead of CodeMirror", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, imageSnapshot("editor:1"));
    const img = view.editorHostEl.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(PNG_DATA_URI);
    expect(view.editor).toBeNull();
    expect(view.contentKind).toBe("image");
  });

  test("starts fitted to the pane", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, imageSnapshot("editor:1"));
    expect(view.image?.zoom).toBeNull();
    expect(view.editorHostEl.querySelector("img")!.classList.contains("fit")).toBe(true);
  });

  test("1:1 leaves fit mode; Fit returns to it", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, imageSnapshot("editor:1"));
    const btn = (label: string) =>
      [...view.editorHostEl.querySelectorAll("button")].find(
        (b) => b.textContent === label,
      )!;
    btn("1:1").click();
    expect(view.image?.zoom).toBe(1);
    btn("Fit").click();
    expect(view.image?.zoom).toBeNull();
  });

  test("zoom steps are discrete and bounded at both ends", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, imageSnapshot("editor:1"));
    const btn = (label: string) =>
      [...view.editorHostEl.querySelectorAll("button")].find(
        (b) => b.textContent === label,
      )!;
    // Zooming out from "fit" anchors at 1:1 and steps down from there.
    btn("−").click();
    expect(view.image!.zoom).toBeLessThan(1);
    for (let i = 0; i < 20; i++) btn("−").click();
    expect(view.image!.zoom).toBe(0.1);
    for (let i = 0; i < 40; i++) btn("+").click();
    expect(view.image!.zoom).toBe(8);
  });

  test("an image can never be saved — there is no buffer to write", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, imageSnapshot("editor:1"));
    expect(view.saveBtn.disabled).toBe(true);
    // ...but reloading from disk still makes sense.
    expect(view.reloadBtn.disabled).toBe(false);
  });

  test("switching from an image back to text tears the viewer down", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, imageSnapshot("editor:1"));
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    expect(view.editorHostEl.querySelector("img")).toBeNull();
    expect(view.image).toBeNull();
    expect(view.contentKind).toBe("text");
    expect(view.editor).not.toBeNull();
  });
});

describe("Editor pane — SVG", () => {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>";
  const svgSnapshot = (surfaceId: string): EditorFileSnapshot => ({
    surfaceId,
    path: "/tmp/logo.svg",
    content: svg,
    exists: true,
    size: svg.length,
    mtimeMs: 1,
    kind: "svg",
    language: "html",
  });

  test("shows the picture first, inside a sandboxed iframe", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, svgSnapshot("editor:1"));
    expect(view.svgShowingSource).toBe(false);
    const frame = view.editorHostEl.querySelector("iframe");
    expect(frame).not.toBeNull();
    // The fd4 rule: no scripts, no same-origin. An SVG is an executable
    // document and this one came from terminal output.
    const sandbox = frame!.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  test("the toggle flips to an editable source view and back", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, svgSnapshot("editor:1"));
    expect(view.svgToggleBtn.classList.contains("hidden")).toBe(false);

    ed.toggleSvgSource(view);
    expect(view.svgShowingSource).toBe(true);
    expect(view.editor).not.toBeNull();
    expect(view.svgToggleBtn.textContent).toBe("Preview");

    ed.toggleSvgSource(view);
    expect(view.svgShowingSource).toBe(false);
    expect(view.editorHostEl.querySelector("iframe")).not.toBeNull();
    expect(view.svgToggleBtn.textContent).toBe("Source");
  });

  test("the toggle is hidden for non-SVG content", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    expect(view.svgToggleBtn.classList.contains("hidden")).toBe(true);
  });
});

describe("Editor pane — reveal position", () => {
  const doc = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");

  test("a snapshot carrying a line parks the cursor there", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(
      view,
      tsSnapshot("editor:1", { content: doc, revealLine: 12 }),
    );
    const state = view.editor!.state;
    expect(state.doc.lineAt(state.selection.main.head).number).toBe(12);
  });

  test("line + column lands on the column", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(
      view,
      tsSnapshot("editor:1", { content: doc, revealLine: 3, revealColumn: 4 }),
    );
    const state = view.editor!.state;
    const line = state.doc.lineAt(state.selection.main.head);
    expect(line.number).toBe(3);
    expect(state.selection.main.head - line.from).toBe(3);
  });

  test("a line past the end clamps instead of throwing", async () => {
    // Terminal output goes stale: a trace can name a line in a file
    // that has since shrunk. Opening it is still the right outcome.
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    expect(() =>
      ed.editorPaneApplySnapshot(
        view,
        tsSnapshot("editor:1", { content: doc, revealLine: 9999 }),
      ),
    ).not.toThrow();
    const state = view.editor!.state;
    expect(state.doc.lineAt(state.selection.main.head).number).toBe(40);
  });

  test("revealPosition() jumps an already-open document without re-reading", async () => {
    const ed = await load();
    const s = spies();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(s));
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1", { content: doc }));
    const before = s.reads.length;
    ed.revealPosition(view, 30, null);
    expect(view.editor!.state.doc.lineAt(view.editor!.state.selection.main.head).number).toBe(30);
    expect(s.reads.length).toBe(before);
  });

  test("no line means no jump — the document opens at the top", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1", { content: doc }));
    const state = view.editor!.state;
    expect(state.doc.lineAt(state.selection.main.head).number).toBe(1);
  });
});

// ── Closing / reloading with unsaved changes ───────────────────────
//
// These used to call the DOM `confirm()`. Inside the Electrobun webview
// that modal never opens and the call returns false, so closing a dirty
// pane silently did nothing — the pane was unclosable until saved.

function barButton(view: { container: HTMLElement }, label: string) {
  return [...view.container.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label,
  )!;
}

function dialog() {
  return document.querySelector(".prompt-overlay");
}

function dialogButton(label: string) {
  return [...document.querySelectorAll(".prompt-overlay button")].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement | undefined;
}

describe("Editor pane — unsaved-changes guard", () => {
  async function dirtyEditor() {
    const ed = await load();
    const s = spies();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(s));
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    view.editor!.dispatch({
      changes: { from: 0, insert: "// edited\n" },
    });
    expect(view.dirty).toBe(true);
    return { ed, s, view };
  }

  test("a clean pane closes immediately, with no dialog", async () => {
    const ed = await load();
    const s = spies();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(s));
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    barButton(view, "Close").click();
    expect(s.closes).toEqual(["editor:1"]);
    expect(dialog()).toBeNull();
  });

  test("a dirty pane asks first instead of closing", async () => {
    const { s, view } = await dirtyEditor();
    barButton(view, "Close").click();
    expect(dialog()).not.toBeNull();
    expect(document.querySelector(".prompt-title")!.textContent).toBe(
      "File not saved",
    );
    expect(s.closes).toEqual([]);
  });

  test("confirming discards and closes", async () => {
    const { s, view } = await dirtyEditor();
    barButton(view, "Close").click();
    dialogButton("Discard and close")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.closes).toEqual(["editor:1"]);
  });

  test("cancelling keeps the pane and its edits", async () => {
    const { s, view } = await dirtyEditor();
    barButton(view, "Close").click();
    dialogButton("Keep editing")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.closes).toEqual([]);
    expect(view.dirty).toBe(true);
  });

  test("reload asks too, and only reloads on confirm", async () => {
    const { s, view } = await dirtyEditor();
    barButton(view, "Reload from disk").click();
    expect(dialog()).not.toBeNull();
    expect(s.reloads).toEqual([]);
    dialogButton("Discard and reload")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.reloads).toEqual([
      { surfaceId: "editor:1", path: "/tmp/example.ts" },
    ]);
  });

  test("a clean pane reloads without asking", async () => {
    const ed = await load();
    const s = spies();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(s));
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    barButton(view, "Reload from disk").click();
    expect(dialog()).toBeNull();
    expect(s.reloads).toHaveLength(1);
  });
});

// ── HTML: source and rendered page are both wanted ─────────────────
//
// Neither reading wins by default — the pane opens the source and
// offers Preview, and ⌘-clicking the terminal link goes straight to a
// browser pane. The button matters because a modifier nobody knows
// about is not a feature.

const htmlSnapshot = (
  surfaceId: string,
  path = "/tmp/report/index.html",
): EditorFileSnapshot => ({
  surfaceId,
  path,
  content: "<!doctype html><title>hi</title>",
  exists: true,
  size: 32,
  mtimeMs: 1,
  kind: "text",
  language: "html",
});

describe("Editor pane — HTML preview", () => {
  test("an HTML file still opens as editable source", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, htmlSnapshot("editor:1"));
    expect(view.editor).not.toBeNull();
    expect(view.contentKind).toBe("text");
  });

  test("the Preview button appears for HTML", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, htmlSnapshot("editor:1"));
    expect(view.previewBtn.classList.contains("hidden")).toBe(false);
  });

  test("and stays hidden for anything else", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    expect(view.previewBtn.classList.contains("hidden")).toBe(true);
    ed.editorPaneApplySnapshot(view, imageSnapshot("editor:1"));
    expect(view.previewBtn.classList.contains("hidden")).toBe(true);
  });

  test("a file that does not exist yet cannot be previewed", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, {
      ...htmlSnapshot("editor:1"),
      exists: false,
      content: "",
    });
    expect(view.previewBtn.classList.contains("hidden")).toBe(true);
  });

  test("clicking Preview asks for a browser pane on the resolved path", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, htmlSnapshot("editor:1"));
    const seen: unknown[] = [];
    const onEvent = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("ht-open-file-in-browser", onEvent);
    view.previewBtn.click();
    window.removeEventListener("ht-open-file-in-browser", onEvent);
    expect(seen).toEqual([{ path: "/tmp/report/index.html" }]);
  });

  test("switching from HTML to another file hides the button again", async () => {
    const ed = await load();
    const view = ed.createEditorPaneView("editor:1", undefined, callbacks(spies()));
    ed.editorPaneApplySnapshot(view, htmlSnapshot("editor:1"));
    ed.editorPaneApplySnapshot(view, tsSnapshot("editor:1"));
    expect(view.previewBtn.classList.contains("hidden")).toBe(true);
  });
});
