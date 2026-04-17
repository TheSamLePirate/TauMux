/**
 * Daily-driver-safe activation policy (doc/native-e2e-plan.md §8.2).
 *
 * Calls `[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory]`
 * via Bun FFI into libobjc so an e2e test run does NOT:
 *   - show up in the Dock,
 *   - steal keyboard focus from the user's daily-driver HyperTerm,
 *   - participate in ⌘+Tab cycling,
 *   - register as a recent application.
 *
 * We also push new windows below normal level so even a brief activation
 * (e.g. the initial BrowserWindow show) doesn't cover the user's work.
 *
 * The FFI surface is intentionally minimal: two selectors, one
 * enum value. Defined twice because `objc_msgSend`'s ABI varies with
 * the callee's argument types and Bun FFI bakes the signature at
 * `dlopen` time — once for the zero-arg `sharedApplication` call and
 * once for the NSInteger-taking `setActivationPolicy:`.
 */

import { dlopen, FFIType, type Pointer } from "bun:ffi";
import { ptr } from "bun:ffi";

// NSApplicationActivationPolicyRegular = 0
// NSApplicationActivationPolicyAccessory = 1
// NSApplicationActivationPolicyProhibited = 2
export const NSApplicationActivationPolicyAccessory = 1;

// Two-dlopens pattern: each dlopen freezes its own argument signature
// for `objc_msgSend`, and we need two different call shapes. Both are
// cheap — libobjc is already loaded in-process.

const cstr = (s: string): Uint8Array => new TextEncoder().encode(s + "\0");

let cached: {
  setAppActivationPolicy: (policy: number) => void;
  getMainWindowNumber: () => number | null;
} | null = null;

function load(): {
  setAppActivationPolicy: (policy: number) => void;
  getMainWindowNumber: () => number | null;
} {
  if (cached) return cached;

  const common = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    objc_msgSend: {
      // Used for every zero-extra-arg call site:
      //   [NSApplication sharedApplication]
      //   [NSApp windows]
      //   [NSApp mainWindow]
      //   [NSApp keyWindow]
      //   [windowsArray firstObject]
      //   [window windowNumber]      (returns NSInteger — fits in ptr on arm64)
      //   [windowsArray count]
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
  });
  const sendInt = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_msgSend: {
      // `[NSApp setActivationPolicy: NSInteger]` — (id, SEL, long) → BOOL
      args: [FFIType.ptr, FFIType.ptr, FFIType.i64],
      returns: FFIType.bool,
    },
  });

  const getNSApp = (): Pointer => {
    const klass = common.symbols.objc_getClass(ptr(cstr("NSApplication")));
    if (!klass) throw new Error("objc_getClass(NSApplication) returned null");
    const sharedSel = common.symbols.sel_registerName(
      ptr(cstr("sharedApplication")),
    );
    const nsApp = common.symbols.objc_msgSend(klass, sharedSel);
    if (!nsApp) throw new Error("NSApp sharedApplication returned null");
    return nsApp as Pointer;
  };

  const setAppActivationPolicy = (policy: number): void => {
    const nsApp = getNSApp();
    const setPolicySel = common.symbols.sel_registerName(
      ptr(cstr("setActivationPolicy:")),
    );
    sendInt.symbols.objc_msgSend(nsApp, setPolicySel as Pointer, policy);
  };

  const getMainWindowNumber = (): number | null => {
    const nsApp = getNSApp();
    // Prefer main → key → first window — the test app usually has exactly
    // one window, but be forgiving if someone opens auxiliary panels.
    const mainSel = common.symbols.sel_registerName(ptr(cstr("mainWindow")));
    const keySel = common.symbols.sel_registerName(ptr(cstr("keyWindow")));
    const windowsSel = common.symbols.sel_registerName(ptr(cstr("windows")));
    const firstSel = common.symbols.sel_registerName(ptr(cstr("firstObject")));
    const countSel = common.symbols.sel_registerName(ptr(cstr("count")));
    const windowNumSel = common.symbols.sel_registerName(
      ptr(cstr("windowNumber")),
    );

    const tryWindow = (win: Pointer | null | undefined): number | null => {
      if (!win) return null;
      const num = common.symbols.objc_msgSend(win as Pointer, windowNumSel);
      // `objc_msgSend` here returns the NSInteger as a pointer-sized value —
      // Bun's FFI hands us either `number` or `bigint` depending on size.
      // Normalise to `number`. Window numbers are 32-bit in practice.
      const asNum =
        typeof num === "bigint" ? Number(num) : Number((num as unknown) ?? 0);
      return Number.isFinite(asNum) && asNum > 0 ? asNum : null;
    };

    const main = common.symbols.objc_msgSend(nsApp, mainSel);
    const fromMain = tryWindow(main as Pointer | null);
    if (fromMain) return fromMain;

    const key = common.symbols.objc_msgSend(nsApp, keySel);
    const fromKey = tryWindow(key as Pointer | null);
    if (fromKey) return fromKey;

    const windows = common.symbols.objc_msgSend(nsApp, windowsSel);
    if (!windows) return null;
    const count = common.symbols.objc_msgSend(windows as Pointer, countSel);
    if (!count) return null;
    const first = common.symbols.objc_msgSend(windows as Pointer, firstSel);
    return tryWindow(first as Pointer | null);
  };

  cached = { setAppActivationPolicy, getMainWindowNumber };
  return cached;
}

/**
 * Switch the running process to accessory activation policy. Safe to call
 * multiple times; NSApp tolerates redundant policy changes. Must run AFTER
 * Electrobun has instantiated NSApp (it does so when the first
 * BrowserWindow is constructed) — calling earlier is a no-op because
 * `sharedApplication` would create a Regular-policy NSApp behind us.
 *
 * Returns true on success, false if FFI couldn't load (non-macOS, hardened
 * runtime blocks, missing library). Never throws.
 */
export function switchToAccessoryMode(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const { setAppActivationPolicy } = load();
    setAppActivationPolicy(NSApplicationActivationPolicyAccessory);
    return true;
  } catch (err) {
    console.warn(
      "[accessory] could not switch activation policy:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Resolve the macOS `CGWindowID` of this process's main NSWindow. Returns
 * null if no window is live yet or the FFI call fails. Used by the e2e
 * screenshot helper to pass `screencapture -l <id>` — which produces a
 * tight window crop rather than a full-display capture.
 *
 * `[NSWindow windowNumber]` returns an NSInteger that's *equivalent* to
 * the CGWindowID on modern macOS (documented since 10.5). No CoreGraphics
 * enumeration needed.
 */
export function getMainWindowId(): number | null {
  if (process.platform !== "darwin") return null;
  try {
    const { getMainWindowNumber } = load();
    return getMainWindowNumber();
  } catch (err) {
    console.warn(
      "[accessory] could not resolve main window id:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
