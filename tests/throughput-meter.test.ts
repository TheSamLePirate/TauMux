// Throughput meter — the signal behind the Atlas byte-flow wires.
//
// The contract that matters most is the *quiet floor*: `flowLevel` must
// return exactly 0 for a pane that isn't really producing output, because
// the renderer branches on `=== 0` to skip animating that wire entirely.
// A meter that returned 0.001 for a silent shell would leave every wire
// in the graph animating forever, which is the idle cost the project's
// first priority forbids.

import { beforeEach, describe, expect, test } from "bun:test";
import {
  flowLevel,
  forgetThroughput,
  formatThroughput,
  noteThroughput,
  QUIET_BYTES_PER_SEC,
  resetThroughput,
  throughputOf,
} from "../src/views/terminal/throughput-meter";

describe("throughput meter", () => {
  beforeEach(() => resetThroughput());

  test("an unseen surface is silent", () => {
    expect(throughputOf("nope")).toBe(0);
    expect(flowLevel("nope")).toBe(0);
    expect(formatThroughput("nope")).toBe("");
  });

  test("zero-length and negative writes are ignored", () => {
    noteThroughput("s1", 0);
    noteThroughput("s1", -10);
    expect(throughputOf("s1")).toBe(0);
  });

  test("a single burst does not read as an infinite rate", () => {
    noteThroughput("s1", 8192);
    const rate = throughputOf("s1");
    expect(Number.isFinite(rate)).toBe(true);
    // First chunk is attributed to one half-life, so ~2× its size.
    expect(rate).toBeGreaterThan(1_000);
    expect(rate).toBeLessThan(50_000);
  });

  test("two writes in the same millisecond cannot spike the estimate", () => {
    noteThroughput("s1", 4096);
    noteThroughput("s1", 4096);
    noteThroughput("s1", 4096);
    expect(throughputOf("s1")).toBeLessThan(2_000_000);
  });

  test("flowLevel is exactly 0 at or below the quiet floor", async () => {
    noteThroughput("s1", 10);
    // Let the estimate decay under the floor.
    await Bun.sleep(30);
    noteThroughput("s1", 1);
    const rate = throughputOf("s1");
    if (rate <= QUIET_BYTES_PER_SEC) {
      expect(flowLevel("s1")).toBe(0);
      expect(formatThroughput("s1")).toBe("");
    }
  });

  test("flowLevel stays inside 0…1 for an absurd rate", () => {
    for (let i = 0; i < 40; i++) noteThroughput("s1", 8 * 1024 * 1024);
    const level = flowLevel("s1");
    expect(level).toBeLessThanOrEqual(1);
    expect(level).toBeGreaterThan(0.5);
  });

  test("a louder stream ranks above a quieter one", () => {
    for (let i = 0; i < 10; i++) {
      noteThroughput("loud", 262_144);
      noteThroughput("quiet", 512);
    }
    expect(flowLevel("loud")).toBeGreaterThan(flowLevel("quiet"));
  });

  test("the estimate decays with no further writes", async () => {
    for (let i = 0; i < 5; i++) noteThroughput("s1", 262_144);
    const before = throughputOf("s1");
    await Bun.sleep(60);
    expect(throughputOf("s1")).toBeLessThan(before);
  });

  test("formatThroughput scales its unit", () => {
    for (let i = 0; i < 20; i++) noteThroughput("s1", 4 * 1024 * 1024);
    expect(formatThroughput("s1")).toMatch(/(KB|MB)\/s$/);
  });

  test("forgetting a closed pane drops its sample", () => {
    for (let i = 0; i < 5; i++) noteThroughput("s1", 262_144);
    expect(throughputOf("s1")).toBeGreaterThan(0);
    forgetThroughput("s1");
    expect(throughputOf("s1")).toBe(0);
  });
});
