import { describe, test, expect, afterEach } from "bun:test";
import { SidebandParser } from "../src/bun/sideband-parser";
import type { SidebandMetaMessage } from "../src/shared/types";

async function waitFor(
  fn: () => boolean,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await Bun.sleep(interval);
  }
}

/**
 * Spawn a child that writes test data to fd3 (meta) and fd4 (data).
 * The child runs a bash script that writes what we tell it.
 */
function spawnWriter(metaLines: string[], dataPayloads: Uint8Array[] = []) {
  // Build a bash script that writes meta lines to fd3 and data payloads to fd4
  const cmds: string[] = [];
  let dataIdx = 0;
  for (const line of metaLines) {
    cmds.push(`echo '${line}' >&3`);
    // Check if this line has byteLength — if so, write corresponding data
    try {
      const parsed = JSON.parse(line);
      if (parsed.byteLength && dataPayloads[dataIdx]) {
        // Write binary data as base64-decoded to fd4
        const b64 = Buffer.from(dataPayloads[dataIdx]).toString("base64");
        cmds.push(`echo -n '${b64}' | base64 -d >&4`);
        dataIdx++;
      }
    } catch {
      // not valid JSON, skip
    }
  }
  cmds.push("sleep 30"); // Keep process alive

  const proc = Bun.spawn(["bash", "-c", cmds.join("\n")], {
    stdout: "pipe",
    stderr: "pipe",
    stdio: [undefined, undefined, undefined, "pipe", "pipe"],
  });

  return {
    metaFd: proc.stdio[3] as number,
    dataFd: proc.stdio[4] as number,
    cleanup: () => proc.kill(),
  };
}

describe("SidebandParser", () => {
  let cleanup: (() => void) | null = null;
  let parser: SidebandParser | null = null;

  afterEach(() => {
    parser?.stop();
    parser = null;
    cleanup?.();
    cleanup = null;
  });

  test("parses a single JSONL metadata message", async () => {
    const meta = JSON.stringify({ id: "test1", type: "image", format: "png" });
    const child = spawnWriter([meta]);
    cleanup = child.cleanup;

    const received: SidebandMetaMessage[] = [];
    parser = new SidebandParser(child.metaFd, child.dataFd);
    parser.onMeta = (msg) => received.push(msg);
    parser.start();

    await waitFor(() => received.length >= 1);
    expect(received[0].id).toBe("test1");
    expect(received[0].type).toBe("image");
    expect(received[0].format).toBe("png");
  });

  test("parses multiple JSONL messages", async () => {
    const lines = [
      JSON.stringify({ id: "a", type: "svg" }),
      JSON.stringify({ id: "b", type: "html" }),
      JSON.stringify({ id: "c", type: "clear" }),
    ];
    const child = spawnWriter(lines);
    cleanup = child.cleanup;

    const received: SidebandMetaMessage[] = [];
    parser = new SidebandParser(child.metaFd, child.dataFd);
    parser.onMeta = (msg) => received.push(msg);
    parser.start();

    await waitFor(() => received.length >= 3);
    expect(received[0].id).toBe("a");
    expect(received[1].id).toBe("b");
    expect(received[2].id).toBe("c");
  });

  test("reads binary payload correlated with metadata", async () => {
    const payload = new TextEncoder().encode("HELLO_BINARY");
    const meta = JSON.stringify({
      id: "img1",
      type: "image",
      format: "png",
      byteLength: payload.byteLength,
    });
    const child = spawnWriter([meta], [payload]);
    cleanup = child.cleanup;

    const receivedMeta: SidebandMetaMessage[] = [];
    const receivedData: { id: string; data: Uint8Array }[] = [];

    parser = new SidebandParser(child.metaFd, child.dataFd);
    parser.onMeta = (msg) => receivedMeta.push(msg);
    parser.onData = (id, data) => receivedData.push({ id, data });
    parser.start();

    await waitFor(() => receivedData.length >= 1);
    expect(receivedMeta[0].id).toBe("img1");
    expect(receivedData[0].id).toBe("img1");
    expect(new TextDecoder().decode(receivedData[0].data)).toBe("HELLO_BINARY");
  });

  test("reads multiple payloads in sequence", async () => {
    const p1 = new TextEncoder().encode("FIRST");
    const p2 = new TextEncoder().encode("SECOND_PAYLOAD");
    const lines = [
      JSON.stringify({ id: "p1", type: "image", byteLength: p1.byteLength }),
      JSON.stringify({ id: "p2", type: "svg", byteLength: p2.byteLength }),
    ];
    const child = spawnWriter(lines, [p1, p2]);
    cleanup = child.cleanup;

    const receivedData: { id: string; data: Uint8Array }[] = [];
    parser = new SidebandParser(child.metaFd, child.dataFd);
    parser.onMeta = () => {};
    parser.onData = (id, data) => receivedData.push({ id, data });
    parser.start();

    await waitFor(() => receivedData.length >= 2);
    expect(new TextDecoder().decode(receivedData[0].data)).toBe("FIRST");
    expect(new TextDecoder().decode(receivedData[1].data)).toBe(
      "SECOND_PAYLOAD",
    );
  });

  test("handles metadata without byteLength (no binary)", async () => {
    const meta = JSON.stringify({
      id: "upd1",
      type: "update",
      x: 100,
      y: 200,
    });
    const child = spawnWriter([meta]);
    cleanup = child.cleanup;

    const receivedMeta: SidebandMetaMessage[] = [];
    const receivedData: string[] = [];

    parser = new SidebandParser(child.metaFd, child.dataFd);
    parser.onMeta = (msg) => receivedMeta.push(msg);
    parser.onData = (id) => receivedData.push(id);
    parser.start();

    await waitFor(() => receivedMeta.length >= 1);
    expect(receivedMeta[0].id).toBe("upd1");
    expect(receivedMeta[0].type).toBe("update");
    expect(receivedData.length).toBe(0);
  });

  test("handles invalid JSON gracefully", async () => {
    const lines = [
      "NOT_VALID_JSON",
      JSON.stringify({ id: "valid", type: "clear" }),
    ];
    const child = spawnWriter(lines);
    cleanup = child.cleanup;

    const receivedMeta: SidebandMetaMessage[] = [];
    parser = new SidebandParser(child.metaFd, child.dataFd);
    parser.onMeta = (msg) => receivedMeta.push(msg);
    parser.start();

    await waitFor(() => receivedMeta.length >= 1);
    expect(receivedMeta[0].id).toBe("valid");
  });

  test("stop cancels readers", () => {
    // Use dummy fds — parser won't actually read
    parser = new SidebandParser(999, 998);
    parser.start();
    expect(() => parser!.stop()).not.toThrow();
    expect(() => parser!.stop()).not.toThrow();
  });
});
