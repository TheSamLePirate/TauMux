import { test, expect } from "./fixtures";
import { WebSocket as NodeWS } from "ws";

/**
 * End-to-end terminal flow: browser loads the page, WS connects, xterm
 * renders, user types, shell echoes back, text appears in the DOM.
 * Exercises the full pipeline: HTTP fetch → xterm bundle init → WS
 * upgrade → hello/history replay → stdin encoding → WS send → PTY
 * write → stdout coalesce → WS broadcast → xterm.write → DOM.
 */
test.describe("web mirror: server-side WS round-trip (no browser)", () => {
  // A low-level test that pokes the server directly over WebSocket,
  // mirroring what the web-client does but without the browser/xterm
  // layer in the way. If this passes but the browser test below
  // fails, the gap is in the UI, not the server plumbing.
  test("stdin envelope produces stdout on WS", async ({ serverCtx }) => {
    const ws = new NodeWS(`ws://127.0.0.1:${serverCtx.port}/`);
    const seen: string[] = [];
    const marker = `WS_RT_${Date.now()}`;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("ws open timeout")),
        5_000,
      );
      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    ws.on("message", (data) => {
      const text =
        typeof data === "string"
          ? data
          : data instanceof Buffer
            ? data.toString("utf8")
            : "";
      if (!text || text[0] !== "{") return; // binary frames not relevant
      seen.push(text);
      // Debug aid: dump first 200 chars of each envelope to stderr so
      // CI traces show the sequence of messages the server sends.
      if (process.env["E2E_DEBUG"])
        process.stderr.write(`[ws] ${text.slice(0, 200)}\n`);
    });

    // Give the shell a moment to emit its prompt so the round-trip
    // doesn't race the login-profile sourcing.
    await new Promise((r) => setTimeout(r, 500));

    ws.send(
      JSON.stringify({
        type: "stdin",
        surfaceId: serverCtx.surfaceId,
        data: `echo ${marker}\n`,
      }),
    );

    await expect
      .poll(() => seen.some((s) => s.includes(marker)), {
        timeout: 10_000,
        message: "stdout with marker never arrived on WS",
      })
      .toBe(true);

    ws.close();
  });
});

test.describe("web mirror: terminal round-trip", () => {
  test("page loads, xterm renders, stdin is echoed back", async ({
    serverCtx,
    page,
  }) => {
    // Collect console errors so if anything blows up we see it in CI.
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(serverCtx.baseURL);

    // Wait for xterm to mount. xterm.js writes a single container with
    // class "xterm" that wraps the rows/viewport.
    const xterm = page.locator(".xterm").first();
    await expect(xterm).toBeVisible({ timeout: 10_000 });

    // The terminal has a textarea xterm uses to capture keystrokes.
    // Focus it before typing, otherwise keys go to the document body
    // and never reach the client-side stdin handler.
    const termTextarea = page.locator(".xterm-helper-textarea").first();
    await termTextarea.focus();

    // Type a unique marker so we can unambiguously find it in the
    // rendered output even if the shell prompt / MOTD already wrote
    // unrelated characters.
    const marker = `E2E_ROUNDTRIP_${Date.now()}`;
    await page.keyboard.type(`echo ${marker}`);
    await page.keyboard.press("Enter");

    // The marker appears in the DOM twice: once as the command echo
    // and once as the shell's stdout. Either counts — we just want to
    // see the round trip at least once. Use the xterm screen layer,
    // not the textarea, since that's where rendered cells live.
    const screen = page.locator(".xterm-rows").first();
    await expect(screen).toContainText(marker, { timeout: 10_000 });

    expect(consoleErrors).toEqual([]);
  });

  test("page with auth token loads via ?t= and round-trips", async ({
    boot,
    page,
  }) => {
    const ctx = await boot({ token: "s3cret" });
    await page.goto(ctx.urlWithToken("/"));

    await expect(page.locator(".xterm").first()).toBeVisible({
      timeout: 10_000,
    });

    await page.locator(".xterm-helper-textarea").first().focus();
    const marker = `AUTHED_${Date.now()}`;
    await page.keyboard.type(`echo ${marker}`);
    await page.keyboard.press("Enter");

    await expect(page.locator(".xterm-rows").first()).toContainText(marker, {
      timeout: 10_000,
    });
  });

  test("GET /nonexistent returns 404 (sanity: route whitelist holds)", async ({
    serverCtx,
    request,
  }) => {
    const res = await request.get(`${serverCtx.baseURL}/../etc/passwd`);
    // Exact status isn't the point — anything but 200 means the
    // whitelist caught it. Current impl returns 404.
    expect(res.status()).not.toBe(200);
  });
});
