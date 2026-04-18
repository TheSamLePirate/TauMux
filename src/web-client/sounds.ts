// One-shot notification sounds for the web mirror. Cached HTMLAudioElement
// per source so bursts of notifications don't leak DOM elements. Failures
// are swallowed — the cue is a nice-to-have, never required for
// correctness. Autoplay policies will block playback until the user has
// interacted with the page; we just let those attempts fail silently.

const cache = new Map<string, HTMLAudioElement>();

function getAudio(src: string): HTMLAudioElement {
  let el = cache.get(src);
  if (!el) {
    el = new Audio(src);
    el.preload = "auto";
    cache.set(src, el);
  }
  return el;
}

export function playNotificationSound(): void {
  try {
    const audio = getAudio("/audio/finish.mp3");
    audio.currentTime = 0;
    void audio.play().catch(() => {
      /* autoplay blocked or file missing — ignore */
    });
  } catch {
    /* older browsers that throw synchronously on play() */
  }
}
