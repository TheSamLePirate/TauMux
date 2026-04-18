// Web-mirror bindings for the shared audio helper. The mirror fetches
// the mp3 from the Bun HTTP server's /audio/ route.

import { playNotificationSound as play } from "../shared/sounds";

const NOTIFICATION_SOUND_URL = "/audio/finish.mp3";

export function playNotificationSound(): void {
  play(NOTIFICATION_SOUND_URL);
}
