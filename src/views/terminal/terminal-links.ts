/**
 * Clickable `path:line` references in terminal output.
 *
 * The web-links addon already turns URLs into links. This does the same
 * for file references — `src/bun/index.ts:2058`, a compiler diagnostic,
 * a stack-trace frame — which agent CLIs, test runners and compilers
 * print constantly.
 *
 * τ-mux is in an unusual position to make that useful: it ships a
 * CodeMirror editor pane, so the click has somewhere to *go*. In a
 * terminal without one, the best a file link can do is hand the path to
 * an external editor and lose the window.
 *
 * Matching rules live in `src/shared/file-reference.ts` and are tested
 * exhaustively there; this module is the xterm wiring plus the
 * relative-path resolution that needs the surface's cwd.
 */

import { findFileReferences, isAbsoluteish } from "../../shared/file-reference";

/** Structural slice of xterm we touch. Optional so the happy-dom
 *  SurfaceManager mock does not need to implement link providers. */
interface LinkCapableTerminal {
  registerLinkProvider?: (provider: {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: TerminalLink[] | undefined) => void,
    ): void;
  }) => unknown;
  buffer?: {
    active?: {
      getLine(
        index: number,
      ): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
}

interface TerminalLink {
  range: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  text: string;
  activate(event: MouseEvent, text: string): void;
}

export interface FileLinkDeps {
  /** The surface's current working directory, for resolving relative
   *  paths. Undefined before the metadata poller's first tick — links
   *  still resolve for absolute paths, so this degrades rather than
   *  disappearing. */
  getCwd: () => string | undefined;
  /** Open the reference. `line` is passed through so a future
   *  jump-to-line can use it without changing this signature. */
  openFile: (ref: { path: string; cwd?: string; line: number | null }) => void;
}

/**
 * Register the provider. No-op on a terminal without link support.
 *
 * Only single-row matches are produced: a reference wrapped across two
 * rows is skipped rather than mis-highlighted. Wrapped links need
 * `isWrapped` walking and produce ranges that break the underline on
 * resize, and a path long enough to wrap an 80-column pane is rare
 * enough that the complexity is not worth the failure modes.
 */
export function installFileLinks(
  term: LinkCapableTerminal,
  deps: FileLinkDeps,
): void {
  if (typeof term.registerLinkProvider !== "function") return;

  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer?.active?.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      if (!text) {
        callback(undefined);
        return;
      }

      const refs = findFileReferences(text);
      if (refs.length === 0) {
        callback(undefined);
        return;
      }

      callback(
        refs.map((ref) => ({
          // xterm ranges are 1-based and inclusive of `end`.
          range: {
            start: { x: ref.start + 1, y: bufferLineNumber },
            end: { x: ref.end, y: bufferLineNumber },
          },
          text: text.slice(ref.start, ref.end),
          activate: () => {
            deps.openFile({
              path: ref.path,
              cwd: isAbsoluteish(ref.path) ? undefined : deps.getCwd(),
              line: ref.line,
            });
          },
        })),
      );
    },
  });
}
