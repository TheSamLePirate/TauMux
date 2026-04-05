import { describe, test, expect, afterEach } from "bun:test";
import { existsSync } from "fs";
import { SocketServer } from "../src/bun/socket-server";
import { connect } from "net";

const TEST_SOCKET = "/tmp/hyperterm-test.sock";

async function sendRpc(
  socketPath: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
    const payload = JSON.stringify({ id: "1", method, params }) + "\n";

    sock.on("connect", () => sock.write(payload));
    sock.on("data", (d) => {
      try {
        const res = JSON.parse(d.toString().trim());
        resolve(res);
      } catch (e) {
        reject(e);
      }
      sock.end();
    });
    sock.on("error", reject);
    setTimeout(() => reject(new Error("timeout")), 3000);
  });
}

describe("SocketServer", () => {
  let server: SocketServer | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
  });

  test("starts and responds to ping", async () => {
    server = new SocketServer(TEST_SOCKET, (method) => {
      if (method === "ping") return "PONG";
      throw new Error("unknown");
    });
    server.start();

    const res = (await sendRpc(TEST_SOCKET, "ping")) as {
      id: string;
      result: string;
    };
    expect(res.result).toBe("PONG");
  });

  test("returns error for unknown method", async () => {
    server = new SocketServer(TEST_SOCKET, (method) => {
      throw new Error(`Unknown: ${method}`);
    });
    server.start();

    const res = (await sendRpc(TEST_SOCKET, "bogus")) as {
      id: string;
      error: string;
    };
    expect(res.error).toContain("Unknown: bogus");
  });

  test("handles multiple requests on same connection", async () => {
    let callCount = 0;
    server = new SocketServer(TEST_SOCKET, () => {
      return ++callCount;
    });
    server.start();

    const res = await new Promise<number[]>((resolve, reject) => {
      const sock = connect(TEST_SOCKET);
      const results: number[] = [];
      sock.on("connect", () => {
        // Send two requests in one write
        sock.write(
          '{"id":"1","method":"a","params":{}}\n{"id":"2","method":"b","params":{}}\n',
        );
      });
      sock.on("data", (d) => {
        const lines = d.toString().trim().split("\n");
        for (const line of lines) {
          const r = JSON.parse(line);
          results.push(r.result);
        }
        if (results.length >= 2) {
          sock.end();
          resolve(results);
        }
      });
      sock.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 3000);
    });

    expect(res).toEqual([1, 2]);
  });

  test("passes params to handler", async () => {
    server = new SocketServer(TEST_SOCKET, (_method, params) => {
      return { echo: params };
    });
    server.start();

    const res = (await sendRpc(TEST_SOCKET, "test", {
      foo: "bar",
      num: 42,
    })) as {
      result: { echo: Record<string, unknown> };
    };
    expect(res.result.echo).toEqual({ foo: "bar", num: 42 });
  });

  test("handles async handlers", async () => {
    server = new SocketServer(TEST_SOCKET, async (method) => {
      await Bun.sleep(50);
      return `async-${method}`;
    });
    server.start();

    const res = (await sendRpc(TEST_SOCKET, "delayed")) as {
      result: string;
    };
    expect(res.result).toBe("async-delayed");
  });

  test("stop cleans up socket file", () => {
    server = new SocketServer(TEST_SOCKET, () => "ok");
    server.start();

    expect(existsSync(TEST_SOCKET)).toBe(true);

    server.stop();
    server = null;
    expect(existsSync(TEST_SOCKET)).toBe(false);
  });

  test("preserves request id in response", async () => {
    server = new SocketServer(TEST_SOCKET, () => "ok");
    server.start();

    const res = await new Promise<{ id: string }>((resolve, reject) => {
      const sock = connect(TEST_SOCKET);
      sock.on("connect", () => {
        sock.write('{"id":"my-custom-id","method":"x","params":{}}\n');
      });
      sock.on("data", (d) => {
        resolve(JSON.parse(d.toString().trim()));
        sock.end();
      });
      sock.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 3000);
    });

    expect(res.id).toBe("my-custom-id");
  });
});
