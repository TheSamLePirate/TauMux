/**
 * Sidebar footer — Claude Code auto-approve pill.
 *
 * The point of putting this in the sidebar is that the state is visible
 * without opening anything: auto-approve is the one setting that lets an
 * agent act on your machine while you are not looking. So the tests pin
 * that the pill (a) always states On or Off, (b) is a real toggle button
 * for keyboard + screen-reader users, and (c) does NOT flip itself on
 * click — it asks the host, which owns the settings write, and only
 * repaints when the new state comes back.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function mountFooter(): Promise<{
  pill: HTMLButtonElement;
  setAutoApprove: (s: {
    claudeAutoApprove: boolean;
    claudeAutoApproveDelayMs: number;
  }) => void;
  events: { enabled: boolean }[];
}> {
  document.body.innerHTML = "";
  const { SidebarFooter } =
    await import("../src/views/terminal/sidebar-footer");
  const { htEvents } = await import("../src/shared/event-bus");

  const events: { enabled: boolean }[] = [];
  htEvents.on("ht-set-auto-approve", (p) => events.push(p));

  const footer = new SidebarFooter();
  document.body.appendChild(footer.root);
  const pill = footer.root.querySelector<HTMLButtonElement>(
    ".sidebar-auto-approve",
  );
  if (!pill) throw new Error("auto-approve pill missing");
  return { pill, setAutoApprove: (s) => footer.setAutoApprove(s), events };
}

describe("sidebar auto-approve pill", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("defaults to Off, with the dot dimmed", async () => {
    const { pill } = await mountFooter();
    expect(pill.querySelector(".sidebar-server-url")?.textContent).toBe("Off");
    expect(
      pill.querySelector(".sidebar-server-dot")?.classList.contains("offline"),
    ).toBe(true);
    expect(pill.getAttribute("aria-pressed")).toBe("false");
  });

  test("reflects the enabled state, arming the dot", async () => {
    const { pill, setAutoApprove } = await mountFooter();
    setAutoApprove({ claudeAutoApprove: true, claudeAutoApproveDelayMs: 900 });

    expect(pill.querySelector(".sidebar-server-url")?.textContent).toBe("On");
    const dot = pill.querySelector(".sidebar-server-dot")!;
    expect(dot.classList.contains("armed")).toBe(true);
    expect(dot.classList.contains("offline")).toBe(false);
    expect(pill.classList.contains("active")).toBe(true);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    // The delay is discoverable without opening Settings.
    expect(pill.title).toContain("900 ms");
  });

  test("is a button announced as a toggle", async () => {
    const { pill } = await mountFooter();
    expect(pill.tagName).toBe("BUTTON");
    expect(pill.type).toBe("button");
    expect(pill.getAttribute("aria-label")).toContain("auto-approve");
  });

  test("click asks the host to flip, and does not repaint on its own", async () => {
    const { pill, events } = await mountFooter();
    pill.click();

    expect(events).toEqual([{ enabled: true }]);
    // Still Off: the host owns the write. Flipping optimistically would
    // show "On" even if the settings write never landed.
    expect(pill.querySelector(".sidebar-server-url")?.textContent).toBe("Off");
    expect(pill.getAttribute("aria-pressed")).toBe("false");
  });

  test("click while enabled asks to turn it off", async () => {
    const { pill, setAutoApprove, events } = await mountFooter();
    setAutoApprove({ claudeAutoApprove: true, claudeAutoApproveDelayMs: 700 });
    pill.click();
    expect(events).toEqual([{ enabled: false }]);
  });
});

describe("sidebar auto-approve wiring", () => {
  test("Sidebar.setAutoApprove forwards a settings slice to the pill", async () => {
    document.body.innerHTML = "";
    const { Sidebar } = await import("../src/views/terminal/sidebar");
    const { DEFAULT_SETTINGS } = await import("../src/shared/settings");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sidebar = new Sidebar(host, {
      onSelectWorkspace: () => {},
      onNewWorkspace: () => {},
      onCloseWorkspace: () => {},
    });

    sidebar.setAutoApprove({ ...DEFAULT_SETTINGS, claudeAutoApprove: true });
    const pill = host.querySelector<HTMLButtonElement>(".sidebar-auto-approve");
    expect(pill?.querySelector(".sidebar-server-url")?.textContent).toBe("On");
  });
});
