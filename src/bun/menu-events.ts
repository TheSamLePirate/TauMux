export interface MenuActionEvent {
  action: string;
  data?: unknown;
}

/**
 * Electrobun menu callbacks may arrive either as a raw payload
 * ({ action, data }) or wrapped in an ElectrobunEvent ({ data: { ... } }).
 * Some native callbacks also include trailing whitespace/invisible chars in
 * the action string, so normalize those here before dispatching.
 */
export function normalizeMenuActionEvent(
  event: unknown,
): MenuActionEvent | null {
  if (!event || typeof event !== "object") return null;

  const direct = event as { action?: unknown; data?: unknown };
  if (typeof direct.action === "string") {
    return {
      action: direct.action.trim(),
      data: direct.data,
    };
  }

  const wrapped = event as {
    data?: { action?: unknown; data?: unknown };
  };
  if (
    wrapped.data &&
    typeof wrapped.data === "object" &&
    typeof wrapped.data.action === "string"
  ) {
    return {
      action: wrapped.data.action.trim(),
      data: wrapped.data.data,
    };
  }

  return null;
}
