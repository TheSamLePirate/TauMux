// Agent activity → strikes.
//
// The judgement being tested is what *earns a rule* and what does not.
// A timeline that draws everything is a fill pattern; one that draws too
// little is a lie by omission. The line runs between discrete moments
// (a prompt, a tool call, a reply arriving) and continuous streams
// (tokens), and this file pins where.

import { beforeEach, describe, expect, test } from "bun:test";
import { noteAgentActivity } from "../src/views/terminal/chrono/activity";
import { allEvents, resetEvents } from "../src/views/terminal/chrono/event-log";

/** A raw SDK assistant message carrying the given content blocks. */
function assistant(content: unknown[]): unknown {
  return { type: "assistant", message: { content } };
}

function user(content: unknown[]): unknown {
  return { type: "user", message: { content } };
}

describe("noteAgentActivity", () => {
  beforeEach(() => resetEvents());

  test("a prompt is a strike in the human's colour", () => {
    expect(
      noteAgentActivity("s1", user([{ type: "text", text: "ship the thing" }])),
    ).toBe(true);
    expect(allEvents()).toHaveLength(1);
    expect(allEvents()[0]).toMatchObject({
      kind: "prompt",
      surfaceId: "s1",
      text: "ship the thing",
    });
  });

  test("a tool call names the tool and what it touched", () => {
    noteAgentActivity(
      "s1",
      assistant([
        {
          type: "tool_use",
          id: "t1",
          name: "Read",
          input: { file_path: "/tmp/a.ts" },
        },
      ]),
    );
    const tool = allEvents().find((e) => e.kind === "tool");
    expect(tool).toBeTruthy();
    expect(tool!.text.startsWith("Read")).toBe(true);
  });

  test("a reply is one strike, however many tokens it took", () => {
    // Deltas fire per token. A strike per token is not a timeline.
    for (const text of ["par", "tial", " reply"]) {
      noteAgentActivity("s1", {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        },
      });
    }
    expect(allEvents()).toHaveLength(0);

    noteAgentActivity(
      "s1",
      assistant([{ type: "text", text: "partial reply" }]),
    );
    expect(allEvents().map((e) => e.kind)).toEqual(["reply"]);
  });

  test("a tool-only message does not draw an empty reply", () => {
    // Pure tool-use messages finalize with empty text; the tool calls in
    // them are already their own strikes.
    noteAgentActivity(
      "s1",
      assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
    );
    expect(allEvents().map((e) => e.kind)).toEqual(["tool"]);
  });

  test("a tool succeeding is not an event; failing is", () => {
    // The start is the action. Drawing the normal end doubles every rule
    // for no added meaning — but a failure is a new fact.
    noteAgentActivity(
      "s1",
      user([
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "ok",
          is_error: false,
        },
      ]),
    );
    expect(allEvents()).toHaveLength(0);

    noteAgentActivity(
      "s1",
      user([
        {
          type: "tool_result",
          tool_use_id: "t2",
          content: "permission denied",
          is_error: true,
        },
      ]),
    );
    expect(allEvents().map((e) => e.kind)).toEqual(["error"]);
  });

  test("a pending permission is an approval; resolving it is not", () => {
    noteAgentActivity("s1", {
      type: "__tau_permission",
      status: "pending",
      toolName: "Bash",
    });
    noteAgentActivity("s1", {
      type: "__tau_permission",
      status: "resolved",
      toolName: "Bash",
    });
    expect(allEvents().map((e) => e.kind)).toEqual(["approval"]);
  });

  test("truncates a long prompt rather than holding it for the TTL", () => {
    noteAgentActivity("s1", user([{ type: "text", text: "x".repeat(500) }]));
    expect(allEvents()[0]!.text.length).toBeLessThanOrEqual(72);
  });

  test("keeps only the first line of a multi-line prompt", () => {
    noteAgentActivity(
      "s1",
      user([{ type: "text", text: "first line\nsecond line" }]),
    );
    expect(allEvents()[0]!.text).toBe("first line");
  });

  test("an event carrying nothing of interest is free", () => {
    expect(noteAgentActivity("s1", { type: "system", subtype: "init" })).toBe(
      false,
    );
    expect(noteAgentActivity("s1", {})).toBe(false);
    expect(allEvents()).toHaveLength(0);
  });
});
