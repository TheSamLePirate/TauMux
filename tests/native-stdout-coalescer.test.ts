import { describe, expect, test } from "bun:test";
import { NativeStdoutCoalescer } from "../src/bun/native-stdout-coalescer";

describe("native stdout coalescer", () => {
  test("batches small chunks within the coalescing window", async () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      12,
      1024,
    );

    coalescer.push("surface:1", "a");
    coalescer.push("surface:1", "b");
    coalescer.push("surface:1", "c");
    expect(sent).toEqual([]);

    await Bun.sleep(30);
    expect(sent).toEqual([{ surfaceId: "surface:1", data: "abc" }]);
  });

  test("flushes a surface immediately when it crosses the soft cap", () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      100,
      4,
    );

    coalescer.push("surface:1", "ab");
    coalescer.push("surface:2", "xy");
    coalescer.push("surface:1", "cd");

    expect(sent).toEqual([{ surfaceId: "surface:1", data: "abcd" }]);

    coalescer.flushAll();
    expect(sent).toEqual([
      { surfaceId: "surface:1", data: "abcd" },
      { surfaceId: "surface:2", data: "xy" },
    ]);
  });

  test("dispose flushes pending output", () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      100,
      1024,
    );

    coalescer.push("surface:1", "tail");
    coalescer.dispose();

    expect(sent).toEqual([{ surfaceId: "surface:1", data: "tail" }]);
  });
});
