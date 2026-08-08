/**
 * Drag a file onto a terminal pane; get its quoted path at the cursor.
 *
 * Standard in iTerm2, Terminal.app, Ghostty and WezTerm, and absent here
 * until now — `dragover`/`drop` handlers existed on the agent panel and
 * the sidebar, but not on terminal panes. It is also how people hand an
 * image to an agent CLI: drag the screenshot in, get a path, send it.
 *
 * The text is written as a *paste*, not as typing, so a program with
 * bracketed paste on sees one insertion rather than a keystroke burst —
 * and so a filename containing a newline (legal on macOS) cannot submit
 * a half-written command line.
 */

/** Quote a path for a POSIX shell.
 *
 * Single-quote everything and escape embedded single quotes with the
 * `'\''` idiom. Blanket-quoting rather than quoting-when-needed is
 * deliberate: the set of characters a shell treats specially is long
 * (`space $ ` " \ ! * ? [ ] ( ) { } ; & | < > # ~ newline`), macOS
 * filenames may contain nearly all of them, and "looks like it needs no
 * quoting" is exactly the judgement that gets this wrong.
 */
export function shellQuote(path: string): string {
  return `'${path.split("'").join(`'\\''`)}'`;
}

/** Space-separated, shell-quoted paths — what a terminal drop should
 *  insert. Empty when there is nothing droppable. */
export function formatDroppedPaths(paths: readonly string[]): string {
  const usable = paths.filter((p) => p.length > 0);
  if (usable.length === 0) return "";
  return usable.map(shellQuote).join(" ");
}

/** Minimal element surface `installFileDrop` binds to. `EventTarget` is
 *  the widest thing that accepts a real `HTMLElement` without importing
 *  the DOM element type. */
type DropTarget = Pick<EventTarget, "addEventListener">;

export interface FileDropDeps {
  /** Focus the pane before inserting — a drop is a deliberate act on
   *  *this* pane, and inserting into a different focused one would be
   *  a surprise. */
  focus: () => void;
  /** Insert the formatted paths. Implemented as a paste, not typing. */
  insert: (text: string) => void;
}

/**
 * Accept file drops on a pane container.
 *
 * `dragover` must call `preventDefault` or the browser refuses the drop
 * entirely; setting `dropEffect` is what makes the cursor tell the truth
 * about what is about to happen.
 */
export function installFileDrop(el: DropTarget, deps: FileDropDeps): void {
  el.addEventListener("dragover", (raw) => {
    const event = raw as DragEvent;
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  el.addEventListener("drop", (raw) => {
    const event = raw as DragEvent;
    const text = formatDroppedPaths(extractDroppedPaths(event.dataTransfer));
    if (!text) return;
    event.preventDefault();
    deps.focus();
    deps.insert(text);
  });
}

/** The slice of `DataTransfer` we read. Structural so tests need no DOM. */
export interface DropDataLike {
  files?: ArrayLike<{ path?: string; name?: string }>;
  getData?(format: string): string;
}

/**
 * Paths from a drop event.
 *
 * Two sources, in order of trustworthiness:
 *
 *   1. `dataTransfer.files[].path` — the real filesystem path. Present
 *      in a WebView with local file access, which is where τ-mux lives.
 *   2. `text/uri-list` — `file://` URLs, the cross-platform fallback.
 *      Percent-decoded; non-`file:` URIs are dropped rather than pasted
 *      as text, because a dragged web link is not a path and inserting
 *      `https://…` into a shell prompt is not what the user meant.
 *
 * `files[].name` is deliberately NOT used: a bare filename with no
 * directory would produce a path that silently resolves against the
 * wrong cwd.
 */
export function extractDroppedPaths(data: DropDataLike | null): string[] {
  if (!data) return [];

  const fromFiles: string[] = [];
  const files = data.files;
  if (files) {
    for (let i = 0; i < files.length; i++) {
      const p = files[i]?.path;
      if (p) fromFiles.push(p);
    }
  }
  if (fromFiles.length > 0) return fromFiles;

  const uriList = data.getData?.("text/uri-list") ?? "";
  if (!uriList) return [];
  const out: string[] = [];
  for (const raw of uriList.split(/\r?\n/)) {
    const line = raw.trim();
    // `text/uri-list` comments start with '#'.
    if (!line || line.startsWith("#")) continue;
    if (!line.startsWith("file://")) continue;
    try {
      out.push(decodeURIComponent(new URL(line).pathname));
    } catch {
      /* malformed URI — skip rather than insert something wrong */
    }
  }
  return out;
}
