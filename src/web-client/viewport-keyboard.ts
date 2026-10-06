/**
 * iOS software-keyboard occlusion tracking.
 *
 * The viewport meta uses `interactive-widget=resizes-content`, but that
 * keyword is Chromium-only: on iOS Safari the software keyboard
 * OVERLAYS the page instead of resizing the layout viewport, so
 * `position: fixed; bottom: 0` elements — the key-accessory toolbar —
 * and the terminal's last rows end up behind the keyboard.
 *
 * The fix is the standard `visualViewport` computation: the occluded
 * strip at the bottom is `innerHeight - visualViewport.height -
 * visualViewport.offsetTop`. We publish it as the `--kbd-occlusion`
 * CSS variable on :root; the toolbar and the pane container consume
 * it. On desktop and on browsers where the layout viewport already
 * shrinks, the value is 0 and nothing changes.
 */

export function installViewportKeyboardTracking(): void {
  const vv = window.visualViewport;
  if (!vv) return; // older engines — graceful no-op

  const root = document.documentElement;
  const update = () => {
    const occluded = Math.max(
      0,
      window.innerHeight - vv.height - vv.offsetTop,
    );
    root.style.setProperty("--kbd-occlusion", `${Math.round(occluded)}px`);
  };
  vv.addEventListener("resize", update);
  // iOS fires scroll (not resize) as the keyboard animates and the
  // visible pan shifts.
  vv.addEventListener("scroll", update);
  update();
}
