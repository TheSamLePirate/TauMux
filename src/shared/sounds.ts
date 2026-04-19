// Shared audio helper for one-shot UI cues (notifications, etc).
//
// We keep a cached "template" HTMLAudioElement per source URL for
// preload (so the MP3 isn't re-fetched on every play), but we
// `cloneNode()` that template on every invocation and play the clone.
// Reusing the same element across plays is unreliable on WebKit —
// after the first play, `currentTime = 0` + `.play()` often silently
// succeeds without producing any sound. Cloning gives each trigger a
// fresh, independent state machine, and the browser reuses the already-
// decoded audio data on the clone. Electrobun's WebKit webview and the
// web mirror's browser both ship this behavior.
//
// Playback failures (autoplay policy, missing file, older browsers
// throwing synchronously) are swallowed — sounds are always nice-to-
// have, never load-bearing for correctness.
//
// The same module runs in two places that resolve URLs differently:
//   - Electrobun webview: relative paths like "audio/finish.mp3".
//   - Web mirror (browser, HTTP server): absolute paths like "/audio/finish.mp3".
// Callers pass whichever form the bundle expects.

type AudioCtor = new (src?: string) => HTMLAudioElement;

const templates = new Map<string, HTMLAudioElement>();

/** Injection hook for tests. Production code falls back to the global
 *  `Audio` constructor in the browser environment. */
let audioFactory: AudioCtor | null = null;

/** Test seam — supply a fake Audio ctor. Pass `null` to restore the
 *  global. Tests should reset this in an `afterEach` to avoid leaking
 *  state between cases. */
export function __setAudioFactory(factory: AudioCtor | null): void {
  audioFactory = factory;
  templates.clear();
}

function getTemplate(src: string): HTMLAudioElement {
  let el = templates.get(src);
  if (!el) {
    const Ctor = audioFactory ?? (globalThis as { Audio?: AudioCtor }).Audio;
    if (!Ctor) throw new Error("Audio is not available in this environment");
    el = new Ctor(src);
    el.preload = "auto";
    templates.set(src, el);
  }
  return el;
}

export interface PlayOptions {
  /** When explicitly `false`, the call is a no-op. Lets the host gate
   *  the cue from a settings store without wrapping every call site in
   *  an if-guard. Defaults to `true`. */
  enabled?: boolean;
  /** Playback volume, clamped to [0, 1]. Applied to the cloned
   *  instance so concurrent plays at different volumes don't stomp on
   *  each other. Defaults to 1. */
  volume?: number;
}

function clampVolume(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Play the notification-arrival cue. `src` is resolved relative to
 *  whatever the host expects (webview: relative, web mirror: absolute).
 *  Each call plays a fresh cloned element so repeated triggers play
 *  reliably on WebKit (which silently stalls on reused <audio> nodes
 *  after their first play-through). */
export function playNotificationSound(
  src: string,
  opts: PlayOptions = {},
): void {
  if (opts.enabled === false) return;
  try {
    const template = getTemplate(src);
    // Clone first, then fall back to `new Audio(src)` if the clone
    // didn't give us a playable element (happens on fake test ctors
    // that don't implement cloneNode).
    let instance: HTMLAudioElement;
    const cloneFn = (template as { cloneNode?: (deep?: boolean) => Node })
      .cloneNode;
    if (typeof cloneFn === "function") {
      instance = cloneFn.call(template, false) as HTMLAudioElement;
    } else {
      const Ctor = audioFactory ?? (globalThis as { Audio?: AudioCtor }).Audio;
      if (!Ctor) throw new Error("Audio is not available in this environment");
      instance = new Ctor(src);
    }
    // Volume goes on the clone, not the template — each playback
    // instance owns its level, so a mid-drag slider tweak doesn't
    // retroactively mute already-playing cues.
    if (opts.volume !== undefined) {
      instance.volume = clampVolume(opts.volume);
    }
    const result = instance.play();
    if (result && typeof result.catch === "function") {
      void result.catch(() => {
        /* autoplay blocked or file missing — ignore */
      });
    }
  } catch {
    /* older browsers that throw synchronously on play() */
  }
}
