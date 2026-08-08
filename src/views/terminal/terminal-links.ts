/**
 * Clickable `path:line` references in terminal output.
 *
 * The web-links addon already turns URLs into links. This does the same
 * for file references — `src/bun/index.ts:2058`, a compiler diagnostic,
 * a stack-trace frame — which agent CLIs, test runners and compilers
 * print constantly.
 *
 * τ-mux is in an unusual position to make that useful: it ships a
 * CodeMirror editor pane and an image viewer, so the click has
 * somewhere to *go*. In a terminal without one, the best a file link
 * can do is hand the path to an external editor and lose the window.
 *
 * Three layers, deliberately separated:
 *
 *   - Matching rules live in `src/shared/file-reference.ts`, pure and
 *     exhaustively tested.
 *   - Existence and classification live behind `probe` — which is what
 *     lets this module underline only what it can actually open, the
 *     single biggest difference between "clickable paths" and
 *     *reliable* clickable paths.
 *   - Where the click lands is the caller's business; this module only
 *     reports what was clicked and how.
 */

import { isAbsoluteish } from "../../shared/file-reference";
import {
  findReferencesAcrossRows,
  pickNonOverlapping,
} from "../../shared/wrapped-file-reference";
import type { ProbedPath } from "../../shared/types";

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
      getLine(index: number):
        | {
            translateToString(trimRight?: boolean): string;
            /** Set when this row is a soft-wrap continuation of the
             *  previous one. Load-bearing for joining split paths. */
            isWrapped?: boolean;
          }
        | undefined;
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
  hover?(event: MouseEvent, text: string): void;
  leave?(event: MouseEvent, text: string): void;
}

/** A resolved, existing thing the user clicked or hovered. */
export interface FileLinkTarget {
  /** Absolute path, `~` expanded and resolved against the pane's cwd. */
  path: string;
  /** The text as it appeared in the terminal, for messages. */
  raw: string;
  line: number | null;
  column: number | null;
  probed: ProbedPath;
  /** The user asked for a fresh pane rather than reuse (⌥-click). */
  forceNewPane: boolean;
  /** The user asked to *view* rather than edit (⌘-click). Only
   *  meaningful for a previewable file; the router ignores it
   *  otherwise. */
  preferBrowser: boolean;
}

export interface FileLinkDeps {
  /** The surface's current working directory, for resolving relative
   *  paths. Undefined before the metadata poller's first tick — links
   *  still resolve for absolute paths, so this degrades rather than
   *  disappearing. */
  getCwd: () => string | undefined;
  /** Stat + classify candidates. Only entries that come back as `file`
   *  or `directory` become links. */
  probe: (paths: string[], cwd?: string) => Promise<Map<string, ProbedPath>>;
  /** Open the reference. */
  open: (target: FileLinkTarget) => void;
  hover?: (target: FileLinkTarget, event: MouseEvent) => void;
  leave?: () => void;
}

/**
 * Register the provider. No-op on a terminal without link support.
 *
 * References split across rows are reconstructed — both terminal soft
 * wraps and an application's own re-flowed, indented output. See
 * `wrapped-file-reference.ts`: it over-generates candidates and the
 * probe below decides which readings are real, so hovering either half
 * of a broken path produces the same working link.
 */
export function installFileLinks(
  term: LinkCapableTerminal,
  deps: FileLinkDeps,
): void {
  if (typeof term.registerLinkProvider !== "function") return;

  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const getRow = (row: number) => {
        // xterm's buffer is 0-based; link rows are 1-based.
        const line = term.buffer?.active?.getLine(row - 1);
        if (!line) return null;
        return {
          text: line.translateToString(true),
          isWrapped: line.isWrapped === true,
        };
      };

      const refs = findReferencesAcrossRows(getRow, bufferLineNumber);
      if (refs.length === 0) {
        callback(undefined);
        return;
      }

      // A relative reference means nothing without the pane's cwd; an
      // absolute one resolves on its own. Both go to the probe, which
      // ignores `cwd` for absolute inputs.
      const cwd = deps.getCwd();
      const wantsCwd = refs.some((r) => !isAbsoluteish(r.path));

      deps
        .probe(
          refs.map((r) => r.path),
          wantsCwd ? cwd : undefined,
        )
        .then((probes) => {
          // Discard readings the filesystem does not back. This is what
          // makes joining rows safe: a wrong join names a file that is
          // not there, and disappears here. It is also the original
          // guarantee — no underline for something we cannot open,
          // since a link that opens a pane reading "File does not
          // exist" is worse than no link at all.
          const usable = refs.filter((ref) => {
            const probed = probes.get(ref.path);
            return probed?.type === "file" || probed?.type === "directory";
          });

          const links = pickNonOverlapping(usable).map((ref): TerminalLink => {
            const probed = probes.get(ref.path)!;
            const makeTarget = (event: MouseEvent): FileLinkTarget => ({
              path: probed.resolved,
              raw: ref.matchText,
              line: ref.line,
              column: ref.column,
              probed,
              // Coerced, not passed through: xterm can activate a link
              // from a keyboard event, and an absent modifier must read
              // as "no" rather than as undefined.
              forceNewPane: event.altKey === true,
              preferBrowser: event.metaKey === true,
            });
            return {
              // xterm ranges are 1-based and inclusive of `end`; our
              // `endCol` is 0-based exclusive, so the number carries
              // over unchanged.
              range: {
                start: { x: ref.range.startCol + 1, y: ref.range.startRow },
                end: { x: ref.range.endCol, y: ref.range.endRow },
              },
              text: ref.matchText,
              activate: (event) => deps.open(makeTarget(event)),
              hover: (event) => deps.hover?.(makeTarget(event), event),
              leave: () => deps.leave?.(),
            };
          });
          callback(links.length > 0 ? links : undefined);
        })
        .catch(() => {
          // A failed probe means no links this frame. Never throw into
          // xterm's link pipeline.
          callback(undefined);
        });
    },
  });
}
