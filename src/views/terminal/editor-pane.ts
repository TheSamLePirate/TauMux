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
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorFileSnapshot, EditorSaveResult } from "../../shared/types";
import { createIcon, type IconName } from "./icons";

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
  editor: EditorView | null;
  mtimeMs: number | null;
  dirty: boolean;
  language: string;
  fileSize: number;
  lineEnding: "LF" | "CRLF" | "mixed" | "none";
  callbacks: EditorPaneCallbacks;
  _cleanup: (() => void)[];
}

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
  actions.append(
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
  editorHostEl.setAttribute("aria-label", initialPath ? `Editor ${initialPath}` : "Editor");
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
    editor: null,
    mtimeMs: null,
    dirty: false,
    language: "text",
    fileSize: 0,
    lineEnding: "none",
    callbacks,
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

function updateButtonState(view: EditorPaneViewRef): void {
  view.saveBtn.disabled = !view.path || !view.editor || !view.dirty;
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
  const doc = view.editor?.state.doc;
  const sel = view.editor?.state.selection.main;
  let loc = "Ln 1, Col 1";
  let selected = "";
  if (doc && sel) {
    const line = doc.lineAt(sel.head);
    loc = `Ln ${line.number}, Col ${sel.head - line.from + 1}`;
    const ranges = view.editor!.state.selection.ranges;
    const selectedChars = ranges.reduce((sum, r) => sum + Math.abs(r.to - r.from), 0);
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

function renderErrorState(view: EditorPaneViewRef, snapshot: EditorFileSnapshot): void {
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
  retry.addEventListener("click", () => view.callbacks.onRead(view.id, snapshot.path));
  actions.appendChild(retry);
  if (snapshot.exists === false) {
    const create = document.createElement("button");
    create.type = "button";
    create.textContent = "Create file";
    create.addEventListener("click", () => view.callbacks.onRead(view.id, snapshot.path, true));
    actions.appendChild(create);
  }
  err.append(title, body, actions);
  view.editorHostEl.appendChild(err);
  setDirty(view, false);
  setSaveState(view, "error", "error");
  updateButtonState(view);
  updateStatus(view);
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
  view.lineEnding = detectLineEnding(snapshot.content);
  updatePathChrome(view);
  view.editor?.destroy();
  view.editor = null;
  view.editorHostEl.replaceChildren();
  if (snapshot.error) {
    renderErrorState(view, snapshot);
    return;
  }
  view.editor = new EditorView({
    parent: view.editorHostEl,
    state: EditorState.create({
      doc: snapshot.content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageExtension(snapshot.language),
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
  setSaveState(view, snapshot.exists ? "saved" : "idle", snapshot.exists ? "loaded" : "new");
  updateStatus(view);
  setTimeout(() => view.editor?.focus(), 0);
}

function renderConflictBanner(view: EditorPaneViewRef, result: EditorSaveResult): void {
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
      view.callbacks.onSave(view.id, view.path, view.editor.state.doc.toString(), null);
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

function requestCloseEditor(view: EditorPaneViewRef): void {
  if (view.dirty && !confirm("Close editor and discard unsaved changes?")) return;
  view.callbacks.onClose(view.id);
}

export function reloadEditor(view: EditorPaneViewRef): void {
  if (!view.path) return;
  if (view.dirty && !confirm("Discard unsaved changes and reload from disk?")) return;
  view.contentEl.querySelector(".editor-conflict-banner")?.remove();
  view.callbacks.onReload(view.id, view.path);
}

export function destroyEditorPaneView(view: EditorPaneViewRef): void {
  view.editor?.destroy();
  for (const dispose of view._cleanup) dispose();
}
