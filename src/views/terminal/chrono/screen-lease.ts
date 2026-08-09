/**
 * Screen lease — borrowing a live pane's DOM into another view.
 *
 * CHRONO shows each pane's *real* terminal at the right edge of its lane.
 * There is exactly one `Terminal` per surface, so the only honest way to
 * do that is to move the pane's own `.surface-container` into the lane
 * and give it back when the view closes. No second instance, no mirror,
 * no `pty.resize` — the same live element, in a different box.
 *
 * That is a genuinely dangerous move: the element belongs to
 * `SurfaceManager`, which positions it absolutely inside
 * `#terminal-container` and expects to find it there. Getting the
 * handover wrong strands the user's panes — an empty window with live
 * shells behind it. So the borrow is a **lease**, and the lease is the
 * whole of the safety story:
 *
 *  1. The view never holds a container it cannot give back. `borrow()`
 *     refuses an element that has no parent to return to.
 *  2. `release()` is idempotent and total. Calling it twice, or on a
 *     surface that was never borrowed, does nothing.
 *  3. Every exit path — Esc, ⌘G, workspace switch, surface close, app
 *     teardown — routes through `releaseAll()`.
 *  4. A container that has moved on without us (its surface closed, and
 *     `SurfaceManager` removed the element) is dropped rather than
 *     resurrected into a layout it no longer belongs to.
 *
 * While borrowed the container carries `data-chrono-lease`, which is
 * both the CSS hook for the lane presentation and the flag
 * `SurfaceManager.applyPositions` reads to leave the geometry alone.
 * The pane's own inline style is captured verbatim on borrow and written
 * back verbatim on release, so a pane from a background workspace goes
 * home still `display: none` and a pane from the active one goes home at
 * exactly the rect it left.
 */

/** `dataset` key stamped on a borrowed container. Kept here because
 *  `SurfaceManager` reads it to skip leased panes during layout — one
 *  name, one place. */
export const LEASE_FLAG = "chronoLease";

interface Lease {
  el: HTMLElement;
  /** Where the element lived before we took it. */
  parent: ParentNode;
  /** Its position among its siblings, so release is order-preserving. */
  nextSibling: ChildNode | null;
  /** Verbatim inline style at borrow time. */
  cssText: string;
  /** `applyPositions`' rect signature, so the pane doesn't skip its next
   *  layout because a stale signature says it is already correct. */
  layoutSig: string | undefined;
  /** The element we lent it to. Used to detect a container that has
   *  since been taken elsewhere. */
  slot: HTMLElement;
}

export class ScreenLeases {
  private readonly leases = new Map<string, Lease>();

  /** Surfaces currently borrowed. */
  get size(): number {
    return this.leases.size;
  }

  isLeased(surfaceId: string): boolean {
    return this.leases.has(surfaceId);
  }

  /**
   * Move `el` into `slot` and remember how to give it back.
   *
   * Returns true when the element is (now) in `slot`. Returns false —
   * having changed nothing — when the element has no parent to return
   * to, which is the one case where borrowing could strand a pane.
   *
   * Idempotent: borrowing the same surface into the same slot again is a
   * no-op. Borrowing it into a *different* slot moves it and keeps the
   * original return address, so a lane rebuild cannot lose the pane.
   */
  borrow(surfaceId: string, el: HTMLElement, slot: HTMLElement): boolean {
    const existing = this.leases.get(surfaceId);
    if (existing) {
      if (existing.el !== el) {
        // A different element for the same surface means the pane was
        // rebuilt under us. Return the old one before taking the new.
        this.release(surfaceId);
      } else {
        if (existing.slot !== slot || el.parentNode !== slot) {
          existing.slot = slot;
          slot.appendChild(el);
        }
        return true;
      }
    }

    const parent = el.parentNode;
    if (!parent) return false;

    this.leases.set(surfaceId, {
      el,
      parent,
      nextSibling: el.nextSibling,
      cssText: el.style.cssText,
      layoutSig: el.dataset["layoutSig"],
      slot,
    });
    el.dataset[LEASE_FLAG] = "1";
    // Hand presentation to the stylesheet. The pane arrives carrying the
    // absolute rect `applyPositions` wrote, and an inline rect beats any
    // rule the lane could state; clearing it is what lets
    // `[data-chrono-lease]` own the geometry. The original is captured
    // above and written back verbatim on release.
    el.style.cssText = "";
    slot.appendChild(el);
    return true;
  }

  /**
   * Give `surfaceId`'s container back exactly as it was found.
   *
   * Total by construction: an unknown surface, a double release, a
   * container someone else has already taken, and a recorded sibling
   * that has since been removed all resolve to "do the safe thing"
   * rather than to an exception. This runs on teardown paths, and a
   * throw here would skip the releases queued behind it.
   */
  release(surfaceId: string): void {
    const lease = this.leases.get(surfaceId);
    if (!lease) return;
    this.leases.delete(surfaceId);

    const { el } = lease;
    delete el.dataset[LEASE_FLAG];

    // Not in our slot any more: either the surface closed and
    // `SurfaceManager` detached the container, or something else took
    // it. Either way it is no longer ours to put back, and re-inserting
    // it would resurrect a dead pane into a live layout.
    if (el.parentNode !== lease.slot) return;

    el.style.cssText = lease.cssText;
    if (lease.layoutSig === undefined) delete el.dataset["layoutSig"];
    else el.dataset["layoutSig"] = lease.layoutSig;

    // A sibling recorded at borrow time may have been removed since (a
    // neighbouring pane closed). `insertBefore` throws on a reference
    // node that is no longer a child, so fall back to appending, which
    // is where the pane would have ended up anyway.
    const before =
      lease.nextSibling && lease.nextSibling.parentNode === lease.parent
        ? lease.nextSibling
        : null;
    lease.parent.insertBefore(el, before);
  }

  /** Give every borrowed container back. The only teardown path. */
  releaseAll(): void {
    for (const surfaceId of [...this.leases.keys()]) this.release(surfaceId);
  }
}
