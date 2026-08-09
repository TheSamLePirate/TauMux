/**
 * Run `action` once a named CSS transition on `el` finishes.
 *
 * Replaces blind `setTimeout(…, 220)` waits with the real signal that a
 * layout settled — which matters for xterm, whose fit must be computed
 * against the width the column actually lands on, not the one it started
 * from. Keeps a fallback timer because a transition legitimately may not
 * fire at all: reduced motion, a `display` change, or an identical
 * computed value all skip it.
 */
export function afterTransition(
  el: HTMLElement,
  property: string,
  fallbackMs: number,
  action: () => void,
): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.removeEventListener("transitionend", handler);
    action();
  };
  const handler = (e: TransitionEvent) => {
    if (e.target !== el || e.propertyName !== property) return;
    finish();
  };
  el.addEventListener("transitionend", handler);
  setTimeout(finish, fallbackMs);
}
