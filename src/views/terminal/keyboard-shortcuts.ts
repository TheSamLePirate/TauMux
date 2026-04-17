// Data-driven keyboard shortcut registry.
//
// Each binding carries:
//   - id / description / category: metadata for a future help dialog
//     or command palette that consumes the same source of truth.
//   - when:  optional predicate on the runtime context (e.g. "only
//     when a browser pane is focused"). If false, the binding is
//     skipped.
//   - match: predicate on the KeyboardEvent. The first binding whose
//     match returns true wins.
//   - action: fires on match. preventDefault is called automatically
//     unless `noPreventDefault` is set (the copy binding depends on
//     the default clipboard behavior).
//
// Callers drive the dispatcher with `attachKeyboardShortcuts(el,
// bindings, getContext)`. The returned function detaches the listener.
// The context object is looked up per event so stale closures don't
// trap older state.

export interface Binding<Ctx> {
  id: string;
  description?: string;
  category?: string;
  when?: (ctx: Ctx) => boolean;
  match: (e: KeyboardEvent) => boolean;
  action: (e: KeyboardEvent, ctx: Ctx) => void;
  /** Default: preventDefault on match. Opt out for bindings whose
   *  native default behavior we want (e.g. clipboard copy). */
  noPreventDefault?: boolean;
}

export type KeyMatcher = (e: KeyboardEvent) => boolean;

/** Build a key matcher. Modifiers default to false (must be released);
 *  pass `undefined` to mean "don't care". */
export function keyMatch(spec: {
  key: string | ((k: string) => boolean);
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
  caseInsensitive?: boolean;
}): KeyMatcher {
  return (e: KeyboardEvent) => {
    if (spec.meta !== undefined && e.metaKey !== spec.meta) return false;
    if (spec.shift !== undefined && e.shiftKey !== spec.shift) return false;
    if (spec.alt !== undefined && e.altKey !== spec.alt) return false;
    if (spec.ctrl !== undefined && e.ctrlKey !== spec.ctrl) return false;
    if (typeof spec.key === "function") return spec.key(e.key);
    return spec.caseInsensitive
      ? e.key.toLowerCase() === spec.key.toLowerCase()
      : e.key === spec.key;
  };
}

/** Dispatch an event against a binding table. Returns true if any
 *  binding fired (and thus consumed the event). */
export function dispatchKeyboardEvent<Ctx>(
  e: KeyboardEvent,
  bindings: readonly Binding<Ctx>[],
  ctx: Ctx,
): boolean {
  for (const b of bindings) {
    if (b.when && !b.when(ctx)) continue;
    if (b.match(e)) {
      if (!b.noPreventDefault) e.preventDefault();
      b.action(e, ctx);
      return true;
    }
  }
  return false;
}
