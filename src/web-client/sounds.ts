// Web-mirror bindings for the shared audio helper. The mirror fetches
// the mp3 from the Bun HTTP server's /audio/ route.
//
// Browsers block `Audio.play()` until the page has received a user
// gesture. Without a primer, the first notification that arrives on a
// freshly-opened tab silently fails — and depending on the browser,
// subsequent plays may fail too even after the user has clicked. So on
// the first pointerdown/keydown/touchstart we pre-play the real
// notification sound at volume 0: the play promise resolves, the audio
// element enters the user-activated state, and from that point on any
// real `playNotificationSound()` call works.
//
// If the priming attempt itself fails (old browser, very strict
// policy), we leave the listeners in place so the next gesture retries.

import { playNotificationSound as play } from "../shared/sounds";

const NOTIFICATION_SOUND_URL = "/audio/finish.mp3";
const SOUND_ENABLED_KEY = "ht:notification-sound-enabled";
const SOUND_VOLUME_KEY = "ht:notification-sound-volume";

/** The web mirror stores its own notification-sound prefs in
 *  localStorage — independent of the native AppSettings so the user can
 *  mute the browser tab without affecting the desktop app. Reads are
 *  tolerant: missing/invalid entries fall back to enabled + volume 1. */
function loadEnabled(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(SOUND_ENABLED_KEY);
    if (raw === null || raw === undefined) return true;
    return raw !== "0" && raw.toLowerCase() !== "false";
  } catch {
    return true;
  }
}

function loadVolume(): number {
  try {
    const raw = globalThis.localStorage?.getItem(SOUND_VOLUME_KEY);
    if (!raw) return 1;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return 1;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  } catch {
    return 1;
  }
}

let enabled = loadEnabled();
let volume = loadVolume();

export function setNotificationSoundSettings(opts: {
  enabled?: boolean;
  volume?: number;
}): void {
  if (typeof opts.enabled === "boolean") {
    enabled = opts.enabled;
    try {
      globalThis.localStorage?.setItem(SOUND_ENABLED_KEY, enabled ? "1" : "0");
    } catch {
      /* private mode / quota — silently continue */
    }
  }
  if (typeof opts.volume === "number" && Number.isFinite(opts.volume)) {
    volume = Math.max(0, Math.min(1, opts.volume));
    try {
      globalThis.localStorage?.setItem(SOUND_VOLUME_KEY, String(volume));
    } catch {
      /* ignore */
    }
  }
}

export function getNotificationSoundEnabled(): boolean {
  return enabled;
}

let audioUnlocked = false;

function attemptUnlock(): void {
  if (audioUnlocked) return;
  try {
    const Ctor = (
      globalThis as { Audio?: new (src?: string) => HTMLAudioElement }
    ).Audio;
    if (!Ctor) return;
    const probe = new Ctor(NOTIFICATION_SOUND_URL);
    probe.volume = 0;
    const result = probe.play();
    if (result && typeof result.then === "function") {
      void result
        .then(() => {
          audioUnlocked = true;
          probe.pause();
          probe.currentTime = 0;
          removeUnlockListeners();
        })
        .catch(() => {
          /* still locked — retry on the next gesture */
        });
    } else {
      // Sync-resolving play (some older runtimes) — optimistically flag
      // as unlocked; subsequent real plays will fail safely if wrong.
      audioUnlocked = true;
      removeUnlockListeners();
    }
  } catch {
    /* noop — retry on next gesture */
  }
}

function removeUnlockListeners(): void {
  if (typeof window === "undefined") return;
  window.removeEventListener("pointerdown", attemptUnlock, true);
  window.removeEventListener("keydown", attemptUnlock, true);
  window.removeEventListener("touchstart", attemptUnlock, true);
}

if (typeof window !== "undefined") {
  // Capture phase so we fire before any element.stopPropagation() or
  // preventDefault() that downstream code might call.
  window.addEventListener("pointerdown", attemptUnlock, true);
  window.addEventListener("keydown", attemptUnlock, true);
  window.addEventListener("touchstart", attemptUnlock, true);
}

export function playNotificationSound(): void {
  play(NOTIFICATION_SOUND_URL, { enabled, volume });
}
