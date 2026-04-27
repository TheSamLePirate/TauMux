// Plan #10 commit C — DOM behaviour for the ask-user modal. Uses
// happy-dom; drives the modal via the test hooks exposed at module
// scope. No real RPC — onAnswer / onCancel are spies.

import {
  afterAll,
  afterEach,
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

async function loadModal() {
  return await import("../src/views/terminal/ask-user-modal");
}
async function loadState() {
  return await import("../src/views/terminal/ask-user-state");
}

import type { AskUserRequest } from "../src/shared/types";

let nextId = 1;
function mkReq(partial: Partial<AskUserRequest> = {}): AskUserRequest {
  return {
    request_id: partial.request_id ?? `req:${nextId++}`,
    surface_id: partial.surface_id ?? "surface:1",
    kind: partial.kind ?? "yesno",
    title: partial.title ?? "ok?",
    body: partial.body,
    choices: partial.choices,
    default: partial.default,
    timeout_ms: partial.timeout_ms,
    unsafe: partial.unsafe,
    agent_id: partial.agent_id,
    created_at: partial.created_at ?? 0,
  };
}

interface Harness {
  state: import("../src/views/terminal/ask-user-state").AskUserState;
  answers: Array<{ id: string; value: string }>;
  cancels: Array<{ id: string; reason: string | undefined }>;
  setActive(id: string | null): void;
  destroy(): void;
}

async function mkHarness(): Promise<Harness> {
  const stateMod = await loadState();
  const modalMod = await loadModal();
  const state = new stateMod.AskUserState();
  const answers: Array<{ id: string; value: string }> = [];
  const cancels: Array<{ id: string; reason: string | undefined }> = [];
  let activeId: string | null = "surface:1";
  const handle = modalMod.installAskUserModal({
    state,
    onAnswer: (id, value) => {
      answers.push({ id, value });
    },
    onCancel: (id, reason) => {
      cancels.push({ id, reason });
    },
    getActiveSurfaceId: () => activeId,
    getAttribution: (sid) => ({ workspace: "ws-1", surface: `pane-${sid}` }),
  });
  return {
    state,
    answers,
    cancels,
    setActive: (id) => {
      activeId = id;
      window.dispatchEvent(new CustomEvent("ht-surface-focused"));
    },
    destroy: () => handle.destroy(),
  };
}

describe("AskUserModal — DOM behaviour", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    // Belt-and-braces — reset DOM in case a test left a modal mounted.
    document.body.innerHTML = "";
  });

  test("yesno renders Yes / No / Cancel and submits 'yes'", async () => {
    const { readActiveAskUserModal, submitActiveAskUserModal } =
      await loadModal();
    const h = await mkHarness();
    const req = mkReq({ kind: "yesno", title: "Run install?" });
    h.state.pushShown(req);

    const snap = readActiveAskUserModal();
    expect(snap?.kind).toBe("yesno");
    expect(snap?.title).toBe("Run install?");
    expect(snap?.attribution).toContain("ws-1");
    expect(
      document.querySelectorAll('[data-ask-user-button="yes"]').length,
    ).toBe(1);
    expect(
      document.querySelectorAll('[data-ask-user-button="no"]').length,
    ).toBe(1);
    expect(
      document.querySelectorAll('[data-ask-user-button="cancel"]').length,
    ).toBe(1);

    expect(submitActiveAskUserModal("yes")).toBe(true);
    expect(h.answers).toEqual([{ id: req.request_id, value: "yes" }]);
    expect(readActiveAskUserModal()).toBeNull();
    h.destroy();
  });

  test("yesno cancel via Cancel button", async () => {
    const { cancelActiveAskUserModal } = await loadModal();
    const h = await mkHarness();
    const req = mkReq({ kind: "yesno" });
    h.state.pushShown(req);

    expect(cancelActiveAskUserModal()).toBe(true);
    expect(h.cancels.length).toBe(1);
    expect(h.cancels[0].id).toBe(req.request_id);
    h.destroy();
  });

  test("choice renders one button per choice + Cancel; submit by id", async () => {
    const { readActiveAskUserModal, submitActiveAskUserModal } =
      await loadModal();
    const h = await mkHarness();
    const req = mkReq({
      kind: "choice",
      title: "Branch?",
      choices: [
        { id: "main", label: "Main" },
        { id: "dev", label: "Develop" },
        { id: "feat", label: "feature/x" },
      ],
    });
    h.state.pushShown(req);

    const snap = readActiveAskUserModal();
    expect(snap?.kind).toBe("choice");
    expect(snap?.choiceIds).toEqual(["main", "dev", "feat"]);

    expect(submitActiveAskUserModal("dev")).toBe(true);
    expect(h.answers).toEqual([{ id: req.request_id, value: "dev" }]);
    h.destroy();
  });

  test("text renders an input + submits the typed value", async () => {
    const { readActiveAskUserModal, submitActiveAskUserModal } =
      await loadModal();
    const h = await mkHarness();
    const req = mkReq({
      kind: "text",
      title: "Commit message",
      default: "wip",
    });
    h.state.pushShown(req);

    const snap = readActiveAskUserModal();
    expect(snap?.kind).toBe("text");
    expect(snap?.inputValue).toBe("wip");

    expect(submitActiveAskUserModal("hello world")).toBe(true);
    expect(h.answers).toEqual([{ id: req.request_id, value: "hello world" }]);
    h.destroy();
  });

  test("text refuses empty submit and adds the shake class", async () => {
    const { submitActiveAskUserModal } = await loadModal();
    const h = await mkHarness();
    const req = mkReq({ kind: "text", title: "Name" });
    h.state.pushShown(req);

    expect(submitActiveAskUserModal("")).toBe(true);
    // Empty submit should NOT have answered.
    expect(h.answers.length).toBe(0);
    const input = document.querySelector(
      ".ask-user-input",
    ) as HTMLInputElement | null;
    expect(input?.classList.contains("prompt-input-invalid")).toBe(true);
    h.destroy();
  });

  test("confirm-command requires ack before run", async () => {
    const {
      readActiveAskUserModal,
      submitActiveAskUserModal,
      ackActiveAskUserModal,
    } = await loadModal();
    const h = await mkHarness();
    const req = mkReq({
      kind: "confirm-command",
      title: "Run command",
      body: "rm -rf ./build",
      unsafe: true,
    });
    h.state.pushShown(req);

    let snap = readActiveAskUserModal();
    expect(snap?.kind).toBe("confirm-command");
    expect(snap?.unsafe).toBe(true);
    expect(snap?.body).toBe("rm -rf ./build");
    expect(snap?.confirmRevealed).toBe(false);

    // Run isn't visible yet.
    expect(document.querySelector('[data-ask-user-button="run"]')).toBeNull();
    // submit("run") is a no-op until ack lands.
    expect(submitActiveAskUserModal("run")).toBe(false);
    expect(h.answers.length).toBe(0);

    expect(ackActiveAskUserModal()).toBe(true);
    snap = readActiveAskUserModal();
    expect(snap?.confirmRevealed).toBe(true);
    expect(
      document.querySelector('[data-ask-user-button="run"]'),
    ).not.toBeNull();

    expect(submitActiveAskUserModal("run")).toBe(true);
    expect(h.answers).toEqual([{ id: req.request_id, value: "run" }]);
    h.destroy();
  });

  test("Esc on yesno cancels via keyboard", async () => {
    await loadModal();
    const h = await mkHarness();
    const req = mkReq({ kind: "yesno" });
    h.state.pushShown(req);
    const sheet = document.querySelector(".ask-user-sheet") as HTMLElement;
    sheet.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(h.cancels.length).toBe(1);
    h.destroy();
  });

  test("modal hides when active surface has no pending and reappears on switch", async () => {
    const { readActiveAskUserModal } = await loadModal();
    const h = await mkHarness();
    const req = mkReq({ kind: "yesno", surface_id: "surface:other" });
    h.state.pushShown(req);
    // We're focused on surface:1; surface:other has the request.
    expect(readActiveAskUserModal()).toBeNull();
    // Switch focus.
    h.setActive("surface:other");
    expect(readActiveAskUserModal()?.request_id).toBe(req.request_id);
    // Switch back.
    h.setActive("surface:1");
    expect(readActiveAskUserModal()).toBeNull();
    h.destroy();
  });

  test("FIFO: resolving the head exposes the next request for the same surface", async () => {
    const { readActiveAskUserModal } = await loadModal();
    const h = await mkHarness();
    const a = mkReq({ kind: "yesno", request_id: "a", title: "first" });
    const b = mkReq({ kind: "yesno", request_id: "b", title: "second" });
    h.state.pushShown(a);
    h.state.pushShown(b);
    expect(readActiveAskUserModal()?.title).toBe("first");
    h.state.pushResolved("a");
    expect(readActiveAskUserModal()?.title).toBe("second");
    h.destroy();
  });

  test("backdrop click cancels", async () => {
    const h = await mkHarness();
    const req = mkReq({ kind: "yesno" });
    h.state.pushShown(req);
    const overlay = document.querySelector(".ask-user-overlay") as HTMLElement;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "target", { value: overlay });
    overlay.dispatchEvent(ev);
    expect(h.cancels.length).toBe(1);
    h.destroy();
  });

  test("snapshot seeded before mount drives the initial render", async () => {
    const { readActiveAskUserModal } = await loadModal();
    const h = await mkHarness();
    const req = mkReq({
      kind: "yesno",
      request_id: "seeded",
      surface_id: "surface:1",
    });
    h.state.seedSnapshot([req]);
    expect(readActiveAskUserModal()?.request_id).toBe("seeded");
    h.destroy();
  });
});
