// Shared audio helper for one-shot UI cues (notifications, etc). A
// single HTMLAudioElement is cached per source URL so bursts of plays
// don't leak DOM elements. `currentTime = 0` rewinds between plays.
// Playback failures (autoplay policy, missing file, older browsers
// throwing synchronously) are swallowed — sounds are always nice-to-
// have, never load-bearing for correctness.
//
// The same module runs in two places that resolve URLs differently:
//   - Electrobun webview: relative paths like "audio/finish.mp3".
//   - Web mirror (browser, HTTP server): absolute paths like "/audio/finish.mp3".
// Callers pass whichever form the bundle expects.

type AudioCtor = new (src?: string) => HTMLAudioElement;

const cache = new Map<string, HTMLAudioElement>();

/** Injection hook for tests. Production code falls back to the global
 *  `Audio` constructor in the browser environment. */
let audioFactory: AudioCtor | null = null;

/** Test seam — supply a fake Audio ctor. Pass `null` to restore the
 *  global. Tests should reset this in an `afterEach` to avoid leaking
 *  state between cases. */
export function __setAudioFactory(factory: AudioCtor | null): void {
  audioFactory = factory;
  cache.clear();
}

function getAudio(src: string): HTMLAudioElement {
  let el = cache.get(src);
  if (!el) {
    const Ctor = audioFactory ?? (globalThis as { Audio?: AudioCtor }).Audio;
    if (!Ctor) throw new Error("Audio is not available in this environment");
    el = new Ctor(src);
    el.preload = "auto";
    cache.set(src, el);
  }
  return el;
}

/** Play the notification-arrival cue. `src` is resolved relative to
 *  whatever the host expects (webview: relative, web mirror: absolute). */
export function playNotificationSound(src: string): void {
  try {
    const audio = getAudio(src);
    audio.currentTime = 0;
    const result = audio.play();
    if (result && typeof result.catch === "function") {
      void result.catch(() => {
        /* autoplay blocked or file missing — ignore */
      });
    }
  } catch {
    /* older browsers that throw synchronously on play() */
  }
}
