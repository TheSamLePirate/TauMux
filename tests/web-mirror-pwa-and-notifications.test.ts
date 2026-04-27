// Plan #13 — pure-function tests for web-mirror PWA helpers and the
// Notification / Vibration decision matrix. The DOM / browser-API
// surfaces are out of scope (no JSDOM); we test the deciders that
// drive them.

import { describe, expect, test } from "bun:test";
import {
  decideVibration,
  shouldFireNotification,
} from "../src/web-client/web-notifications";
import { summarizeConnection } from "../src/web-client/settings-panel";
import type { AppState } from "../src/web-client/store";

// ── shouldFireNotification ───────────────────────────────────

describe("shouldFireNotification", () => {
  const base = {
    documentHidden: true,
    permission: "granted" as const,
    prefEnabled: true,
    apiAvailable: true,
  };

  test("happy path (hidden + granted + enabled + api) fires", () => {
    expect(shouldFireNotification(base)).toBe(true);
  });

  test("api missing always returns false", () => {
    expect(shouldFireNotification({ ...base, apiAvailable: false })).toBe(
      false,
    );
  });

  test("user pref off always returns false", () => {
    expect(shouldFireNotification({ ...base, prefEnabled: false })).toBe(false);
  });

  test("permission denied returns false", () => {
    expect(shouldFireNotification({ ...base, permission: "denied" })).toBe(
      false,
    );
  });

  test("permission default (not granted) returns false", () => {
    expect(shouldFireNotification({ ...base, permission: "default" })).toBe(
      false,
    );
  });

  test("document visible returns false (in-app sidebar wins)", () => {
    expect(shouldFireNotification({ ...base, documentHidden: false })).toBe(
      false,
    );
  });
});

// ── decideVibration ──────────────────────────────────────────

describe("decideVibration", () => {
  test("api missing → null", () => {
    expect(
      decideVibration({ apiAvailable: false, prefEnabled: true }),
    ).toBeNull();
  });

  test("pref off → null", () => {
    expect(
      decideVibration({ apiAvailable: true, prefEnabled: false }),
    ).toBeNull();
  });

  test("default severity = single short pulse", () => {
    expect(decideVibration({ apiAvailable: true, prefEnabled: true })).toEqual([
      40,
    ]);
  });

  test("warning severity = three pulses", () => {
    expect(
      decideVibration({
        apiAvailable: true,
        prefEnabled: true,
        severity: "warning",
      }),
    ).toEqual([40, 60, 40]);
  });

  test("error severity = five pulses with longer tail", () => {
    expect(
      decideVibration({
        apiAvailable: true,
        prefEnabled: true,
        severity: "error",
      }),
    ).toEqual([40, 60, 40, 60, 80]);
  });
});

// ── summarizeConnection ──────────────────────────────────────

function blank(): AppState {
  return {
    connection: {
      status: "connected",
      sessionId: "abcdef0123456789",
      serverInstanceId: "srv1",
      lastSeenSeq: 5,
    },
    nativeViewport: null,
    surfaces: {},
    workspaces: [],
    activeWorkspaceId: null,
    focusedSurfaceId: null,
    sidebarVisible: false,
    fullscreenSurfaceId: null,
    panels: {},
    sidebar: {
      notifications: [],
      logs: [],
      status: {},
      progress: {},
    },
    glowingSurfaceIds: [],
    telegram: {
      status: { state: "disabled" },
      chats: [],
      messagesByChat: {},
      activeChatId: null,
    },
  };
}

describe("summarizeConnection", () => {
  test("connected status surfaces session prefix + ok kind", () => {
    const out = summarizeConnection(blank(), true);
    expect(out.statusKind).toBe("ok");
    expect(out.statusText).toContain("session abcdef01");
    expect(out.authText).toContain("Authenticated");
  });

  test("connecting status reports warn kind", () => {
    const s = blank();
    s.connection.status = "connecting";
    expect(summarizeConnection(s, true).statusKind).toBe("warn");
  });

  test("disconnected status reports err kind + retry text", () => {
    const s = blank();
    s.connection.status = "disconnected";
    const out = summarizeConnection(s, true);
    expect(out.statusKind).toBe("err");
    expect(out.statusText).toContain("Disconnected");
  });

  test("counts derived from state shape", () => {
    const s = blank();
    s.workspaces = [
      {
        id: "a",
        name: "A",
        color: "#111",
        surfaceIds: [],
        focusedSurfaceId: null,
        layout: { type: "leaf", surfaceId: "" } as never,
      },
      {
        id: "b",
        name: "B",
        color: "#222",
        surfaceIds: [],
        focusedSurfaceId: null,
        layout: { type: "leaf", surfaceId: "" } as never,
      },
    ];
    s.surfaces = {
      x: { id: "x", title: "x", cols: 80, rows: 24, metadata: null },
      y: { id: "y", title: "y", cols: 80, rows: 24, metadata: null },
      z: { id: "z", title: "z", cols: 80, rows: 24, metadata: null },
    };
    s.panels = {
      p1: {
        id: "p1",
        surfaceId: "x",
        meta: { id: "p1", type: "html" } as never,
      },
    };
    s.sidebar.notifications = [
      { id: "n1", title: "t", body: "b", at: 0 },
      { id: "n2", title: "t", body: "b", at: 0 },
    ];
    const out = summarizeConnection(s, false);
    expect(out.workspaceCount).toBe(2);
    expect(out.surfaceCount).toBe(3);
    expect(out.panelCount).toBe(1);
    expect(out.notificationCount).toBe(2);
  });

  test("auth=false surfaces a network-readable warning", () => {
    expect(summarizeConnection(blank(), false).authText).toContain(
      "anyone on this network",
    );
  });
});
