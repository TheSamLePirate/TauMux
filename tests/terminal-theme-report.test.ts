/**
 * DECSET 2031 — theme-change notifications.
 *
 * xterm 6.0 does not implement mode 2031 at all, so a program that asks
 * to be told about palette changes is answered with silence. These tests
 * pin the observe-don't-consume contract (a handler that returned `true`
 * would eat `CSI ? 1049 ; 2031 h` and break the alternate screen) and
 * the no-spam rule.
 */
import { describe, test, expect } from "bun:test";
import {
  THEME_REPORT_DARK,
  THEME_REPORT_LIGHT,
  installThemeReporting,
  isDarkBackground,
} from "../src/views/terminal/terminal-theme-report";

function fakeTerm() {
  const handlers: Record<string, (p: (number | number[])[]) => boolean> = {};
  return {
    term: {
      parser: {
        registerCsiHandler: (
          id: { prefix?: string; final: string },
          cb: (p: (number | number[])[]) => boolean,
        ) => {
          handlers[`${id.prefix ?? ""}${id.final}`] = cb;
        },
      },
    },
    set: (params: (number | number[])[]) => handlers["?h"]!(params),
    reset: (params: (number | number[])[]) => handlers["?l"]!(params),
  };
}

function setup() {
  const f = fakeTerm();
  const writes: string[] = [];
  const reporter = installThemeReporting(f.term, (d) => writes.push(d));
  return { ...f, writes, reporter };
}

describe("DECSET 2031 subscription", () => {
  test("nothing is reported before the program asks", () => {
    const s = setup();
    expect(s.reporter.subscribed).toBe(false);
    s.reporter.report(true);
    expect(s.writes).toEqual([]);
  });

  test("CSI ? 2031 h subscribes; a change is then reported", () => {
    const s = setup();
    s.set([2031]);
    expect(s.reporter.subscribed).toBe(true);
    s.reporter.report(true);
    expect(s.writes).toEqual([THEME_REPORT_DARK]);
  });

  test("light reports the other code", () => {
    const s = setup();
    s.set([2031]);
    s.reporter.report(false);
    expect(s.writes).toEqual([THEME_REPORT_LIGHT]);
  });

  test("CSI ? 2031 l unsubscribes", () => {
    const s = setup();
    s.set([2031]);
    s.reset([2031]);
    expect(s.reporter.subscribed).toBe(false);
    s.reporter.report(true);
    expect(s.writes).toEqual([]);
  });

  test("mode 2031 inside a multi-parameter set is recognised", () => {
    const s = setup();
    s.set([1049, 2004, 2031]);
    expect(s.reporter.subscribed).toBe(true);
  });

  test("sub-parameter form (2031:1) is recognised", () => {
    const s = setup();
    s.set([[2031, 1]]);
    expect(s.reporter.subscribed).toBe(true);
  });

  test("unrelated modes do not subscribe", () => {
    const s = setup();
    s.set([1049, 2004, 2026]);
    expect(s.reporter.subscribed).toBe(false);
  });

  test("handlers always return false so xterm still processes the mode", () => {
    // Returning true would consume `CSI ? 1049 ; 2031 h` and silently
    // break the alternate screen for every program that combines them.
    const s = setup();
    expect(s.set([2031])).toBe(false);
    expect(s.reset([2031])).toBe(false);
    expect(s.set([1049])).toBe(false);
  });
});

describe("report throttling", () => {
  test("an unchanged polarity is not re-reported", () => {
    // applySettings runs on every slider drag; each one must not spray
    // a DSR reply into the program's stdin.
    const s = setup();
    s.set([2031]);
    s.reporter.report(true);
    s.reporter.report(true);
    s.reporter.report(true);
    expect(s.writes).toEqual([THEME_REPORT_DARK]);
  });

  test("flipping back and forth reports each transition", () => {
    const s = setup();
    s.set([2031]);
    s.reporter.report(true);
    s.reporter.report(false);
    s.reporter.report(true);
    expect(s.writes).toEqual([
      THEME_REPORT_DARK,
      THEME_REPORT_LIGHT,
      THEME_REPORT_DARK,
    ]);
  });

  test("re-subscribing resets the memory, so the next report lands", () => {
    const s = setup();
    s.set([2031]);
    s.reporter.report(true);
    s.reset([2031]);
    s.set([2031]);
    s.reporter.report(true);
    expect(s.writes).toEqual([THEME_REPORT_DARK, THEME_REPORT_DARK]);
  });
});

describe("isDarkBackground", () => {
  test("classifies the obvious cases", () => {
    expect(isDarkBackground("#000000")).toBe(true);
    expect(isDarkBackground("#ffffff")).toBe(false);
  });

  test("weights green the way perception does", () => {
    // A plain RGB average calls #008000 dark; it is not — light text on
    // it is unreadable.
    expect(isDarkBackground("#00ff00")).toBe(false);
    expect(isDarkBackground("#0000ff")).toBe(true);
  });

  test("accepts a missing leading hash and stray whitespace", () => {
    expect(isDarkBackground(" 111111 ")).toBe(true);
  });

  test("falls back to dark on unparseable input", () => {
    // τ-mux's own default is dark; telling a program "light" when we do
    // not know produces unreadable output, the reverse does not.
    expect(isDarkBackground("")).toBe(true);
    expect(isDarkBackground("rebeccapurple")).toBe(true);
    expect(isDarkBackground("#fff")).toBe(true);
  });
});

describe("terminals without a parser", () => {
  test("install is safe and the reporter stays inert", () => {
    const writes: string[] = [];
    const reporter = installThemeReporting({}, (d) => writes.push(d));
    expect(reporter.subscribed).toBe(false);
    reporter.report(true);
    expect(writes).toEqual([]);
  });
});
