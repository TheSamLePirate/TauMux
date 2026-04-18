// Webview-side bindings for the shared audio helper. Holds the
// relative path the Electrobun webview resolves against its own
// `index.html`.

import { playNotificationSound as play } from "../../shared/sounds";

const NOTIFICATION_SOUND_URL = "audio/finish.mp3";

export function playNotificationSound(): void {
  play(NOTIFICATION_SOUND_URL);
}
