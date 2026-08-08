import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import type {
  EditorContentKind,
  EditorFileSnapshot,
  EditorSaveResult,
} from "../../shared/types";
import { renderSandboxedMarkup } from "../../shared/sideband-sandbox";
import { isPreviewablePath } from "../../shared/file-kind";
import { htEvents } from "../../shared/event-bus";
import { createIcon, type IconName } from "./icons";
import { showConfirmDialog } from "./prompt-dialog";

export interface EditorPaneCallbacks {
  onRead: (surfaceId: string, path: string, create?: boolean) => void;
  onSave: (
    surfaceId: string,
    path: string,
    content: string,
    expectedMtimeMs: number | null,
  ) => void;
  onReload: (surfaceId: string, path: string) => void;
  onClose: (surfaceId: string) => void;
  onFocus: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: "horizontal" | "vertical") => void;
}

export interface EditorPaneViewRef {
  id: string;
  surfaceType: "editor";
  container: HTMLDivElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
  path: string | null;
  contentEl: HTMLDivElement;
  editorHostEl: HTMLDivElement;
  statusEl: HTMLDivElement;
  dirtyPillEl: HTMLSpanElement;
  pathPillEl: HTMLSpanElement;
  saveStateEl: HTMLSpanElement;
  saveBtn: HTMLButtonElement;
  reloadBtn: HTMLButtonElement;
  /** Picture ⇄ source flip. Hidden unless the pane holds an SVG. */
  svgToggleBtn: HTMLButtonElement;
  /** Open the file in a browser pane. Hidden unless it is previewable
   *  (HTML), where source and rendered page are both wanted often
   *  enough that neither can be the only option. */
  previewBtn: HTMLButtonElement;
  editor: EditorView | null;
  mtimeMs: number | null;
  dirty: boolean;
  language: string;
  fileSize: number;
  lineEnding: "LF" | "CRLF" | "mixed" | "none";
  callbacks: EditorPaneCallbacks;
  /** What the pane is currently showing. A pane is only "an editor"
   *  when this is `text`; for `image` there is nothing to save, and for
   *  `svg` it depends on which of the two views is active. */
  contentKind: EditorContentKind;
  /** Image-view state, null unless `contentKind === "image"`. `zoom`
   *  of null means fit-to-pane; a number is a multiplier on natural
   *  size. */
  image: { dataUri: string; mime: string; zoom: number | null } | null;
  /** SVG panes start on the picture and can flip to the source. */
  svgShowingSource: boolean;
  /** Last text loaded from disk. Kept so the SVG preview can re-render
   *  from the *edited* buffer when the user flips back from source. */
  sourceText: string;
  _cleanup: (() => void)[];
}

/** Zoom stops for the image viewer. Discrete rather than continuous so
 *  the buttons are predictable and 1:1 is always reachable exactly. */
const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8] as const;

function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return idx === 0 ? "/" : "";
  return trimmed.slice(0, idx);
}

function makeActionBtn(
  label: string,
  icon: IconName,
  action: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "surface-bar-action";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.append(createIcon(icon, "", 13));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    action();
  });
  return btn;
}

function languageExtension(lang?: string) {
  switch (lang) {
    case "typescript":
      return javascript({ typescript: true, jsx: true });
    case "javascript":
      return javascript({ jsx: true });
    case "json":
      return json();
    case "css":
      return css();
    case "html":
      return html();
    case "markdown":
      return markdown();
    default:
      return [];
  }
}

function detectLineEnding(text: string): EditorPaneViewRef["lineEnding"] {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf > 0 && lf > 0) return "mixed";
  if (crlf > 0) return "CRLF";
  if (lf > 0) return "LF";
  return "none";
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}K`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}M`;
}

export function createEditorPaneView(
  surfaceId: string,
  initialPath: string | undefined,
  callbacks: EditorPaneCallbacks,
): EditorPaneViewRef {
  const container = document.createElement("div");
  container.className = "surface-container surface-editor";
  container.dataset["surfaceId"] = surfaceId;
  container.dataset["surfaceType"] = "editor";
  container.style.display = "none";

  const bar = document.createElement("div");
  bar.className = "surface-bar";
  const titleWrap = document.createElement("div");
  titleWrap.className = "surface-bar-title-wrap";
  titleWrap.appendChild(createIcon("code", "surface-bar-icon", 12));
  const titleEl = document.createElement("span");
  titleEl.className = "surface-bar-title";
  titleEl.textContent = initialPath ? basename(initialPath) : "Editor";
  titleEl.title = initialPath ?? "Editor";
  titleWrap.appendChild(titleEl);
  bar.appendChild(titleWrap);

  const chipsEl = document.createElement("div");
  chipsEl.className = "surface-bar-chips editor-chips";
  const dirtyPillEl = document.createElement("span");
  dirtyPillEl.className = "surface-chip editor-dirty-chip hidden";
  dirtyPillEl.textContent = "modified";
  chipsEl.appendChild(dirtyPillEl);
  const pathPillEl = document.createElement("span");
  pathPillEl.className = "surface-chip editor-path-chip";
  pathPillEl.textContent = initialPath ? dirname(initialPath) : "no file";
  pathPillEl.title = initialPath ?? "No file open";
  chipsEl.appendChild(pathPillEl);
  const saveStateEl = document.createElement("span");
  saveStateEl.className = "surface-chip editor-save-state";
  saveStateEl.textContent = "idle";
  chipsEl.appendChild(saveStateEl);
  bar.appendChild(chipsEl);

  const actions = document.createElement("div");
  actions.className = "surface-bar-actions";
  const saveBtn = makeActionBtn("Save (⌘S)", "check", () => saveEditor(view));
  const reloadBtn = makeActionBtn("Reload from disk", "reload", () =>
    reloadEditor(view),
  );
  // Text label rather than an icon: "Source" / "Preview" names the
  // destination, and no glyph conveys that unambiguously.
  const svgToggleBtn = document.createElement("button");
  svgToggleBtn.type = "button";
  svgToggleBtn.className = "surface-bar-action editor-svg-toggle hidden";
  svgToggleBtn.textContent = "Source";
  svgToggleBtn.title = "Edit the SVG source";
  svgToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSvgSource(view);
  });
  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "surface-bar-action editor-svg-toggle hidden";
  previewBtn.textContent = "Preview";
  previewBtn.title = "Open this file in a browser pane";
  previewBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (view.path)
      htEvents.emit("ht-open-file-in-browser", { path: view.path });
  });
  actions.append(
    previewBtn,
    svgToggleBtn,
    saveBtn,
    reloadBtn,
    makeActionBtn("Split Right", "splitHorizontal", () =>
      callbacks.onSplit(surfaceId, "horizontal"),
    ),
    makeActionBtn("Split Down", "splitVertical", () =>
      callbacks.onSplit(surfaceId, "vertical"),
    ),
    makeActionBtn("Close", "close", () => requestCloseEditor(view)),
  );
  bar.appendChild(actions);
  container.appendChild(bar);

  const contentEl = document.createElement("div");
  contentEl.className = "editor-pane-body";
  const editorHostEl = document.createElement("div");
  editorHostEl.className = "editor-host";
  editorHostEl.setAttribute("role", "region");
  editorHostEl.setAttribute(
    "aria-label",
    initialPath ? `Editor ${initialPath}` : "Editor",
  );
  contentEl.appendChild(editorHostEl);
  const statusEl = document.createElement("div");
  statusEl.className = "editor-status";
  statusEl.textContent = initialPath ? "Loading…" : "No file open";
  contentEl.appendChild(statusEl);
  container.appendChild(contentEl);

  const view: EditorPaneViewRef = {
    id: surfaceId,
    surfaceType: "editor",
    container,
    titleEl,
    chipsEl,
    title: initialPath ? basename(initialPath) : "Editor",
    path: initialPath ?? null,
    contentEl,
    editorHostEl,
    statusEl,
    dirtyPillEl,
    pathPillEl,
    saveStateEl,
    saveBtn,
    reloadBtn,
    svgToggleBtn,
    previewBtn,
    editor: null,
    mtimeMs: null,
    dirty: false,
    language: "text",
    fileSize: 0,
    lineEnding: "none",
    callbacks,
    contentKind: "text",
    image: null,
    svgShowingSource: false,
    sourceText: "",
    _cleanup: [],
  };

  const onMouseDown = () => callbacks.onFocus(surfaceId);
  container.addEventListener("mousedown", onMouseDown);
  view._cleanup.push(() =>
    container.removeEventListener("mousedown", onMouseDown),
  );
  if (initialPath) callbacks.onRead(surfaceId, initialPath);
  else renderEmptyState(view);
  updateButtonState(view);
  return view;
}

function setSaveState(
  view: EditorPaneViewRef,
  state: "idle" | "saving" | "saved" | "error" | "conflict",
  text: string = state,
): void {
  view.saveStateEl.className = `surface-chip editor-save-state ${state}`;
  view.saveStateEl.textContent = text;
}

function setDirty(view: EditorPaneViewRef, dirty: boolean): void {
  view.dirty = dirty;
  view.dirtyPillEl.classList.toggle("hidden", !dirty);
  view.container.classList.toggle("editor-dirty", dirty);
  if (dirty) setSaveState(view, "idle", "unsaved");
  updateButtonState(view);
}

/** True when the pane is showing something the user can type into. An
 *  image never is; an SVG is only when flipped to its source. */
function isEditable(view: EditorPaneViewRef): boolean {
  if (view.contentKind === "image") return false;
  if (view.contentKind === "svg") return view.svgShowingSource;
  return true;
}

function updateButtonState(view: EditorPaneViewRef): void {
  view.saveBtn.disabled =
    !view.path || !view.editor || !view.dirty || !isEditable(view);
  view.reloadBtn.disabled = !view.path;
}

function updatePathChrome(view: EditorPaneViewRef): void {
  view.title = view.path ? basename(view.path) : "Editor";
  view.titleEl.textContent = view.title;
  view.titleEl.title = view.path ?? "No file open";
  view.pathPillEl.textContent = view.path ? dirname(view.path) : "no file";
  view.pathPillEl.title = view.path ?? "No file open";
  view.editorHostEl.setAttribute(
    "aria-label",
    view.path ? `Editor ${view.path}` : "Editor",
  );
}

function updateStatus(view: EditorPaneViewRef): void {
  if (view.contentKind === "image" && view.image) {
    const img = view.editorHostEl.querySelector("img");
    const dims =
      img && img.naturalWidth > 0
        ? `${img.naturalWidth}×${img.naturalHeight}`
        : "";
    const zoom =
      view.image.zoom === null
        ? "fit"
        : `${Math.round(view.image.zoom * 100)}%`;
    view.statusEl.textContent = [
      view.path ?? "No file",
      view.image.mime,
      dims,
      humanBytes(view.fileSize),
      zoom,
    ]
      .filter(Boolean)
      .join(" · ");
    return;
  }

  const doc = view.editor?.state.doc;
  const sel = view.editor?.state.selection.main;
  let loc = "Ln 1, Col 1";
  let selected = "";
  if (doc && sel) {
    const line = doc.lineAt(sel.head);
    loc = `Ln ${line.number}, Col ${sel.head - line.from + 1}`;
    const ranges = view.editor!.state.selection.ranges;
    const selectedChars = ranges.reduce(
      (sum, r) => sum + Math.abs(r.to - r.from),
      0,
    );
    selected = selectedChars > 0 ? ` · ${selectedChars} selected` : "";
  }
  const parts = [
    view.path ?? "No file",
    view.language,
    loc + selected,
    humanBytes(view.fileSize),
    view.lineEnding,
  ];
  if (view.dirty) parts.push("modified");
  view.statusEl.textContent = parts.filter(Boolean).join(" · ");
}

function renderEmptyState(view: EditorPaneViewRef): void {
  view.editor?.destroy();
  view.editor = null;
  view.path = null;
  view.mtimeMs = null;
  view.fileSize = 0;
  view.lineEnding = "none";
  view.contentKind = "text";
  view.image = null;
  view.svgShowingSource = false;
  view.sourceText = "";
  view.editorHostEl.replaceChildren();
  updatePathChrome(view);
  setDirty(view, false);
  setSaveState(view, "idle", "idle");

  const empty = document.createElement("div");
  empty.className = "editor-empty-state";
  const title = document.createElement("div");
  title.className = "editor-empty-title";
  title.textContent = "Open a file";
  const desc = document.createElement("div");
  desc.className = "editor-empty-desc";
  desc.textContent = "Enter an absolute path or use the sidebar file explorer.";
  const form = document.createElement("form");
  form.className = "editor-open-form";
  const input = document.createElement("input");
  input.className = "editor-open-input";
  input.placeholder = "/path/to/file.ts";
  input.setAttribute("aria-label", "File path to open");
  const openBtn = document.createElement("button");
  openBtn.type = "submit";
  openBtn.className = "editor-open-btn";
  openBtn.textContent = "Open";
  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "editor-open-btn secondary";
  createBtn.textContent = "Create";
  form.append(input, openBtn, createBtn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const path = input.value.trim();
    if (path) view.callbacks.onRead(view.id, path, false);
  });
  createBtn.addEventListener("click", () => {
    const path = input.value.trim();
    if (path) view.callbacks.onRead(view.id, path, true);
  });
  empty.append(title, desc, form);
  view.editorHostEl.appendChild(empty);
  updateStatus(view);
}

function renderErrorState(
  view: EditorPaneViewRef,
  snapshot: EditorFileSnapshot,
): void {
  view.editor?.destroy();
  view.editor = null;
  view.editorHostEl.replaceChildren();
  const err = document.createElement("div");
  err.className = "editor-error-state";
  const title = document.createElement("div");
  title.className = "editor-error-title";
  title.textContent = snapshot.binary
    ? "Binary file"
    : snapshot.tooLarge
      ? "File too large"
      : snapshot.exists === false
        ? "File not found"
        : "Could not open file";
  const body = document.createElement("div");
  body.className = "editor-error-body";
  body.textContent = snapshot.error ?? "Unknown error";
  const actions = document.createElement("div");
  actions.className = "editor-error-actions";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () =>
    view.callbacks.onRead(view.id, snapshot.path),
  );
  actions.appendChild(retry);
  if (snapshot.exists === false) {
    const create = document.createElement("button");
    create.type = "button";
    create.textContent = "Create file";
    create.addEventListener("click", () =>
      view.callbacks.onRead(view.id, snapshot.path, true),
    );
    actions.appendChild(create);
  }
  err.append(title, body, actions);
  view.editorHostEl.appendChild(err);
  setDirty(view, false);
  setSaveState(view, "error", "error");
  updateButtonState(view);
  updateStatus(view);
}

/**
 * The image view.
 *
 * Two zoom modes, because they answer different questions: "fit" is
 * for *what is this*, and a pixel multiplier is for *look closely at
 * this bit*. Double-click flips between fit and 1:1, which is the
 * gesture every image viewer has trained people to expect.
 *
 * The checkerboard behind the picture is not decoration — without it a
 * transparent PNG on a dark pane is indistinguishable from a black one.
 */
function renderImageState(
  view: EditorPaneViewRef,
  dataUri: string,
  mime: string,
): void {
  view.image = { dataUri, mime, zoom: null };
  view.editorHostEl.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "editor-image-view";

  const stage = document.createElement("div");
  stage.className = "editor-image-stage";
  const img = document.createElement("img");
  img.src = dataUri;
  img.alt = view.path ? basename(view.path) : "Image";
  img.draggable = false;
  stage.appendChild(img);

  const toolbar = document.createElement("div");
  toolbar.className = "editor-image-toolbar";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "editor-image-zoom-label";

  const applyZoom = (): void => {
    const zoom = view.image?.zoom ?? null;
    if (zoom === null) {
      img.classList.add("fit");
      img.style.width = "";
      img.style.height = "";
      zoomLabel.textContent = "Fit";
    } else {
      img.classList.remove("fit");
      // Width only: the natural aspect ratio does the rest, and setting
      // both invites a rounding mismatch that shears the picture.
      img.style.width = `${Math.round(img.naturalWidth * zoom)}px`;
      img.style.height = "auto";
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    }
    updateStatus(view);
  };

  const stepZoom = (direction: 1 | -1): void => {
    if (!view.image) return;
    // Stepping from "fit" starts at 1:1 rather than at whatever the
    // fitted scale happened to be — a predictable anchor beats an
    // accurate one here.
    const current = view.image.zoom ?? 1;
    const idx = ZOOM_STEPS.findIndex((z) => z >= current - 1e-6);
    const base = idx === -1 ? ZOOM_STEPS.length - 1 : idx;
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, base + direction));
    view.image.zoom = ZOOM_STEPS[next]!;
    applyZoom();
  };

  const mkBtn = (
    label: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "editor-image-btn";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };

  toolbar.append(
    mkBtn("−", "Zoom out", () => stepZoom(-1)),
    zoomLabel,
    mkBtn("+", "Zoom in", () => stepZoom(1)),
    mkBtn("Fit", "Fit to pane", () => {
      if (!view.image) return;
      view.image.zoom = null;
      applyZoom();
    }),
    mkBtn("1:1", "Actual size", () => {
      if (!view.image) return;
      view.image.zoom = 1;
      applyZoom();
    }),
  );

  stage.addEventListener("dblclick", () => {
    if (!view.image) return;
    view.image.zoom = view.image.zoom === null ? 1 : null;
    applyZoom();
  });

  // Dimensions are unknown until decode finishes; the status line and a
  // pixel zoom both need them.
  img.addEventListener("load", () => {
    applyZoom();
    updateStatus(view);
  });
  img.addEventListener("error", () => {
    view.statusEl.textContent = `${view.path ?? ""} · could not decode ${mime}`;
  });

  wrap.append(stage, toolbar);
  view.editorHostEl.appendChild(wrap);
  applyZoom();
  setDirty(view, false);
  setSaveState(view, "saved", "image");
  updateButtonState(view);
  updateStatus(view);
}

/**
 * The SVG picture view.
 *
 * Rendered through the shared sideband sandbox — `<iframe sandbox>`,
 * no scripts, no same-origin, strict CSP. An SVG is an executable
 * document, and this one arrived because a path scrolled past in
 * terminal output; the user pointed at it, but that is not the same as
 * vouching for it. The native webview holds the Electrobun RPC bridge,
 * so this is exactly the sink CLAUDE.md's fd4 rule exists to protect.
 */
function renderSvgPreview(view: EditorPaneViewRef, markup: string): void {
  view.editor?.destroy();
  view.editor = null;
  view.editorHostEl.replaceChildren();
  const host = document.createElement("div");
  host.className = "editor-svg-preview";
  view.editorHostEl.appendChild(host);
  renderSandboxedMarkup(host, markup, "svg");
  updateButtonState(view);
  updateStatus(view);
}

/** Flip an SVG pane between its picture and its source. Reads the live
 *  buffer on the way out so a preview always reflects unsaved edits. */
export function toggleSvgSource(view: EditorPaneViewRef): void {
  if (view.contentKind !== "svg") return;
  if (view.svgShowingSource) {
    if (view.editor) view.sourceText = view.editor.state.doc.toString();
    view.svgShowingSource = false;
    renderSvgPreview(view, view.sourceText);
  } else {
    view.svgShowingSource = true;
    mountTextEditor(view, view.sourceText, "html", null, null);
  }
  view.svgToggleBtn.textContent = view.svgShowingSource ? "Preview" : "Source";
  view.svgToggleBtn.title = view.svgShowingSource
    ? "Show the rendered picture"
    : "Edit the SVG source";
}

export function editorPaneApplySnapshot(
  view: EditorPaneViewRef,
  snapshot: EditorFileSnapshot,
): void {
  if (snapshot.surfaceId !== view.id) return;
  view.path = snapshot.path;
  view.mtimeMs = snapshot.mtimeMs;
  view.language = snapshot.language ?? "text";
  view.fileSize = snapshot.size;
  view.contentKind = snapshot.kind ?? "text";
  view.image = null;
  view.sourceText = snapshot.content;
  view.lineEnding =
    view.contentKind === "image" ? "none" : detectLineEnding(snapshot.content);
  updatePathChrome(view);
  view.editor?.destroy();
  view.editor = null;
  view.editorHostEl.replaceChildren();
  view.svgToggleBtn.classList.toggle("hidden", view.contentKind !== "svg");
  view.previewBtn.classList.toggle(
    "hidden",
    !snapshot.exists || !isPreviewablePath(snapshot.path),
  );
  if (snapshot.error) {
    renderErrorState(view, snapshot);
    return;
  }
  if (view.contentKind === "image" && snapshot.imageDataUri) {
    renderImageState(
      view,
      snapshot.imageDataUri,
      snapshot.imageMime ?? "image/png",
    );
    return;
  }
  if (view.contentKind === "svg") {
    // Picture first: someone clicking an `.svg` in terminal output
    // almost always wants to see it, and the source is one button away.
    view.svgShowingSource = false;
    view.svgToggleBtn.textContent = "Source";
    view.svgToggleBtn.title = "Edit the SVG source";
    setDirty(view, false);
    setSaveState(view, "saved", "loaded");
    renderSvgPreview(view, snapshot.content);
    return;
  }
  mountTextEditor(
    view,
    snapshot.content,
    snapshot.language,
    snapshot.revealLine ?? null,
    snapshot.revealColumn ?? null,
  );
  setSaveState(
    view,
    snapshot.exists ? "saved" : "idle",
    snapshot.exists ? "loaded" : "new",
  );
}

/** Mount CodeMirror over `content`, optionally parking the cursor on a
 *  1-based line/column from a clicked terminal reference. */
function mountTextEditor(
  view: EditorPaneViewRef,
  content: string,
  language: string | undefined,
  revealLine: number | null,
  revealColumn: number | null,
): void {
  view.editor?.destroy();
  view.editor = null;
  view.editorHostEl.replaceChildren();
  view.editor = new EditorView({
    parent: view.editorHostEl,
    state: EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageExtension(language),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              saveEditor(view);
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            view.fileSize = u.state.doc.length;
            view.lineEnding = detectLineEnding(u.state.doc.toString());
            setDirty(view, true);
          }
          if (u.docChanged || u.selectionSet) updateStatus(view);
        }),
      ],
    }),
  });
  setDirty(view, false);
  updateStatus(view);
  if (revealLine !== null) revealPosition(view, revealLine, revealColumn);
  setTimeout(() => view.editor?.focus(), 0);
}

/**
 * Put the cursor on a 1-based line/column and scroll it to the middle
 * of the pane.
 *
 * Centring rather than merely scrolling-into-view is the point: a
 * stack-trace frame is only useful with the lines *around* it visible,
 * and "into view" would leave it pinned to the bottom edge.
 *
 * Out-of-range lines clamp instead of throwing — terminal output is
 * frequently stale, and pointing at the end of a file that has since
 * shrunk should still open the file.
 */
export function revealPosition(
  view: EditorPaneViewRef,
  line: number,
  column: number | null,
): void {
  const editor = view.editor;
  if (!editor) return;
  const doc = editor.state.doc;
  const target = doc.line(Math.min(Math.max(1, line), doc.lines));
  const pos =
    column !== null
      ? Math.min(target.from + Math.max(0, column - 1), target.to)
      : target.from;
  editor.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
    scrollIntoView: false,
  });
  updateStatus(view);
}

function renderConflictBanner(
  view: EditorPaneViewRef,
  result: EditorSaveResult,
): void {
  const old = view.contentEl.querySelector(".editor-conflict-banner");
  old?.remove();
  const banner = document.createElement("div");
  banner.className = "editor-conflict-banner";
  const msg = document.createElement("span");
  msg.textContent = result.error ?? "File changed on disk.";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => reloadEditor(view));
  const overwrite = document.createElement("button");
  overwrite.type = "button";
  overwrite.textContent = "Overwrite";
  overwrite.addEventListener("click", () => {
    banner.remove();
    if (view.path && view.editor) {
      setSaveState(view, "saving", "saving");
      view.callbacks.onSave(
        view.id,
        view.path,
        view.editor.state.doc.toString(),
        null,
      );
    }
  });
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => banner.remove());
  banner.append(msg, reload, overwrite, dismiss);
  view.contentEl.insertBefore(banner, view.editorHostEl);
}

export function editorPaneApplySaveResult(
  view: EditorPaneViewRef,
  result: EditorSaveResult,
): void {
  if (result.surfaceId !== view.id) return;
  if (result.ok) {
    view.mtimeMs = result.mtimeMs;
    view.fileSize = result.size;
    view.contentEl.querySelector(".editor-conflict-banner")?.remove();
    setDirty(view, false);
    setSaveState(view, "saved", "saved");
    updateStatus(view);
    return;
  }
  if (result.conflict) {
    setSaveState(view, "conflict", "conflict");
    renderConflictBanner(view, result);
  } else {
    setSaveState(view, "error", "error");
  }
  view.statusEl.textContent = result.error ?? "Save failed";
  view.statusEl.classList.add("error");
  setTimeout(() => view.statusEl.classList.remove("error"), 2500);
}

export function saveEditor(view: EditorPaneViewRef): void {
  if (!view.path || !view.editor) return;
  setSaveState(view, "saving", "saving");
  view.callbacks.onSave(
    view.id,
    view.path,
    view.editor.state.doc.toString(),
    view.mtimeMs,
  );
}

/**
 * Both destructive editor actions go through the app's own dialog.
 *
 * They used to call the DOM `confirm()`, which is why closing a dirty
 * pane appeared to do nothing: a system modal inside the Electrobun
 * webview does not open, and the call returns `false`, so the guard
 * silently swallowed the close forever. `showConfirmDialog` is the
 * in-app sheet the rest of the UI already uses — it also cannot block
 * the RPC bridge the way a native modal does.
 */
function confirmDiscard(message: string, confirmLabel: string) {
  return showConfirmDialog({
    title: "File not saved",
    message,
    confirmLabel,
    cancelLabel: "Keep editing",
    danger: true,
  });
}

function requestCloseEditor(view: EditorPaneViewRef): void {
  if (!view.dirty) {
    view.callbacks.onClose(view.id);
    return;
  }
  void confirmDiscard(
    `${view.path ? basename(view.path) : "This file"} has unsaved changes. Close it and discard them?`,
    "Discard and close",
  ).then((ok) => {
    if (ok) view.callbacks.onClose(view.id);
  });
}

export function reloadEditor(view: EditorPaneViewRef): void {
  if (!view.path) return;
  const doReload = (): void => {
    view.contentEl.querySelector(".editor-conflict-banner")?.remove();
    view.callbacks.onReload(view.id, view.path!);
  };
  if (!view.dirty) {
    doReload();
    return;
  }
  void confirmDiscard(
    `${basename(view.path)} has unsaved changes. Reload from disk and discard them?`,
    "Discard and reload",
  ).then((ok) => {
    if (ok) doReload();
  });
}

export function destroyEditorPaneView(view: EditorPaneViewRef): void {
  view.editor?.destroy();
  for (const dispose of view._cleanup) dispose();
}
