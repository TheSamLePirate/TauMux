// Unit tests for TelegramSurfaceController — Telegram concern extracted from
// SurfaceManager (full_app_review_2026-05.md §3 / H10).

import { describe, test, expect, beforeEach, mock } from "bun:test";

const calls: { fn: string; args: unknown[] }[] = [];
const rec =
  (fn: string) =>
  (...args: unknown[]) =>
    calls.push({ fn, args });

mock.module("../src/views/terminal/telegram-pane", () => ({
  createTelegramPaneView: (id: string) => {
    calls.push({ fn: "create", args: [id] });
    return { id, container: {}, titleEl: {}, chipsEl: {}, title: "" };
  },
  telegramPaneAppendMessage: rec("append"),
  telegramPaneApplyHistory: rec("history"),
  telegramPaneApplyState: rec("state"),
  destroyTelegramPaneView: rec("destroy"),
}));
mock.module("../src/views/terminal/sounds", () => ({
  playNotificationSound: rec("sound"),
}));

const { TelegramSurfaceController } =
  await import("../src/views/terminal/telegram-surface-controller");

function tgSurface(id: string, isTelegram: boolean) {
  return {
    id,
    surfaceType: isTelegram ? "telegram" : "terminal",
    telegramView: isTelegram ? ({ id } as never) : null,
  };
}

const inMsg = { direction: "in" } as never;
const outMsg = { direction: "out" } as never;

describe("TelegramSurfaceController", () => {
  let surfaces: Map<string, ReturnType<typeof tgSurface>>;
  let focused: string | null;
  let glowed: string[];
  let ctrl: InstanceType<typeof TelegramSurfaceController>;

  beforeEach(() => {
    calls.length = 0;
    surfaces = new Map();
    focused = null;
    glowed = [];
    ctrl = new TelegramSurfaceController({
      getSurface: (id: string) => surfaces.get(id) as never,
      getFocusedSurfaceId: () => focused,
      allSurfaces: () => surfaces.values() as never,
      focusSurface: () => {},
      notifyGlow: (id: string) => glowed.push(id),
    });
  });

  test("handleMessage broadcasts to every telegram pane, skips terminals", () => {
    surfaces.set("tg1", tgSurface("tg1", true));
    surfaces.set("t1", tgSurface("t1", false));
    surfaces.set("tg2", tgSurface("tg2", true));
    ctrl.handleMessage(inMsg);
    expect(calls.filter((c) => c.fn === "append")).toHaveLength(2);
  });

  test("inbound message glows unfocused telegram panes + plays the chime", () => {
    surfaces.set("tg1", tgSurface("tg1", true));
    focused = "t1"; // focused on a terminal, not the telegram pane
    surfaces.set("t1", tgSurface("t1", false));
    ctrl.handleMessage(inMsg);
    expect(glowed).toEqual(["tg1"]);
    expect(calls.some((c) => c.fn === "sound")).toBe(true);
  });

  test("no chime when the user is already on a telegram pane", () => {
    surfaces.set("tg1", tgSurface("tg1", true));
    focused = "tg1";
    ctrl.handleMessage(inMsg);
    expect(glowed).toEqual([]); // focused pane isn't glowed
    expect(calls.some((c) => c.fn === "sound")).toBe(false);
  });

  test("outbound messages never glow or chime", () => {
    surfaces.set("tg1", tgSurface("tg1", true));
    focused = "t1";
    surfaces.set("t1", tgSurface("t1", false));
    ctrl.handleMessage(outMsg);
    expect(glowed).toEqual([]);
    expect(calls.some((c) => c.fn === "sound")).toBe(false);
  });

  test("history + state apply to every telegram pane", () => {
    surfaces.set("tg1", tgSurface("tg1", true));
    surfaces.set("tg2", tgSurface("tg2", true));
    surfaces.set("t1", tgSurface("t1", false));
    ctrl.handleHistory({ chatId: "c", messages: [], isLatest: true });
    ctrl.handleState({ chats: [], status: {} as never });
    expect(calls.filter((c) => c.fn === "history")).toHaveLength(2);
    expect(calls.filter((c) => c.fn === "state")).toHaveLength(2);
  });
});
