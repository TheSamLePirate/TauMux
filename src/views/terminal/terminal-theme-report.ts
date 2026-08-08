/**
 * DECSET 2031 — colour-palette / theme change notifications.
 *
 * A program that wants its own colours to sit well on the terminal's
 * background enables `CSI ? 2031 h`. From then on the terminal is
 * expected to tell it whenever the palette flips between dark and light,
 * with `CSI ? 997 ; 1 n` (dark) or `CSI ? 997 ; 2 n` (light). Claude
 * Code drives this mode; so do modern TUI toolkits.
 *
 * xterm.js 6.0 has no implementation — `2031` does not appear in the
 * bundle at all — so the request is parsed and forgotten, and a program
 * that asked politely never hears back.
 *
 * ## Why τ-mux is unusually well placed here
 *
 * Every other terminal has one palette per window. τ-mux themes are a
 * setting with twelve presets, and the terminal that is being reported
 * on is a *pane* — so a program can be told about the exact surface it
 * is drawing into. Switching preset re-themes running agent CLIs in
 * place, with no restart and no config.
 *
 * ## Initial state is deliberately not reported
 *
 * The spec defines the notification as fired *on change*. A program that
 * wants the current value asks with an OSC 11 query, which xterm already
 * answers using the pane's configured background — so the startup path
 * works without us inventing an unsolicited report that a strict parser
 * would not expect.
 *
 * ## Handlers return false, always
 *
 * A registered CSI handler that returns `true` consumes the sequence and
 * xterm's own handler never runs. `CSI ? 1049 ; 2031 h` is legal, so
 * consuming it would silently break the alternate screen. We only ever
 * observe.
 */

/** Reply for a dark palette. */
export const THEME_REPORT_DARK = "\x1b[?997;1n";
/** Reply for a light palette. */
export const THEME_REPORT_LIGHT = "\x1b[?997;2n";

/** The DEC private mode number for theme-change notifications. */
export const THEME_NOTIFY_MODE = 2031;

/** Structural slice of xterm's parser API. Optional throughout: the
 *  happy-dom SurfaceManager mock implements none of it. */
interface CsiCapableTerminal {
  parser?: {
    registerCsiHandler?: (
      id: { prefix?: string; intermediates?: string; final: string },
      cb: (params: (number | number[])[]) => boolean,
    ) => unknown;
  };
}

export interface ThemeReporter {
  /** True once the program has asked to be told about theme changes. */
  readonly subscribed: boolean;
  /** Report the current palette, if anyone subscribed. Safe to call on
   *  every settings apply — it no-ops when nothing asked, and when the
   *  reported polarity has not changed since the last report. */
  report(isDark: boolean): void;
}

/**
 * Watch for `CSI ? 2031 h` / `l` on `term` and return a reporter that
 * writes notifications back to the PTY via `write`.
 *
 * `write` goes to the PTY's *stdin* — this is a reply from the terminal
 * to the program, the same direction as a keystroke.
 */
export function installThemeReporting(
  term: CsiCapableTerminal,
  write: (data: string) => void,
): ThemeReporter {
  let subscribed = false;
  // Remembering what we last said avoids re-reporting on every settings
  // apply — the user dragging a slider must not spray DSR replies into
  // a program's stdin.
  let lastReportedDark: boolean | null = null;

  const register = term.parser?.registerCsiHandler;
  if (register) {
    const setMode = (params: (number | number[])[], on: boolean): boolean => {
      for (const p of params) {
        // A parameter may be a sub-parameter array (`2031:1`); the mode
        // number is its head either way.
        const value = Array.isArray(p) ? p[0] : p;
        if (value === THEME_NOTIFY_MODE) {
          subscribed = on;
          if (!on) lastReportedDark = null;
        }
      }
      return false; // observe only — see the module header
    };
    register.call(term.parser, { prefix: "?", final: "h" }, (params) =>
      setMode(params, true),
    );
    register.call(term.parser, { prefix: "?", final: "l" }, (params) =>
      setMode(params, false),
    );
  }

  return {
    get subscribed() {
      return subscribed;
    },
    report(isDark: boolean) {
      if (!subscribed) return;
      if (lastReportedDark === isDark) return;
      lastReportedDark = isDark;
      write(isDark ? THEME_REPORT_DARK : THEME_REPORT_LIGHT);
    },
  };
}

/**
 * Whether a background colour reads as dark, by relative luminance.
 *
 * Uses the sRGB coefficients rather than a plain average because green
 * dominates perceived brightness — an average calls `#008000` dark when
 * light text on it is unreadable. The 0.5 cut is the midpoint of the
 * same scale WCAG contrast is built on.
 *
 * Unparseable input answers `true`: τ-mux's own default is dark, and a
 * program told "dark" on a dark terminal is right, while the reverse is
 * the failure mode that produces unreadable output.
 */
export function isDarkBackground(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return true;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}
