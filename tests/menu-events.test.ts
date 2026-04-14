import { describe, expect, test } from "bun:test";
import { normalizeMenuActionEvent } from "../src/bun/menu-events";

describe("normalizeMenuActionEvent", () => {
  test("accepts raw menu payloads", () => {
    expect(
      normalizeMenuActionEvent({
        action: "surface.split-right",
        data: { surfaceId: "surface:1" },
      }),
    ).toEqual({
      action: "surface.split-right",
      data: { surfaceId: "surface:1" },
    });
  });

  test("accepts ElectrobunEvent-style wrapped payloads", () => {
    expect(
      normalizeMenuActionEvent({
        data: {
          action: "surface.rename",
          data: { surfaceId: "surface:2" },
        },
      }),
    ).toEqual({
      action: "surface.rename",
      data: { surfaceId: "surface:2" },
    });
  });

  test("trims invisible whitespace around actions", () => {
    expect(
      normalizeMenuActionEvent({
        action: "edit.paste-clipboard\n",
      }),
    ).toEqual({
      action: "edit.paste-clipboard",
      data: undefined,
    });
  });

  test("returns null for invalid payloads", () => {
    expect(normalizeMenuActionEvent(null)).toBeNull();
    expect(normalizeMenuActionEvent({})).toBeNull();
    expect(normalizeMenuActionEvent({ data: {} })).toBeNull();
  });
});
