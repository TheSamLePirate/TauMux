/**
 * The outbound notification ↔ Telegram bridge.
 *
 * `forward` was inline in `src/bun/index.ts` until the resolve half
 * arrived and both moved out; these are its first direct tests. The
 * resolve half is the load-bearing one: a forwarded notification carries
 * a live OK / No / Continue / Cancel keyboard wired to a surface, so
 * leaving it up after the prompt was answered means the next tap fires a
 * stray Enter into whatever now owns that pane.
 */
import { describe, test, expect } from "bun:test";
import type { NotificationPayload } from "../src/shared/webview-actions";
import {
  forwardNotificationToTelegram,
  resolveForwardedNotification,
  type NotificationForwardDeps,
  type NotificationLinkStore,
} from "../src/bun/telegram-notification-bridge";

// ── forward ───────────────────────────────────────────────────────────

function forwardSetup(over: Partial<NotificationForwardDeps> = {}) {
  const withButtons: Array<Record<string, unknown>> = [];
  const plain: Array<{ chatId: string; text: string }> = [];
  const deps: NotificationForwardDeps = {
    live: true,
    settings: {
      telegramNotificationsEnabled: true,
      telegramAllowedUserIds: "111,222",
      telegramNotificationButtonsEnabled: false,
    },
    workspaces: [
      {
        name: "main",
        surfaceIds: ["surface:1"],
        surfaceTitles: { "surface:1": "bun test" },
      },
    ],
    sendWithButtons: (o) => withButtons.push(o),
    send: (chatId, text) => plain.push({ chatId, text }),
    ...over,
  };
  return { deps, withButtons, plain };
}

const latest = (over: Record<string, unknown> = {}) => ({
  id: "notif:1",
  title: "Build complete",
  body: "exit 0",
  surfaceId: "surface:1",
  ...over,
});

describe("forwardNotificationToTelegram", () => {
  test("fans out to every allow-listed chat with pane attribution", () => {
    const { deps, plain } = forwardSetup();
    forwardNotificationToTelegram(latest(), deps);
    expect(plain.map((d) => d.chatId)).toEqual(["111", "222"]);
    expect(plain[0]!.text).toContain("Build complete");
    expect(plain[0]!.text).toContain("(main / bun test)");
  });

  test("routes through the buttons sender when the setting is on", () => {
    // The buttons path is also what persists the notification_links row
    // that `resolve` later needs, so which sender runs matters beyond
    // the keyboard itself.
    const { deps, withButtons, plain } = forwardSetup({
      settings: {
        telegramNotificationsEnabled: true,
        telegramAllowedUserIds: "111",
        telegramNotificationButtonsEnabled: true,
      },
    });
    forwardNotificationToTelegram(latest(), deps);
    expect(plain).toHaveLength(0);
    expect(withButtons).toHaveLength(1);
    expect(withButtons[0]).toMatchObject({
      chatId: "111",
      notificationId: "notif:1",
      surfaceId: "surface:1",
    });
  });

  test("falls back to the plain sender when the id is missing", () => {
    // A row keyed on an empty notification id could never be resolved
    // by an inbound tap, so buttons would be dead on arrival.
    const { deps, withButtons, plain } = forwardSetup({
      settings: {
        telegramNotificationsEnabled: true,
        telegramAllowedUserIds: "111",
        telegramNotificationButtonsEnabled: true,
      },
    });
    forwardNotificationToTelegram(latest({ id: "" }), deps);
    expect(withButtons).toHaveLength(0);
    expect(plain).toHaveLength(1);
  });

  test("sends nothing when the service is down, the toggle is off, or nobody is allow-listed", () => {
    for (const over of [
      { live: false },
      {
        settings: {
          telegramNotificationsEnabled: false,
          telegramAllowedUserIds: "111",
          telegramNotificationButtonsEnabled: false,
        },
      },
      {
        settings: {
          telegramNotificationsEnabled: true,
          telegramAllowedUserIds: "",
          telegramNotificationButtonsEnabled: false,
        },
      },
    ]) {
      const { deps, plain, withButtons } = forwardSetup(over);
      forwardNotificationToTelegram(latest(), deps);
      expect(plain).toHaveLength(0);
      expect(withButtons).toHaveLength(0);
    }
  });

  test("a surface-less notification still forwards, without attribution", () => {
    const { deps, plain } = forwardSetup();
    forwardNotificationToTelegram(latest({ surfaceId: null }), deps);
    expect(plain).toHaveLength(2);
    expect(plain[0]!.text).not.toContain("(");
  });
});

// ── resolve ───────────────────────────────────────────────────────────

function linkStore(
  links: Array<{ chatId: string; tgMessageId: number }> = [],
): NotificationLinkStore & { dropped: string[] } {
  return {
    dropped: [],
    getNotificationLinksForNotification: () => links,
    dropNotificationLinks(id) {
      this.dropped.push(id);
      return links.length;
    },
  };
}

function editor() {
  const edits: Array<{ chatId: string; tgMessageId: number; text: string }> =
    [];
  return {
    edits,
    editMessage: (chatId: string, tgMessageId: number, text: string) => {
      edits.push({ chatId, tgMessageId, text });
      return true;
    },
  };
}

const resolved: NotificationPayload = {
  dismissed: "notif:1",
  resolution: "auto-approved by τ-mux",
  dismissedTitle: "Claude Code · approval needed",
  dismissedBody: "Bash(ls) — check the pane.",
};

describe("resolveForwardedNotification", () => {
  test("rewrites every forwarded copy and forgets the links", () => {
    const db = linkStore([
      { chatId: "1", tgMessageId: 10 },
      { chatId: "2", tgMessageId: 11 },
    ]);
    const svc = editor();
    resolveForwardedNotification(resolved, "notif:1", db, svc);

    expect(svc.edits.map((e) => e.chatId)).toEqual(["1", "2"]);
    expect(svc.edits[0]!.text).toContain("Claude Code · approval needed");
    expect(svc.edits[0]!.text).toContain("Resolved: auto-approved by τ-mux");
    expect(db.dropped).toEqual(["notif:1"]);
  });

  test("a plain user dismiss changes nothing", () => {
    // The user swiping the card away has answered nothing — rewriting
    // their chat as resolved would be a lie, and stripping the buttons
    // would take away the remote control they still need.
    const db = linkStore([{ chatId: "1", tgMessageId: 10 }]);
    const svc = editor();
    resolveForwardedNotification({ dismissed: "notif:1" }, "notif:1", db, svc);
    expect(svc.edits).toHaveLength(0);
    expect(db.dropped).toEqual([]);
  });

  test("an empty resolution is treated as no resolution", () => {
    const db = linkStore([{ chatId: "1", tgMessageId: 10 }]);
    const svc = editor();
    resolveForwardedNotification(
      { dismissed: "notif:1", resolution: "" },
      "notif:1",
      db,
      svc,
    );
    expect(svc.edits).toHaveLength(0);
    expect(db.dropped).toEqual([]);
  });

  test("nothing forwarded means nothing to clean up", () => {
    const db = linkStore([]);
    const svc = editor();
    resolveForwardedNotification(resolved, "notif:1", db, svc);
    expect(svc.edits).toHaveLength(0);
    expect(db.dropped).toEqual([]);
  });

  test("links are dropped even with the service down", () => {
    // The notification is already gone locally, so a tap arriving later
    // has nothing legitimate to resolve to. Leaving the rows would let
    // it dispatch keystrokes at the surface anyway.
    const db = linkStore([{ chatId: "1", tgMessageId: 10 }]);
    resolveForwardedNotification(resolved, "notif:1", db, null);
    expect(db.dropped).toEqual(["notif:1"]);
  });

  test("one unreachable chat does not strand the others", () => {
    const db = linkStore([
      { chatId: "1", tgMessageId: 10 },
      { chatId: "2", tgMessageId: 11 },
    ]);
    const seen: string[] = [];
    const warnings: string[] = [];
    resolveForwardedNotification(
      resolved,
      "notif:1",
      db,
      {
        editMessage: (chatId: string) => {
          if (chatId === "1") throw new Error("chat blocked the bot");
          seen.push(chatId);
          return true;
        },
      },
      (m) => warnings.push(m),
    );
    expect(seen).toEqual(["2"]);
    expect(warnings).toHaveLength(1);
    expect(db.dropped).toEqual(["notif:1"]);
  });

  test("a busted link store degrades to a no-op, never a throw", () => {
    // This runs inside the dispatch path of a dismiss that has already
    // happened — throwing here would take out an unrelated broadcast.
    const warnings: string[] = [];
    expect(() =>
      resolveForwardedNotification(
        resolved,
        "notif:1",
        {
          getNotificationLinksForNotification: () => {
            throw new Error("database is locked");
          },
          dropNotificationLinks: () => 0,
        },
        editor(),
        (m) => warnings.push(m),
      ),
    ).not.toThrow();
    expect(warnings).toHaveLength(1);
  });
});
