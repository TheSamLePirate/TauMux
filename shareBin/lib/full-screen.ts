/**
 * Shared lifecycle for `show_*` utilities that want to live as a
 * single full-terminal sideband panel: pinned at (0, 0), sized to
 * the current pane pixel dimensions, mouse + wheel forwarded back
 * to fd5, and the script exits the moment the user closes the
 * panel (or the host pane disappears).
 *
 * Two entry points:
 *
 *   - `fullScreenHtml({ render, onEvent? })` — the common case. The
 *      helper creates the `html` panel, calls `render(size)` with
 *      the initial viewport, and re-invokes `render(size)` on every
 *      terminal-resize event so the markup can flow at the new
 *      dimensions.
 *
 *   - `attachFullScreen({ panelId, ... })` — the lifecycle bits in
 *      isolation: handlers for terminal-resize, panel close, fatal
 *      sideband errors, SIGINT/SIGTERM/SIGHUP, plus an `exit()`
 *      that clears the panel and quits. Use it when the panel
 *      isn't `html` (e.g. the streaming `image` panel in
 *      `show_webcam`).
 *
 * The trick that lets the panel actually fill the pane is twofold:
 *
 *   1. Install the `onTerminalResize` listener BEFORE writing the
 *      panel meta. The webview emits a `__terminal__` resize event
 *      with real `pxWidth` / `pxHeight` immediately after each
 *      panel is created (see `panel-manager.ts`); if the listener
 *      isn't ready when that event arrives, the panel keeps the
 *      cell-size estimate forever and looks tiny in big terminals.
 *
 *   2. Re-send `width` / `height` on every update so the resize
 *      from the first `__terminal__` event actually changes the
 *      panel's pixel dimensions and not just its content.
 *
 * Centralising it keeps each `show_*` focused on what to draw.
 */

import { ht, type TauMuxEvent } from "../hyperterm";

// xterm at the default font is roughly 8.4 × 17 pixels per cell on
// macOS retina; matches the constants in `scripts/demo_gitdiff.ts`
// and `shareBin/show_gitdiff`. Used only as a fallback for the
// initial render — the first `__terminal__` resize event lands
// shortly after the panel is created and replaces these with the
// real `pxWidth` / `pxHeight`.
const ESTIMATED_CELL_W = 8.4;
const ESTIMATED_CELL_H = 17;

// Hard floor — panels narrower / shorter than this would render
// the chrome unusable. Most splits are larger; we just avoid
// degenerate sizes when stdout reports 0 cols/rows during startup.
const MIN_W = 320;
const MIN_H = 220;

export interface FullScreenSize {
  /** Panel pixel width (matches the host pane). */
  width: number;
  /** Panel pixel height (matches the host pane). */
  height: number;
}

/** Return the best current estimate of the host pane's pixel size,
 *  using `process.stdout.columns/rows` and the cell-size constants.
 *  Replaced as soon as a `__terminal__` resize event arrives with
 *  real pxWidth/pxHeight. */
export function viewportSize(): FullScreenSize {
  const cols = process.stdout.isTTY ? (process.stdout.columns ?? 0) : 0;
  const rows = process.stdout.isTTY ? (process.stdout.rows ?? 0) : 0;
  const width = cols > 0 ? Math.round(cols * ESTIMATED_CELL_W) : 1180;
  const height = rows > 0 ? Math.round(rows * ESTIMATED_CELL_H) : 760;
  return {
    width: Math.max(MIN_W, width),
    height: Math.max(MIN_H, height),
  };
}

export interface AttachOptions {
  /** Panel id whose lifecycle we manage. */
  panelId: string;
  /** Fires when the host pane's pixel size changes. */
  onResize?: (size: FullScreenSize) => void;
  /** Fires for every panel event except `close` (handled here). */
  onEvent?: (event: TauMuxEvent) => void;
  /** Sync hook fired once just before the process exits — stop
   *  timers, kill subprocesses, etc. */
  onExit?: () => void;
  /** Initial size to start from. The handler still re-fires
   *  `onResize` on the first `__terminal__` event with real
   *  dimensions. Defaults to `viewportSize()`. */
  initialSize?: FullScreenSize;
}

export interface AttachHandle {
  /** Latest known pixel size of the host pane. */
  size(): FullScreenSize;
  /** Tear the panel down and exit. Logs `reason` to stderr if
   *  provided. Idempotent. */
  exit(reason?: string): never;
}

/** Wire up resize / close / signal handlers for an existing panel.
 *  Caller is responsible for the initial `showHtml` (or whatever
 *  type) and for re-pushing content on resize. Use `fullScreenHtml`
 *  for the common HTML case. */
export function attachFullScreen(opts: AttachOptions): AttachHandle {
  let size = opts.initialSize ?? viewportSize();
  let exiting = false;

  function exit(reason?: string): never {
    if (exiting) {
      // exit() can re-enter via `process.on("exit")` after the
      // first call already started teardown; bail to avoid clearing
      // a panel that no longer has a live fd.
      process.exit(0);
    }
    exiting = true;
    try {
      opts.onExit?.();
    } catch {
      /* user cleanup threw — keep tearing down */
    }
    try {
      ht.clear(opts.panelId);
    } catch {
      /* fd may already be closed */
    }
    if (reason) process.stderr.write(`\n[${reason}]\n`);
    process.exit(0);
  }

  // Surface protocol-level errors so the calling shell sees them
  // instead of hanging in puzzled silence when meta validation
  // fails or the binary stream desyncs.
  ht.onError((code, message, ref) => {
    process.stderr.write(
      `[sideband] ${code}: ${message}${ref ? ` (ref=${ref})` : ""}\n`,
    );
  });

  // Real pixel dimensions arrive here on every host pane resize,
  // and once shortly after spawn for the initial geometry — see
  // `panel-manager.ts` `emitTerminalResizeIfNeeded` which runs
  // right after each panel is created.
  ht.onTerminalResize((data) => {
    const newW =
      data.pxWidth > 0
        ? data.pxWidth
        : Math.round(data.cols * ESTIMATED_CELL_W);
    const newH =
      data.pxHeight > 0
        ? data.pxHeight
        : Math.round(data.rows * ESTIMATED_CELL_H);
    const next: FullScreenSize = {
      width: Math.max(MIN_W, newW),
      height: Math.max(MIN_H, newH),
    };
    if (next.width === size.width && next.height === size.height) return;
    size = next;
    opts.onResize?.(size);
  });

  // Belt-and-braces: stdout 'resize' fires for SIGWINCH on the
  // controlling tty even before the sideband terminal-resize event
  // lands. Estimating from cols/rows is close enough to keep the
  // panel from looking stale during the gap.
  if (process.stdout.isTTY) {
    process.stdout.on("resize", () => {
      const next = viewportSize();
      if (next.width === size.width && next.height === size.height) return;
      size = next;
      opts.onResize?.(size);
    });
  }

  ht.onClose(opts.panelId, () => exit());

  if (opts.onEvent) {
    ht.onEvent((event) => {
      if (event.id !== opts.panelId) return;
      if (event.event === "close") return;
      opts.onEvent!(event);
    });
  }

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => exit(sig));
  }

  return {
    size: () => size,
    exit,
  };
}

// ── Close-button overlay ─────────────────────────────────────

const CLOSE_BTN_W = 36;
const CLOSE_BTN_H = 36;
const CLOSE_BTN_MARGIN = 10;

function closeBtnHtml(): string {
  return `<div class="fs-close-btn"><span>×</span></div>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; cursor: pointer; }
  .fs-close-btn {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: rgba(17, 17, 27, 0.78);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(243, 139, 168, 0.42);
    border-radius: 8px;
    color: #f38ba8;
    font: 700 22px/1 ui-monospace, "SF Mono", monospace;
    transition: background 120ms ease, transform 120ms ease, color 120ms ease;
    user-select: none;
  }
  .fs-close-btn:hover { background: rgba(243, 139, 168, 0.32); color: #fff; transform: scale(1.06); }
  .fs-close-btn:active { transform: scale(0.94); }
</style>`;
}

export interface CloseButtonHandle {
  /** Reposition the button — call when the host pane resizes. */
  reposition(viewport: FullScreenSize): void;
  /** Remove the button. The full-screen helper does this on exit;
   *  callers can use it for early teardown. */
  destroy(): void;
}

/** Mount a small interactive HTML close-button overlay anchored to
 *  the top-right of the host pane. Clicking it invokes `onClose`.
 *
 *  Fixed (chromeless) panels expose no UI close button — the
 *  overlay restores that affordance without forcing the underlying
 *  panel into `position: "float"` (which would also drag the title
 *  bar / drag handle into view). */
export function mountCloseButton(
  ownerPanelId: string,
  initialViewport: FullScreenSize,
  onClose: () => void,
): CloseButtonHandle {
  const id = `${ownerPanelId}_close`;
  const place = (vp: FullScreenSize) => ({
    x: Math.max(0, vp.width - CLOSE_BTN_W - CLOSE_BTN_MARGIN),
    y: CLOSE_BTN_MARGIN,
  });

  const initial = place(initialViewport);
  ht.sendMeta({
    id,
    type: "html",
    position: "fixed",
    x: initial.x,
    y: initial.y,
    width: CLOSE_BTN_W,
    height: CLOSE_BTN_H,
    draggable: false,
    resizable: false,
    interactive: true,
    zIndex: 10000,
    borderRadius: 8,
    data: closeBtnHtml(),
  });

  ht.onEvent((event) => {
    if (event.id !== id) return;
    if (event.event === "click" || event.event === "mousedown") onClose();
  });

  return {
    reposition(viewport): void {
      const pos = place(viewport);
      ht.update(id, { x: pos.x, y: pos.y });
    },
    destroy(): void {
      try {
        ht.clear(id);
      } catch {
        /* fd may already be closed */
      }
    },
  };
}

export interface FullScreenHtmlOptions {
  /** Build the HTML markup for the supplied viewport size. */
  render: (size: FullScreenSize) => string;
  /** Forward mouse / wheel events to fd5. Default true — the panel
   *  is full-pane so most `show_*` scripts want clicks for sorting,
   *  filtering, scrolling, etc. */
  interactive?: boolean;
  /** Show the floating close-button overlay in the top-right
   *  corner. Default true. Disable when the panel itself renders
   *  its own close affordance. */
  showCloseButton?: boolean;
  /** Fires for every panel event except `close`. */
  onEvent?: (event: TauMuxEvent) => void;
  /** Fires once just before the process exits. */
  onExit?: () => void;
}

export interface FullScreenHtml extends AttachHandle {
  /** Stable panel id — useful when wiring `onClick` / `onWheel`
   *  helpers from the outside. */
  readonly id: string;
  /** Re-invoke `render(size)` with the current viewport and push
   *  the result. Use after data changes (file polling, subprocess
   *  output, etc.) so the panel reflects the new state. */
  rerender(): void;
  /** Push a pre-built HTML string to the panel. Skips the `render`
   *  callback. The next resize still falls back to `render`. */
  setHtml(html: string): void;
}

/** Create a full-pane HTML sideband panel and wire up the standard
 *  resize → re-render and close → exit lifecycle. */
export function fullScreenHtml(opts: FullScreenHtmlOptions): FullScreenHtml {
  if (!ht.available) {
    console.error("Not running inside τ-mux.");
    process.exit(1);
  }

  // Use a stable, deterministic id so `onClose` / `onTerminalResize`
  // can be installed BEFORE the panel is created. The legacy lib
  // generates a unique id per `showHtml` call, but here we want the
  // listener wired up ahead of the meta write so we don't miss the
  // first `__terminal__` event.
  const id = `fs_${process.pid}_${Date.now().toString(36)}`;

  let size = viewportSize();
  let lastHtml = opts.render(size);

  function pushUpdate(): void {
    ht.update(id, {
      data: lastHtml,
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    });
  }

  let closeBtn: CloseButtonHandle | null = null;

  // Install the lifecycle BEFORE writing the panel meta — see the
  // file-level note. This means `attachFullScreen`'s onResize hook
  // is ready when the post-creation resize event arrives.
  const handle = attachFullScreen({
    panelId: id,
    initialSize: size,
    onResize: (next) => {
      size = next;
      lastHtml = opts.render(next);
      pushUpdate();
      closeBtn?.reposition(next);
    },
    onEvent: opts.onEvent,
    onExit: () => {
      closeBtn?.destroy();
      opts.onExit?.();
    },
  });

  // Now create the panel. The webview will emit a `__terminal__`
  // resize event right after creation; our listener is already
  // armed and re-renders at the real pxWidth/pxHeight.
  ht.sendMeta({
    id,
    type: "html",
    position: "fixed",
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    draggable: false,
    resizable: false,
    interactive: opts.interactive ?? true,
    borderRadius: 0,
    byteLength: new TextEncoder().encode(lastHtml).byteLength,
  });
  ht.sendData(lastHtml);

  // Mount the close-button overlay AFTER the main panel so it
  // stacks on top in the natural creation order (zIndex still wins
  // if anything else slips in between).
  if (opts.showCloseButton !== false) {
    closeBtn = mountCloseButton(id, size, () => handle.exit());
  }

  return {
    id,
    size: handle.size,
    exit: handle.exit,
    rerender(): void {
      lastHtml = opts.render(handle.size());
      pushUpdate();
    },
    setHtml(html: string): void {
      lastHtml = html;
      pushUpdate();
    },
  };
}

// ── Shared CSS chrome ────────────────────────────────────────

/**
 * Catppuccin Mocha palette used by every full-screen `show_*`
 * panel. Keeping the palette in one place means the scripts agree
 * on backgrounds, accent colours, and scrollbar styling — the
 * panels are sibling tools, they should look like sibling tools.
 */
export const CATPPUCCIN = {
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay0: "#6c7086",
  overlay1: "#7f849c",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  subtext1: "#bac2de",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  lavender: "#b4befe",
  teal: "#94e2d5",
  peach: "#fab387",
  mauve: "#cba6f7",
  pink: "#f5c2e7",
  sky: "#89dceb",
} as const;

/** Reset + scrollbar CSS shared by every full-screen panel. Drop
 *  this into the panel's `<style>` block before any utility-
 *  specific rules. */
export const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: ${CATPPUCCIN.base};
    color: ${CATPPUCCIN.text};
    font-family: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
    font-size: 12.5px;
    line-height: 1.5;
    overflow: hidden;
  }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: ${CATPPUCCIN.mantle}; }
  ::-webkit-scrollbar-thumb { background: ${CATPPUCCIN.surface1}; border-radius: 5px; }
  ::-webkit-scrollbar-thumb:hover { background: ${CATPPUCCIN.overlay0}; }
  ::-webkit-scrollbar-corner { background: ${CATPPUCCIN.mantle}; }
  a { color: ${CATPPUCCIN.blue}; }
  a:hover { color: ${CATPPUCCIN.lavender}; }
`;

/** Build a standard "title bar + scrolling body" page for a
 *  full-screen panel. The body fills the remaining space and is
 *  the scroll container. `extraCss` is appended after `BASE_CSS`
 *  so the caller can override anything. */
export interface PageOptions {
  title: string;
  /** Right-aligned subtitle / status text. */
  subtitle?: string;
  /** Coloured tag rendered before the title. */
  tag?: { label: string; color?: string };
  /** Markup placed inside the scrolling body. */
  body: string;
  /** Extra CSS appended after `BASE_CSS`. */
  extraCss?: string;
}

/** Build the standard chrome — header bar with optional tag +
 *  subtitle, scroll body, full-page background. */
export function fullScreenPage(opts: PageOptions): string {
  const tagHtml = opts.tag
    ? `<span class="fs-tag" style="color:${opts.tag.color ?? CATPPUCCIN.blue}">${opts.tag.label}</span>`
    : "";
  const subtitleHtml = opts.subtitle
    ? `<span class="fs-subtitle">${opts.subtitle}</span>`
    : "";
  return `<div class="fs-shell">
  <header class="fs-header">${tagHtml}<span class="fs-title">${opts.title}</span><span class="fs-spacer"></span>${subtitleHtml}</header>
  <div class="fs-body">${opts.body}</div>
</div>
<style>
${BASE_CSS}
.fs-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: ${CATPPUCCIN.base};
}
.fs-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-bottom: 1px solid ${CATPPUCCIN.surface0};
  background: ${CATPPUCCIN.mantle};
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: ${CATPPUCCIN.subtext0};
}
.fs-tag { font-weight: 700; text-transform: uppercase; }
.fs-title { color: ${CATPPUCCIN.text}; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-spacer { flex: 1 1 auto; }
.fs-subtitle { color: ${CATPPUCCIN.overlay1}; font-variant-numeric: tabular-nums; }
.fs-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px;
}
${opts.extraCss ?? ""}
</style>`;
}
