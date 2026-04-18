// Small audio helper for one-shot notification sounds. A single
// HTMLAudioElement is cached per source and rewound before every play so
// bursts of notifications don't leak DOM elements. Playback failures
// (autoplay policy, missing file) are swallowed — the sound is a nice-to-
// have cue, never required for correctness.

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
    const audio = getAudio("audio/finish.mp3");
    audio.currentTime = 0;
    void audio.play().catch(() => {
      /* autoplay blocked or file missing — ignore */
    });
  } catch {
    /* older browsers that throw synchronously on play() */
  }
}
