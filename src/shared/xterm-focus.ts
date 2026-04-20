// Scroll-safe xterm focus helper shared by the native webview and the
// HTTP mirror. Browsers may try to scroll the hidden helper textarea
// into view when focus moves; we capture both document scroll and the
// xterm viewport scroll, focus with `preventScroll` when possible, then
// restore on the next frame.

export interface XtermFocusTarget {
  focus: () => void;
}

function restoreDocumentScroll(left: number, top: number): void {
  const scroller = document.scrollingElement as HTMLElement | null;
  if (scroller) {
    scroller.scrollLeft = left;
    scroller.scrollTop = top;
    return;
  }
  if (typeof window.scrollTo === "function") {
    try {
      window.scrollTo(left, top);
    } catch {
      /* ignore */
    }
  }
}

function focusWithoutScroll(el: HTMLElement): boolean {
  try {
    el.focus({ preventScroll: true });
    return true;
  } catch {
    try {
      el.focus();
      return true;
    } catch {
      return false;
    }
  }
}

function nextFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => cb());
    return;
  }
  setTimeout(cb, 0);
}

export function focusXtermPreservingScroll(
  term: XtermFocusTarget | null | undefined,
  host: ParentNode | null | undefined,
): void {
  if (!term) return;

  const docLeft =
    (document.scrollingElement as HTMLElement | null)?.scrollLeft ??
    window.scrollX ??
    0;
  const docTop =
    (document.scrollingElement as HTMLElement | null)?.scrollTop ??
    window.scrollY ??
    0;
  const viewport = host?.querySelector?.(".xterm-viewport") as
    | HTMLElement
    | null;
  const viewportLeft = viewport?.scrollLeft ?? 0;
  const viewportTop = viewport?.scrollTop ?? 0;
  const restore = () => {
    if (viewport) {
      viewport.scrollLeft = viewportLeft;
      viewport.scrollTop = viewportTop;
    }
    restoreDocumentScroll(docLeft, docTop);
  };

  const helper = host?.querySelector?.(".xterm-helper-textarea") as
    | HTMLElement
    | null;
  if (!helper || !focusWithoutScroll(helper)) {
    try {
      term.focus();
    } catch {
      return;
    }
  }

  restore();
  nextFrame(restore);
}
