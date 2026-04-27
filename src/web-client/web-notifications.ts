// τ-mux web mirror — Web Notifications + Vibration adapter.
//
// When a notification arrives and the document is hidden (tab in
// background, app minimized on mobile), fire a Web Notification so the
// OS surfaces it. On supported devices, also issue a short vibration
// pulse for tactile feedback.
//
// Both behaviours are gated by:
//   - Browser support (graceful no-op when the API is missing)
//   - Per-mirror preference (localStorage; toggled in the mirror's
//     Settings panel)
//   - Permission state (we never auto-request — the user explicitly
//     opts in from the Settings panel)
//
// Pure decision logic (`shouldFireNotification`, `decideVibration`)
// lives at module scope so it can be hermetically tested.

const NOTIF_ENABLED_KEY = "ht:web-notifications-enabled";
const VIBRATE_ENABLED_KEY = "ht:vibration-enabled";

// ── Pure decision helpers ────────────────────────────────────

export interface NotificationDecisionInput {
  /** Document.hidden — true when the tab is backgrounded. */
  documentHidden: boolean;
  /** Permission state from `Notification.permission`. */
  permission: "default" | "granted" | "denied";
  /** Whether the user has enabled notifications in mirror Settings. */
  prefEnabled: boolean;
  /** True when the API is available (Notification in window). */
  apiAvailable: boolean;
}

/** Pure: should the mirror fire an OS-level Notification for the
 *  current notification arrival? */
export function shouldFireNotification(
  input: NotificationDecisionInput,
): boolean {
  if (!input.apiAvailable) return false;
  if (!input.prefEnabled) return false;
  if (input.permission !== "granted") return false;
  // Only when backgrounded — when the tab is on screen, the in-app
  // sidebar notification is the right surface.
  return input.documentHidden;
}

export interface VibrationDecisionInput {
  prefEnabled: boolean;
  apiAvailable: boolean;
  /** Optional severity boost from the protocol payload (errors get
   *  a longer pulse). Currently unused; reserved for future use. */
  severity?: "info" | "warning" | "error";
}

/** Pure: classify the vibration pattern (in ms) for a notification
 *  arrival. Returns null when no vibration should fire. */
export function decideVibration(
  input: VibrationDecisionInput,
): number[] | null {
  if (!input.apiAvailable) return null;
  if (!input.prefEnabled) return null;
  if (input.severity === "error") return [40, 60, 40, 60, 80];
  if (input.severity === "warning") return [40, 60, 40];
  return [40];
}

// ── Pref persistence ─────────────────────────────────────────

function readPref(key: string, def: boolean): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined) return def;
    return raw === "1" || raw.toLowerCase() === "true";
  } catch {
    return def;
  }
}

function writePref(key: string, val: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, val ? "1" : "0");
  } catch {
    /* private mode / quota — silently skip */
  }
}

export function getNotificationsEnabled(): boolean {
  return readPref(NOTIF_ENABLED_KEY, true);
}

export function setNotificationsEnabled(enabled: boolean): void {
  writePref(NOTIF_ENABLED_KEY, enabled);
}

export function getVibrationEnabled(): boolean {
  return readPref(VIBRATE_ENABLED_KEY, true);
}

export function setVibrationEnabled(enabled: boolean): void {
  writePref(VIBRATE_ENABLED_KEY, enabled);
}

// ── Capability probes ────────────────────────────────────────

/** True when this runtime exposes the Notification API. */
export function notificationApiAvailable(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as unknown as { Notification?: unknown })
      .Notification !== "undefined"
  );
}

/** True when this runtime exposes the Vibration API. */
export function vibrationApiAvailable(): boolean {
  if (typeof globalThis === "undefined") return false;
  const nav = (globalThis as unknown as { navigator?: Navigator }).navigator;
  return !!nav && typeof nav.vibrate === "function";
}

/** Read the current Notification permission, defaulting to "default"
 *  when the API is missing. */
export function notificationPermission(): "default" | "granted" | "denied" {
  if (!notificationApiAvailable()) return "default";
  const N = (
    globalThis as unknown as {
      Notification: { permission?: NotificationPermission };
    }
  ).Notification;
  const p = N.permission;
  if (p === "granted" || p === "denied") return p;
  return "default";
}

/** Ask for permission; resolves to the resulting state. Idempotent —
 *  modern browsers cache the answer. */
export async function requestNotificationPermission(): Promise<
  "default" | "granted" | "denied"
> {
  if (!notificationApiAvailable()) return "default";
  const N = (
    globalThis as unknown as {
      Notification: {
        permission: NotificationPermission;
        requestPermission?: () => Promise<NotificationPermission>;
      };
    }
  ).Notification;
  if (typeof N.requestPermission !== "function")
    return notificationPermission();
  try {
    const result = await N.requestPermission();
    if (result === "granted" || result === "denied") return result;
    return "default";
  } catch {
    return notificationPermission();
  }
}

// ── Side effects ─────────────────────────────────────────────

export interface FireNotificationInput {
  title: string;
  body: string;
  /** A stable tag so repeated alerts replace the previous one in the
   *  notification tray instead of stacking. */
  tag?: string;
  /** Severity hint, surfaced through vibration pattern selection. */
  severity?: "info" | "warning" | "error";
  /** Optional click handler — focuses the tab when the user taps. */
  onClick?: () => void;
}

/** Fire a Web Notification + vibrate, both gated by their respective
 *  decision helpers. Safe to call from anywhere — performs zero
 *  side effects when the conditions don't match. */
export function fireNotification(input: FireNotificationInput): void {
  const docHidden =
    typeof document !== "undefined" ? document.hidden === true : false;
  const fireNotif = shouldFireNotification({
    documentHidden: docHidden,
    permission: notificationPermission(),
    prefEnabled: getNotificationsEnabled(),
    apiAvailable: notificationApiAvailable(),
  });
  if (fireNotif) {
    try {
      const N = (
        globalThis as unknown as {
          Notification: new (
            title: string,
            opts: NotificationOptions,
          ) => Notification;
        }
      ).Notification;
      const n = new N(input.title || "τ-mux", {
        body: input.body || "",
        tag: input.tag,
        // Replacing an existing notification with the same tag should
        // re-alert (renotify). On mobile, this re-pulses the vibration.
        renotify: !!input.tag,
      } as NotificationOptions);
      if (input.onClick) {
        n.onclick = () => {
          try {
            window.focus();
            input.onClick?.();
            n.close();
          } catch {
            /* ignore */
          }
        };
      }
    } catch {
      /* notifications denied between probe + fire — silently skip */
    }
  }

  const vibration = decideVibration({
    prefEnabled: getVibrationEnabled(),
    apiAvailable: vibrationApiAvailable(),
    severity: input.severity,
  });
  if (vibration) {
    try {
      navigator.vibrate(vibration);
    } catch {
      /* iOS Safari may throw — we already feature-detected */
    }
  }
}
