import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Scope happy-dom to this file only — a project-wide preload would
// mutate globalThis for every test file, including the web-server
// suites that rely on Bun's native fetch + WebSocket, and cause false
// failures. Registering in beforeAll and tearing down in afterAll keeps
// the DOM globals confined to this module's tests even when Bun's
// runner interleaves files.
beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import {
  appendWelcome,
  buildImageGallery,
  buildToolActions,
  buildToolCallEl,
  type ChatMessage,
  createMsgEl,
  type ToolCallState,
} from "../src/views/terminal/agent-panel-messages";

// Fresh body between tests — every builder appends to a container and
// some of them install document-level event listeners via the welcome
// action buttons. An empty body prevents cross-test pollution.
afterEach(() => {
  document.body.innerHTML = "";
});

function mkMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: "assistant",
    content: "",
    timestamp: 0,
    ...overrides,
  };
}

function mkToolCall(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    id: "tc1",
    name: "Bash",
    args: "",
    isRunning: false,
    collapsed: false,
    startTime: Date.now(),
    ...overrides,
  };
}

// ------------------------------------------------------------------
// createMsgEl
// ------------------------------------------------------------------

describe("createMsgEl", () => {
  test("user message renders role class, timestamp, and plain-text content", () => {
    const el = createMsgEl("agent-1", mkMsg({ role: "user", content: "hi" }));
    expect(el.classList.contains("agent-msg")).toBe(true);
    expect(el.classList.contains("agent-msg-user")).toBe(true);
    expect(el.querySelector(".agent-msg-time")).not.toBeNull();
    const content = el.querySelector(".agent-msg-content");
    expect(content?.textContent).toBe("hi");
  });

  test("assistant message runs markdown-lite (code + bold)", () => {
    const el = createMsgEl(
      "agent-1",
      mkMsg({
        role: "assistant",
        content: "**bold** and `code`",
      }),
    );
    const content = el.querySelector(".agent-msg-content");
    expect(content?.innerHTML).toContain("<strong>bold</strong>");
    expect(content?.innerHTML).toContain('<code class="agent-ic">code</code>');
  });

  test("assistant message's mdLite fences code blocks with language label", () => {
    const el = createMsgEl(
      "agent-1",
      mkMsg({
        role: "assistant",
        content: "```ts\nconst x = 1;\n```",
      }),
    );
    const content = el.querySelector(".agent-msg-content");
    expect(content?.innerHTML).toContain('class="agent-code-lang"');
    expect(content?.innerHTML).toContain("const x = 1;");
  });

  test("system message wraps content in a <pre> and escapes HTML", () => {
    const el = createMsgEl(
      "agent-1",
      mkMsg({
        role: "system",
        content: "<script>alert(1)</script>",
      }),
    );
    const content = el.querySelector(".agent-msg-content");
    expect(content?.innerHTML).toContain("<pre");
    // Script tag must be text, not executable HTML.
    expect(content?.querySelector("script")).toBeNull();
    expect(content?.textContent).toContain("<script>alert(1)</script>");
  });

  test("tool message renders a tool header + body and action row", () => {
    const el = createMsgEl(
      "agent-1",
      mkMsg({
        role: "tool",
        toolName: "Read",
        content: "file contents here",
        toolArgs: { path: "/tmp/x.txt" },
      }),
    );
    const hdr = el.querySelector(".agent-tc-inline-hdr");
    expect(hdr?.textContent).toContain("Read");
    const body = el.querySelector(".agent-tc-inline-body");
    expect(body?.textContent).toContain("file contents here");
    expect(el.querySelector(".agent-tool-actions")).not.toBeNull();
  });

  test("tool message with isError adds the error header class", () => {
    const el = createMsgEl(
      "agent-1",
      mkMsg({
        role: "tool",
        toolName: "Edit",
        content: "",
        isError: true,
      }),
    );
    const hdr = el.querySelector(".agent-tc-inline-hdr");
    expect(hdr?.classList.contains("agent-tc-inline-err")).toBe(true);
  });

  test("bash message renders prompt, command, and exit-code classes", () => {
    const ok = createMsgEl(
      "agent-1",
      mkMsg({
        role: "bash",
        command: "ls -la",
        content: "total 0",
        exitCode: 0,
      }),
    );
    const okHdr = ok.querySelector(".agent-tc-inline-hdr");
    expect(okHdr?.querySelector(".agent-bash-prompt")?.textContent).toBe("$");
    expect(okHdr?.textContent).toContain("ls -la");
    expect(okHdr?.classList.contains("agent-tc-inline-err")).toBe(false);

    const fail = createMsgEl(
      "agent-1",
      mkMsg({
        role: "bash",
        command: "false",
        content: "",
        exitCode: 1,
      }),
    );
    expect(
      fail
        .querySelector(".agent-tc-inline-hdr")
        ?.classList.contains("agent-tc-inline-err"),
    ).toBe(true);
  });

  test("bash message escapes HTML in the command", () => {
    const el = createMsgEl(
      "agent-1",
      mkMsg({
        role: "bash",
        command: "<b>bad</b>",
        content: "",
        exitCode: 0,
      }),
    );
    const hdr = el.querySelector(".agent-tc-inline-hdr");
    // No actual <b> child — must be escaped text.
    expect(hdr?.querySelector("b")).toBeNull();
    expect(hdr?.textContent).toContain("<b>bad</b>");
  });

  test("bash message with truncated+fullOutputPath shows the saved-output note", () => {
    const el = createMsgEl(
      "agent-1",
      mkMsg({
        role: "bash",
        command: "cat huge.log",
        content: "first chunk",
        exitCode: 0,
        truncated: true,
        fullOutputPath: "/tmp/output-123.log",
      }),
    );
    const note = el.querySelector(".agent-dialog-opt-desc");
    expect(note?.textContent).toContain("/tmp/output-123.log");
  });

  test("assistant message with thinking prepends a collapsible details block", () => {
    const el = createMsgEl(
      "agent-1",
      mkMsg({
        role: "assistant",
        content: "answer",
        thinking: "working it out",
      }),
    );
    const details = el.querySelector("details.agent-think-block");
    expect(details).not.toBeNull();
    expect(details?.querySelector(".agent-think-body")?.textContent).toBe(
      "working it out",
    );
    // Content still rendered after the thinking block.
    expect(el.querySelector(".agent-msg-content")?.textContent).toBe("answer");
  });

  test("message images render into a gallery block", () => {
    const el = createMsgEl(
      "agent-1",
      mkMsg({
        role: "assistant",
        content: "see attached",
        images: [
          { type: "image", data: "AAA", mimeType: "image/png" },
          { type: "image", data: "BBB", mimeType: "image/jpeg" },
        ],
      }),
    );
    const gallery = el.querySelector(".agent-image-gallery");
    expect(gallery).not.toBeNull();
    expect(gallery?.querySelectorAll("img.agent-image-thumb").length).toBe(2);
  });
});

// ------------------------------------------------------------------
// buildToolCallEl
// ------------------------------------------------------------------

describe("buildToolCallEl", () => {
  test("running tool call renders run class and spinner glyph, no elapsed", () => {
    const el = buildToolCallEl(
      "agent-1",
      mkToolCall({ name: "Bash", isRunning: true }),
    );
    expect(el.classList.contains("agent-tc-run")).toBe(true);
    expect(el.querySelector(".agent-tc-name")?.textContent).toBe("Bash");
    expect(el.querySelector(".agent-tc-elapsed")).toBeNull();
  });

  test("completed successful tool call renders ok class, check glyph, elapsed", () => {
    const el = buildToolCallEl(
      "agent-1",
      mkToolCall({
        name: "Read",
        isRunning: false,
        result: "ok",
        startTime: Date.now() - 1500,
      }),
    );
    expect(el.classList.contains("agent-tc-ok")).toBe(true);
    expect(el.querySelector(".agent-tc-elapsed")?.textContent).toMatch(
      /[0-9]+\.[0-9]s/,
    );
  });

  test("failed tool call renders err class", () => {
    const el = buildToolCallEl(
      "agent-1",
      mkToolCall({ isRunning: false, isError: true, result: "boom" }),
    );
    expect(el.classList.contains("agent-tc-err")).toBe(true);
  });

  test("Edit/Write result runs diff highlighting", () => {
    const el = buildToolCallEl(
      "agent-1",
      mkToolCall({
        name: "Edit",
        isRunning: false,
        result: "+ added line\n- removed line\n context",
      }),
    );
    const body = el.querySelector(".agent-tc-body");
    expect(body?.innerHTML).toContain('class="agent-diff-add"');
    expect(body?.innerHTML).toContain('class="agent-diff-del"');
  });

  test("non-Edit tool results render as plain text (no diff highlighting)", () => {
    const el = buildToolCallEl(
      "agent-1",
      mkToolCall({
        name: "Bash",
        isRunning: false,
        result: "+ this is not a diff",
      }),
    );
    const body = el.querySelector(".agent-tc-body");
    expect(body?.innerHTML).not.toContain("agent-diff-add");
    expect(body?.textContent).toContain("+ this is not a diff");
  });

  test("toggle button collapses and uncollapses the body", () => {
    const tc = mkToolCall({ isRunning: false, result: "body here" });
    const el = buildToolCallEl("agent-1", tc);
    const body = el.querySelector(".agent-tc-body") as HTMLDivElement;
    const toggle = el.querySelector(".agent-tc-toggle") as HTMLButtonElement;
    expect(body.classList.contains("agent-tc-body-hidden")).toBe(false);

    toggle.click();
    expect(tc.collapsed).toBe(true);
    expect(body.classList.contains("agent-tc-body-hidden")).toBe(true);

    toggle.click();
    expect(tc.collapsed).toBe(false);
    expect(body.classList.contains("agent-tc-body-hidden")).toBe(false);
  });

  test("long args are truncated with ellipsis in the header", () => {
    const longArgs = "x".repeat(200);
    const el = buildToolCallEl(
      "agent-1",
      mkToolCall({ isRunning: true, args: longArgs }),
    );
    const argsEl = el.querySelector(".agent-tc-args") as HTMLSpanElement;
    expect(argsEl.textContent?.length).toBeLessThan(longArgs.length);
    expect(argsEl.textContent?.endsWith("\u2026")).toBe(true);
    // title attr keeps the full, un-truncated value for hover.
    expect(argsEl.title).toBe(longArgs);
  });

  test("tc.id is written to dataset.tcid for selector-based updates", () => {
    const el = buildToolCallEl(
      "agent-1",
      mkToolCall({ id: "tc-42", isRunning: true }),
    );
    expect(el.dataset["tcid"]).toBe("tc-42");
  });
});

// ------------------------------------------------------------------
// buildToolActions
// ------------------------------------------------------------------

describe("buildToolActions", () => {
  test("empty args + no result produces an empty-state actions row", () => {
    const row = buildToolActions("agent-1", null);
    expect(row.classList.contains("agent-tool-actions-empty")).toBe(true);
    expect(row.children.length).toBe(0);
  });

  test("args with a command exposes Rerun + Copy cmd", () => {
    const row = buildToolActions("agent-1", { command: "ls" });
    const labels = [...row.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(labels).toContain("Rerun");
    expect(labels).toContain("Copy cmd");
    expect(row.classList.contains("agent-tool-actions-empty")).toBe(false);
  });

  test("Rerun dispatches ht-agent-bash with the correct agent + command", () => {
    let detail: unknown = null;
    const listener = (e: Event) => {
      detail = (e as CustomEvent).detail;
    };
    window.addEventListener("ht-agent-bash", listener);
    try {
      const row = buildToolActions("agent-42", { command: "pwd" });
      const rerun = [...row.querySelectorAll("button")].find(
        (b) => b.textContent === "Rerun",
      ) as HTMLButtonElement;
      rerun.click();
      expect(detail).toEqual({ agentId: "agent-42", command: "pwd" });
    } finally {
      window.removeEventListener("ht-agent-bash", listener);
    }
  });

  test("args with a path exposes Copy path", () => {
    const row = buildToolActions("agent-1", { path: "/etc/hosts" });
    const labels = [...row.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(labels).toContain("Copy path");
  });

  test("result alone (no args) exposes Copy output", () => {
    const row = buildToolActions("agent-1", {}, "captured");
    const labels = [...row.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Copy output"]);
  });

  test("accepts a JSON string of args and parses it", () => {
    const row = buildToolActions(
      "agent-1",
      JSON.stringify({ command: "echo hi" }),
    );
    const labels = [...row.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(labels).toContain("Rerun");
  });
});

// ------------------------------------------------------------------
// buildImageGallery
// ------------------------------------------------------------------

describe("buildImageGallery", () => {
  test("renders one <img> per attachment with a data: URL", () => {
    const wrap = buildImageGallery([
      { type: "image", data: "AAA", mimeType: "image/png" },
      {
        type: "image",
        data: "BBB",
        mimeType: "image/jpeg",
        fileName: "shot.jpg",
      },
    ]);
    const imgs = wrap.querySelectorAll("img.agent-image-thumb");
    expect(imgs.length).toBe(2);
    expect((imgs[0] as HTMLImageElement).src).toBe("data:image/png;base64,AAA");
    expect((imgs[1] as HTMLImageElement).alt).toBe("shot.jpg");
  });

  test("empty list renders an empty gallery node (no images)", () => {
    const wrap = buildImageGallery([]);
    expect(wrap.classList.contains("agent-image-gallery")).toBe(true);
    expect(wrap.querySelectorAll("img").length).toBe(0);
  });
});

// ------------------------------------------------------------------
// appendWelcome
// ------------------------------------------------------------------

describe("appendWelcome", () => {
  test("appends a .agent-welcome block with four quick-action buttons", () => {
    const parent = document.createElement("div");
    appendWelcome(parent);
    const welcome = parent.querySelector(".agent-welcome");
    expect(welcome).not.toBeNull();
    const cmds = [...welcome!.querySelectorAll(".agent-welcome-btn")].map(
      (b) => (b as HTMLElement).dataset["cmd"],
    );
    expect(cmds).toEqual(["/help", "/session", "/resume", "/tree"]);
  });

  test("welcome button click writes its /cmd into the ancestor .agent-input", () => {
    // The welcome action buttons walk up via .agent-body to find the
    // real agent input — mimic that structure so the click wiring can
    // do its lookup. If this ever breaks silently it'd disable the
    // welcome screen in the packaged app.
    const root = document.createElement("div");
    root.className = "agent-body";
    const input = document.createElement("textarea");
    input.className = "agent-input";
    root.appendChild(input);
    const parent = document.createElement("div");
    root.appendChild(parent);
    document.body.appendChild(root);

    appendWelcome(parent);
    const helpBtn = parent.querySelector(
      '[data-cmd="/help"]',
    ) as HTMLButtonElement;
    helpBtn.click();
    expect(input.value).toBe("/help");
  });
});
