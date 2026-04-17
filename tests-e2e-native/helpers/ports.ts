import { createServer } from "node:net";

/** Ask the kernel for a free TCP port by binding to 0 and immediately closing.
 *  Race-prone by design — callers should grab + use the port in the next few
 *  ms. Good enough for per-worker web-mirror ports where the window between
 *  allocation and the app binding the port is microseconds. */
export async function pickFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("could not pick free port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}
