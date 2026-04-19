// Webview-side bindings for the shared audio helper. Holds the
// relative path the Electrobun webview resolves against its own
// `index.html`, plus a tiny in-memory cache of the
// notification-sound settings so every play respects the user's
// current toggle + volume without re-reading the full settings object.

import { playNotificationSound as play } from "../../shared/sounds";

const NOTIFICATION_SOUND_URL = "audio/finish.mp3";

let enabled = true;
let volume = 1;

/** Called by `applySettings` on every settings apply. We keep the
 *  values in module state so `playNotificationSound()` stays a
 *  zero-argument call at every site that triggers the cue. */
export function setNotificationSoundSettings(opts: {
  enabled: boolean;
  volume: number;
}): void {
  enabled = opts.enabled;
  volume = opts.volume;
}

export function getNotificationSoundEnabled(): boolean {
  return enabled;
}

export function playNotificationSound(): void {
  play(NOTIFICATION_SOUND_URL, { enabled, volume });
}
