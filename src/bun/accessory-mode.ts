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
} | null = null;

function load(): {
  setAppActivationPolicy: (policy: number) => void;
} {
  if (cached) return cached;

  const common = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    objc_msgSend: {
      // `[NSApplication sharedApplication]` — (class, SEL) → id
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

  const setAppActivationPolicy = (policy: number): void => {
    const nsAppClassName = cstr("NSApplication");
    const sharedAppSelName = cstr("sharedApplication");
    const setPolicySelName = cstr("setActivationPolicy:");

    const klass = common.symbols.objc_getClass(ptr(nsAppClassName));
    if (!klass) throw new Error("objc_getClass(NSApplication) returned null");
    const sharedSel = common.symbols.sel_registerName(ptr(sharedAppSelName));
    const setPolicySel = common.symbols.sel_registerName(ptr(setPolicySelName));

    const nsApp = common.symbols.objc_msgSend(klass, sharedSel);
    if (!nsApp) throw new Error("NSApp sharedApplication returned null");
    sendInt.symbols.objc_msgSend(
      nsApp as Pointer,
      setPolicySel as Pointer,
      policy,
    );
  };

  cached = { setAppActivationPolicy };
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
