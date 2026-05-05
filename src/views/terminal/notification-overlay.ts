// Re-export shim — the notification overlay moved to
// `src/shared/notification-overlay.ts` in M15 of the web-mirror parity
// plan so the browser mirror can mount the same DOM directly. The
// native side keeps its existing constructor signature
// (`new NotificationOverlay(hooks)`) by subclassing the shared
// manager with the native `createIcon` pre-bound.

import { createIcon, type IconName } from "./icons";
import {
  NotificationOverlay as SharedNotificationOverlay,
  composeStack,
  type CreateIconFn,
  type NotificationOverlayOptions,
  type NotificationOverlayPayload,
} from "../../shared/notification-overlay";

export {
  composeStack,
  type CreateIconFn,
  type NotificationOverlayOptions,
  type NotificationOverlayPayload,
};

interface OverlayHooks {
  onCardActivate: (payload: NotificationOverlayPayload) => void;
  onCardDismiss: (payload: NotificationOverlayPayload) => void;
  onOverflowClick: () => void;
}

const nativeCreateIcon: CreateIconFn = (name, cls, size) =>
  // The shared module only ever asks for "close"; it's a strict subset
  // of the native `IconName` union, so the cast is safe.
  createIcon(name as IconName, cls, size);

export class NotificationOverlay extends SharedNotificationOverlay {
  constructor(hooks: OverlayHooks) {
    super(hooks, { createIcon: nativeCreateIcon });
  }
}
