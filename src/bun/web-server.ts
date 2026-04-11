import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { SessionManager } from "./session-manager";
import type { AppState } from "./rpc-handler";

// Read xterm.js assets at module load time. In dev mode they live under
// node_modules in the project root. In a packaged Electrobun app they are
// copied to the vendor/ directory next to the bun/ bundle via electrobun.config copy.

// Vendor directory inside the packaged .app (app/vendor/ sits next to app/bun/)
const VENDOR_DIR = resolve(import.meta.dir, "../vendor");

// Map from dev-mode node_modules paths to vendor filenames
const VENDOR_MAP: Record<string, string> = {
  "node_modules/xterm/lib/xterm.js": "xterm.js",
  "node_modules/xterm/css/xterm.css": "xterm.css",
  "node_modules/@xterm/addon-fit/lib/addon-fit.js": "addon-fit.js",
  "node_modules/@xterm/addon-web-links/lib/addon-web-links.js":
    "addon-web-links.js",
  "assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf":
    "fonts/nerd-regular.ttf",
  "assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf": "fonts/nerd-bold.ttf",
};

function findProjectRoot(): string {
  const startDir = import.meta.dir;
  const candidates = [
    resolve(startDir, ".."),
    process.cwd(),
    resolve(startDir, "../.."),
    resolve(startDir, "../../.."),
  ];
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    candidates.push(dir);
  }
  for (const dir of candidates) {
    try {
      readFileSync(resolve(dir, "node_modules/xterm/lib/xterm.js"), "utf-8");
      return dir;
    } catch {
      // try next
    }
  }
  return candidates[0];
}

const PROJECT_ROOT = findProjectRoot();

function readBinaryAsset(relativePath: string): Uint8Array | null {
  // Try project root first (dev mode)
  try {
    const buf = readFileSync(resolve(PROJECT_ROOT, relativePath));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {}
  // Fallback: vendor directory (packaged mode)
  const vendorName = VENDOR_MAP[relativePath];
  if (vendorName) {
    try {
      const buf = readFileSync(resolve(VENDOR_DIR, vendorName));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {}
  }
  return null;
}

function readAsset(relativePath: string): string {
  // Try project root first (dev mode)
  try {
    return readFileSync(resolve(PROJECT_ROOT, relativePath), "utf-8");
  } catch {}
  // Fallback: vendor directory (packaged mode)
  const vendorName = VENDOR_MAP[relativePath];
  if (vendorName) {
    try {
      return readFileSync(resolve(VENDOR_DIR, vendorName), "utf-8");
    } catch {}
  }
  return `/* asset not found: ${relativePath} */`;
}

const XTERM_JS = readAsset("node_modules/xterm/lib/xterm.js");
const XTERM_CSS = readAsset("node_modules/xterm/css/xterm.css");
const FIT_ADDON_JS = readAsset(
  "node_modules/@xterm/addon-fit/lib/addon-fit.js",
);
const WEB_LINKS_ADDON_JS = readAsset(
  "node_modules/@xterm/addon-web-links/lib/addon-web-links.js",
);
const NERD_FONT_REGULAR = readBinaryAsset(
  "assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf",
);
const NERD_FONT_BOLD = readBinaryAsset(
  "assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf",
);

interface ClientData {
  clientId: string;
  subscribedSurfaceIds: Set<string>;
}

type WS = { data: ClientData; send(data: string): void; close(): void };

export class WebServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private clients = new Set<WS>();
  private clientCounter = 0;

  // Called when a web client toggles the sidebar
  onSidebarToggle: ((visible: boolean) => void) | null = null;

  // Called when a web client clears notifications
  onClearNotifications: (() => void) | null = null;

  // Called when a web client changes a panel's position or size
  onPanelUpdate:
    | ((
        surfaceId: string,
        panelId: string,
        fields: Record<string, unknown>,
      ) => void)
    | null = null;

  constructor(
    private port: number,
    private sessions: SessionManager,
    private getAppState: () => AppState,
    private getFocusedSurfaceId: () => string | null,
    private getSidebarVisible: () => boolean = () => true,
  ) {}

  start(): void {
    if (this.server) return;
    // Clear cached page so restarts pick up code changes
    cachedPage = null;

    try {
      this.server = Bun.serve({
        port: this.port,
        hostname: "0.0.0.0",

        fetch: (req, server) => {
          const url = new URL(req.url);

          // WebSocket upgrade
          if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
            const data: ClientData = {
              clientId: `web:${++this.clientCounter}`,
              subscribedSurfaceIds: new Set<string>(),
            };
            const ok = server.upgrade(req, { data });
            if (ok) return undefined;
            return new Response("WebSocket upgrade failed", { status: 400 });
          }

          // Main page (all assets inlined)
          if (url.pathname === "/" || url.pathname === "/index.html") {
            return new Response(buildHtmlPage(), {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            });
          }

          // Serve Nerd Font files
          if (url.pathname === "/fonts/nerd-regular.ttf" && NERD_FONT_REGULAR) {
            return new Response(NERD_FONT_REGULAR.buffer as ArrayBuffer, {
              headers: {
                "content-type": "font/ttf",
                "cache-control": "public, max-age=31536000",
              },
            });
          }
          if (url.pathname === "/fonts/nerd-bold.ttf" && NERD_FONT_BOLD) {
            return new Response(NERD_FONT_BOLD.buffer as ArrayBuffer, {
              headers: {
                "content-type": "font/ttf",
                "cache-control": "public, max-age=31536000",
              },
            });
          }

          // Return valid empty source maps to suppress browser warnings
          if (url.pathname.endsWith(".map")) {
            return new Response('{"version":3,"sources":[],"mappings":""}', {
              headers: { "content-type": "application/json" },
            });
          }

          return new Response("Not found", { status: 404 });
        },

        websocket: {
          open: (ws: WS) => {
            this.clients.add(ws);

            // Send welcome with layout info
            const state = this.getAppState();
            const surfaces = this.sessions.getAllSurfaces().map((s) => ({
              id: s.id,
              title: s.title,
              cols: s.pty.cols,
              rows: s.pty.rows,
            }));
            const focusedSurfaceId = this.getFocusedSurfaceId();

            ws.send(
              JSON.stringify({
                type: "welcome",
                surfaces,
                focusedSurfaceId,
                activeWorkspaceId: state.activeWorkspaceId,
                sidebarVisible: this.getSidebarVisible(),
                workspaces: state.workspaces.map((w) => ({
                  id: w.id,
                  name: w.name,
                  color: w.color,
                  surfaceIds: w.surfaceIds,
                  focusedSurfaceId: w.focusedSurfaceId,
                  layout: w.layout,
                })),
              }),
            );

            // Subscribe to all surfaces in active workspace and send history
            const activeWs = state.workspaces.find(
              (w) => w.id === state.activeWorkspaceId,
            );
            if (activeWs) {
              for (const sid of activeWs.surfaceIds) {
                ws.data.subscribedSurfaceIds.add(sid);
                const history = this.sessions.getOutputHistory(sid);
                if (history) {
                  ws.send(
                    JSON.stringify({
                      type: "history",
                      surfaceId: sid,
                      data: history,
                    }),
                  );
                }
              }
            }
          },

          message: (ws: WS, raw: string | Buffer) => {
            const text = typeof raw === "string" ? raw : raw.toString();
            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(text);
            } catch {
              return;
            }

            switch (msg["type"]) {
              case "stdin": {
                const surfaceId = msg["surfaceId"] as string;
                const data = msg["data"] as string;
                if (surfaceId && data) {
                  this.sessions.writeStdin(surfaceId, data);
                }
                break;
              }
              case "sidebarToggle": {
                const visible = msg["visible"] as boolean;
                this.onSidebarToggle?.(visible);
                break;
              }
              case "clearNotifications": {
                this.onClearNotifications?.();
                break;
              }
              case "subscribeSurface": {
                const surfaceId = msg["surfaceId"] as string;
                if (!surfaceId) break;
                ws.data.subscribedSurfaceIds.add(surfaceId);
                const history = this.sessions.getOutputHistory(surfaceId);
                if (history) {
                  ws.send(
                    JSON.stringify({
                      type: "history",
                      surfaceId,
                      data: history,
                    }),
                  );
                }
                break;
              }
              case "subscribeWorkspace": {
                const workspaceId = msg["workspaceId"] as string;
                if (!workspaceId) break;
                const state = this.getAppState();
                const targetWs = state.workspaces.find(
                  (w) => w.id === workspaceId,
                );
                if (!targetWs) break;
                ws.data.subscribedSurfaceIds.clear();
                for (const sid of targetWs.surfaceIds) {
                  ws.data.subscribedSurfaceIds.add(sid);
                  const wsHistory = this.sessions.getOutputHistory(sid);
                  if (wsHistory) {
                    ws.send(
                      JSON.stringify({
                        type: "history",
                        surfaceId: sid,
                        data: wsHistory,
                      }),
                    );
                  }
                }
                break;
              }
              case "panelMouseEvent": {
                const surfaceId = msg["surfaceId"] as string;
                if (surfaceId) {
                  const panelEvt = {
                    id: msg["id"] as string,
                    event: msg["event"] as string,
                    x: msg["x"] as number | undefined,
                    y: msg["y"] as number | undefined,
                    width: msg["width"] as number | undefined,
                    height: msg["height"] as number | undefined,
                    button: msg["button"] as number | undefined,
                    buttons: msg["buttons"] as number | undefined,
                    deltaX: msg["deltaX"] as number | undefined,
                    deltaY: msg["deltaY"] as number | undefined,
                    cols: msg["cols"] as number | undefined,
                    rows: msg["rows"] as number | undefined,
                    pxWidth: msg["pxWidth"] as number | undefined,
                    pxHeight: msg["pxHeight"] as number | undefined,
                  };
                  // Send to script via fd5
                  this.sessions.sendEvent(surfaceId, panelEvt);
                  // Broadcast drag/resize/close to all web clients + host
                  const evt = panelEvt.event;
                  if (
                    evt === "dragend" ||
                    evt === "resize" ||
                    evt === "close"
                  ) {
                    this.broadcast({
                      type: "panelEvent",
                      surfaceId,
                      id: panelEvt.id,
                      event: evt,
                      x: panelEvt.x,
                      y: panelEvt.y,
                      width: panelEvt.width,
                      height: panelEvt.height,
                    });
                    // Notify host webview to update panel position/size
                    const fields: Record<string, unknown> = {};
                    if (panelEvt.x !== undefined) fields["x"] = panelEvt.x;
                    if (panelEvt.y !== undefined) fields["y"] = panelEvt.y;
                    if (panelEvt.width !== undefined)
                      fields["width"] = panelEvt.width;
                    if (panelEvt.height !== undefined)
                      fields["height"] = panelEvt.height;
                    this.onPanelUpdate?.(surfaceId, panelEvt.id!, fields);
                  }
                }
                break;
              }
            }
          },

          close: (ws: WS) => {
            this.clients.delete(ws);
          },
        },
      });

      console.log(`[web] Terminal mirror at http://0.0.0.0:${this.port}`);
      console.log(
        `[web] Anyone on your network can view and type in your terminal.`,
      );
    } catch (error) {
      this.server = null;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[web] Terminal mirror unavailable on port ${this.port}: ${message}`,
      );
    }
  }

  stop(): void {
    if (!this.server) return;
    for (const ws of this.clients) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.server.stop();
    this.server = null;
    console.log("[web] Terminal mirror stopped.");
  }

  get running(): boolean {
    return this.server !== null;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  broadcastStdout(surfaceId: string, data: string): void {
    const msg = JSON.stringify({ type: "stdout", surfaceId, data });
    for (const ws of this.clients) {
      if (ws.data.subscribedSurfaceIds.has(surfaceId)) {
        try {
          ws.send(msg);
        } catch {
          /* client gone */
        }
      }
    }
  }

  broadcast(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);
    for (const ws of this.clients) {
      try {
        ws.send(json);
      } catch {
        /* client gone */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Self-contained HTML page
// ---------------------------------------------------------------------------

// Cache the built page so we only concatenate once
let cachedPage: string | null = null;

function buildHtmlPage(): string {
  if (cachedPage) return cachedPage;
  // Assemble via array join — cannot use template literal interpolation because
  // xterm.js source contains backticks, ${} expressions, and </script> strings.
  const p: string[] = [];
  p.push('<!DOCTYPE html><html lang="en"><head>');
  p.push('<meta charset="UTF-8">');
  p.push(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
  );
  p.push("<title>HyperTerm Remote</title>");
  // no external font link — @font-face is in APP_CSS below
  // xterm.css
  p.push("<style>");
  p.push(XTERM_CSS);
  p.push("</style>");
  // App CSS
  p.push("<style>");
  p.push(APP_CSS);
  p.push("</style>");
  p.push("</head><body>");
  p.push(APP_HTML);
  // xterm.js + addons — each wrapped in an IIFE that shadows exports/module/define
  // so the UMD wrapper falls through to the global (window/self) assignment path.
  const umdPrefix =
    "<script>(function(){var exports=undefined,module=undefined,define=undefined;\n";
  const umdSuffix = "\n})()" + "</" + "script>";
  p.push(umdPrefix);
  p.push(XTERM_JS);
  p.push(umdSuffix);
  p.push(umdPrefix);
  p.push(FIT_ADDON_JS);
  p.push(umdSuffix);
  p.push(umdPrefix);
  p.push(WEB_LINKS_ADDON_JS);
  p.push(umdSuffix);
  // App JS
  p.push("<script>");
  p.push(APP_JS);
  p.push("</" + "script>");
  p.push("</body></html>");
  cachedPage = p.join("\n");
  return cachedPage;
}

// ---------------------------------------------------------------------------
// Static HTML / CSS / JS for the web client (no template literal interpolation)
// ---------------------------------------------------------------------------

const APP_CSS = `\
:root {
  --bg: #1e1e2e; --surface: #313244; --overlay: #45475a;
  --text: #cdd6f4; --subtext: #a6adc8;
  --blue: #89b4fa; --green: #a6e3a1; --yellow: #f9e2af; --red: #f38ba8;
}
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  height: 100%; width: 100%; overflow: hidden;
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}
#toolbar {
  height: 36px; display: flex; align-items: center; gap: 10px;
  padding: 0 12px; background: var(--surface);
  border-bottom: 1px solid var(--overlay); user-select: none; flex-shrink: 0;
}
#toolbar-title { font-size: 12px; font-weight: 600; color: var(--subtext); letter-spacing: 0.02em; }
#workspace-select {
  padding: 4px 8px; border-radius: 4px; background: var(--overlay); color: var(--text);
  border: 1px solid rgba(255,255,255,0.08); font-size: 12px; cursor: pointer; outline: none;
}
#workspace-select:focus { border-color: var(--blue); }
.toolbar-spacer { flex: 1; }
.toolbar-btn {
  width: 28px; height: 28px; display: grid; place-items: center; border-radius: 5px;
  border: none; cursor: pointer; background: transparent; color: var(--subtext); font-size: 14px;
  transition: background 0.15s, color 0.15s;
}
.toolbar-btn:hover { background: var(--overlay); color: var(--text); }
#status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); transition: background 0.3s; }
#status-dot.connected { background: var(--green); }
#status-dot.reconnecting { background: var(--yellow); }
#client-count { font-size: 10px; color: var(--subtext); }
#pane-container { position: absolute; top: 36px; left: 0; right: 0; bottom: 0; overflow: hidden; }
.pane {
  position: absolute; overflow: hidden; border: 1px solid rgba(255,255,255,0.06);
  transition: border-color 0.15s;
}
.pane:hover { border-color: rgba(255,255,255,0.15); }
.pane.focused { border-color: var(--blue); }
@keyframes notify-glow-pulse {
  0%  { border-color: rgba(168,85,247,0); box-shadow: 0 0 0 0 rgba(168,85,247,0), 0 0 0 0 rgba(168,85,247,0); }
  15% { border-color: rgba(168,85,247,0.7); box-shadow: 0 0 16px 2px rgba(168,85,247,0.5), 0 0 48px 8px rgba(168,85,247,0.15); }
  40% { border-color: rgba(103,232,249,0.5); box-shadow: 0 0 12px 1px rgba(103,232,249,0.4), 0 0 36px 6px rgba(103,232,249,0.1); }
  65% { border-color: rgba(168,85,247,0.4); box-shadow: 0 0 10px 1px rgba(168,85,247,0.3), 0 0 28px 4px rgba(168,85,247,0.08); }
  100% { border-color: rgba(255,255,255,0.06); box-shadow: 0 0 0 0 rgba(168,85,247,0), 0 0 0 0 rgba(168,85,247,0); }
}
@keyframes notify-bar-flash {
  0% { background: var(--surface); }
  12% { background: rgba(168,85,247,0.15); }
  40% { background: rgba(103,232,249,0.08); }
  100% { background: var(--surface); }
}
.pane.notify-glow { animation: notify-glow-pulse 2s ease-in-out infinite; z-index: 10; }
.pane.notify-glow .pane-bar { animation: notify-bar-flash 2s ease-in-out infinite; }
.pane-bar {
  position: relative; top: 0; left: 0; right: 0; height: 24px; z-index: 5;
  display: flex; align-items: center; padding: 0 8px; gap: 6px;
  background: var(--surface); border-bottom: 1px solid var(--overlay);
  font-size: 11px; color: var(--subtext); user-select: none; flex-shrink: 0;
}
.pane-bar-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pane-bar-btn {
  width: 20px; height: 20px; display: grid; place-items: center; border-radius: 3px;
  border: none; cursor: pointer; background: transparent; color: var(--subtext); font-size: 11px;
  transition: background 0.15s, color 0.15s; padding: 0; flex-shrink: 0;
}
.pane-bar-btn:hover { background: var(--overlay); color: var(--text); }
.pane-term { position: absolute; top: 24px; left: 0; right: 0; bottom: 0; overflow: hidden; }
.pane .xterm { height: 100%; }
.xterm-viewport { background-color: transparent !important; }
body.fullscreen-mode #pane-container .pane { display: none; }
body.fullscreen-mode #pane-container .pane.fullscreen-active {
  display: block; position: absolute; top: 0; left: 0; width: 100% !important; height: 100% !important;
  border: none;
}
body.fullscreen-mode .pane.fullscreen-active .pane-bar { display: none; }
body.fullscreen-mode .pane.fullscreen-active .pane-term { top: 0; }
#back-btn { display: none; }
body.fullscreen-mode #back-btn { display: grid; }
.web-panel {
  position: absolute; pointer-events: none; border-radius: 8px; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.08); background: rgba(14,18,27,0.9);
  backdrop-filter: blur(12px); z-index: 10;
}
.web-panel.interactive {
  pointer-events: auto; cursor: crosshair;
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
.web-panel.fixed { border: none; background: transparent; backdrop-filter: none; pointer-events: none; }
.web-panel.fixed.interactive { pointer-events: auto; }
.web-panel.draggable, .web-panel.resizable { pointer-events: auto; touch-action: none; }
.web-panel-drag {
  height: 22px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 8px; cursor: grab; user-select: none;
  background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-size: 10px; color: rgba(255,255,255,0.4);
}
.web-panel-drag:active { cursor: grabbing; }
.web-panel-resize {
  position: absolute; bottom: 0; right: 0; width: 14px; height: 14px;
  cursor: nwse-resize; opacity: 0; transition: opacity 0.15s;
}
.web-panel:hover .web-panel-resize { opacity: 0.7; }
.web-panel-resize::after {
  content: ''; position: absolute; bottom: 3px; right: 3px;
  width: 5px; height: 5px; border-right: 1.5px solid rgba(255,255,255,0.5);
  border-bottom: 1.5px solid rgba(255,255,255,0.5);
}
.web-panel-content { overflow: hidden; }
.web-panel-content img { width: 100%; height: 100%; object-fit: contain; display: block; }
#sidebar {
  position: absolute; top: 36px; right: 0; bottom: 0; width: 260px;
  background: linear-gradient(180deg, rgba(30,30,46,0.95), rgba(24,24,37,0.98));
  border-left: 1px solid var(--overlay); overflow-y: auto; overflow-x: hidden;
  transition: width 0.2s ease, opacity 0.2s ease;
  backdrop-filter: blur(16px); z-index: 20; user-select: none;
  padding: 10px 0;
}
#sidebar.collapsed { width: 0; opacity: 0; pointer-events: none; padding: 0; border-left: none; }
body:not(.sidebar-open) #pane-container { right: 0; }
body.sidebar-open #pane-container { right: 260px; transition: right 0.2s ease; }
.sb-section { padding: 6px 12px; }
.sb-section-title {
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--subtext); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;
}
.sb-section-clear {
  background: none; border: none; color: var(--subtext); cursor: pointer; font-size: 10px; padding: 2px 4px; border-radius: 3px;
}
.sb-section-clear:hover { background: var(--overlay); color: var(--text); }
.sb-ws {
  padding: 8px 10px; margin-bottom: 4px; border-radius: 6px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05);
  cursor: pointer; transition: background 0.15s, border-color 0.15s;
}
.sb-ws:hover { background: rgba(255,255,255,0.06); }
.sb-ws.active { border-color: var(--blue); background: rgba(137,180,250,0.06); }
.sb-ws-name { font-size: 11px; font-weight: 600; color: var(--text); margin-bottom: 2px; display: flex; align-items: center; gap: 6px; }
.sb-ws-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sb-ws-meta { font-size: 10px; color: var(--subtext); }
.sb-ws-pills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.sb-pill {
  font-size: 9px; padding: 1px 6px; border-radius: 8px;
  background: rgba(255,255,255,0.06); color: var(--subtext);
}
.sb-progress { margin-top: 4px; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; }
.sb-progress-bar { height: 100%; border-radius: 2px; background: var(--blue); transition: width 0.3s ease; }
.sb-notif {
  padding: 6px 8px; margin-bottom: 4px; border-radius: 4px;
  background: rgba(255,255,255,0.03); border-left: 2px solid rgba(168,85,247,0.5);
}
.sb-notif-title { font-size: 10px; font-weight: 600; color: var(--text); text-transform: uppercase; }
.sb-notif-body { font-size: 10px; color: var(--subtext); margin-top: 2px; }
.sb-notif-time { font-size: 9px; color: rgba(255,255,255,0.25); margin-top: 2px; }
.sb-log {
  padding: 3px 8px; font-size: 10px; color: var(--subtext); border-radius: 3px;
  margin-bottom: 2px; background: rgba(255,255,255,0.02);
}
.sb-log.error { color: var(--red); border-left: 2px solid var(--red); }
.sb-log.warning { color: var(--yellow); border-left: 2px solid var(--yellow); }
.sb-log.success { color: var(--green); border-left: 2px solid var(--green); }
.sb-empty { font-size: 10px; color: rgba(255,255,255,0.2); padding: 8px; text-align: center; font-style: italic; }
#sidebar-toggle-btn { display: grid; }
@media (max-width: 768px) {
  #toolbar { height: 32px; padding: 0 8px; gap: 6px; }
  #toolbar-title { display: none; }
  #pane-container { top: 32px; }
  #sidebar { top: 32px; width: 220px; }
  body.sidebar-open #pane-container { right: 220px; }
  body { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
}`;

const APP_HTML = `\
<div id="toolbar">
  <button class="toolbar-btn" id="back-btn" title="Back to split view">&#x2190;</button>
  <select id="workspace-select"></select>
  <span id="toolbar-title">HyperTerm Remote</span>
  <span class="toolbar-spacer"></span>
  <span id="client-count"></span>
  <button class="toolbar-btn" id="sidebar-toggle-btn" title="Toggle Sidebar">&#x2261;</button>
  <button class="toolbar-btn" id="fullscreen-btn" title="Fullscreen">&#x26F6;</button>
  <div id="status-dot"></div>
</div>
<div id="pane-container"></div>
<div id="sidebar" class="collapsed"></div>`;

// Client-side JS — uses only regular strings (no backticks) to be safe
// inside the concatenated HTML output.
const APP_JS = [
  "// Load JetBrains Mono Nerd Font from our server (same-origin, works in Safari)",
  "var fr = new FontFace('JetBrainsMono Nerd Font Mono', 'url(/fonts/nerd-regular.ttf)', { style: 'normal', weight: '400' });",
  "var fb = new FontFace('JetBrainsMono Nerd Font Mono', 'url(/fonts/nerd-bold.ttf)', { style: 'normal', weight: '700' });",
  "document.fonts.add(fr); document.fonts.add(fb);",
  "Promise.all([fr.load(), fb.load()]).then(function() { return document.fonts.ready; }).then(function() {",
  "",
  "var TERM_THEME = {",
  '  background: "#1e1e2e", foreground: "#cdd6f4",',
  '  cursor: "#f5e0dc", cursorAccent: "#1e1e2e",',
  '  selectionBackground: "#585b70", selectionForeground: "#cdd6f4",',
  '  black: "#45475a", red: "#f38ba8", green: "#a6e3a1",',
  '  yellow: "#f9e2af", blue: "#89b4fa", magenta: "#f5c2e7",',
  '  cyan: "#94e2d5", white: "#bac2de",',
  '  brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1",',
  '  brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#f5c2e7",',
  '  brightCyan: "#94e2d5", brightWhite: "#a6adc8"',
  "};",
  "var TERM_OPTS = {",
  "  theme: TERM_THEME,",
  "  fontFamily: \"'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Fira Code', monospace\",",
  "  fontSize: 14, lineHeight: 1.2,",
  '  cursorBlink: true, cursorStyle: "bar",',
  "  scrollback: 10000",
  "};",
  "",
  "// --- State ---",
  'var container = document.getElementById("pane-container");',
  'var wsSelectEl = document.getElementById("workspace-select");',
  'var dotEl = document.getElementById("status-dot");',
  'var fsBtn = document.getElementById("fullscreen-btn");',
  'var backBtn = document.getElementById("back-btn");',
  "var panes = {};          // surfaceId -> { term, fitAddon, el, termEl, barTitle, title }",
  "var surfaceTitles = {};  // surfaceId -> title string",
  "var surfaceSizes = {};   // surfaceId -> { cols, rows }",
  "var workspaces = [];     // latest workspace state from server",
  "var activeWorkspaceId = null;",
  "var focusedSurfaceId = null;",
  "var fullscreenSurfaceId = null;",
  "var panels = {};",
  "var sidebarOpen = false;",
  "var sidebarNotifs = [];",
  "var sidebarLogs = [];",
  "var sidebarStatus = {};", // workspaceId -> { key -> {value,icon,color} }
  "var sidebarProgress = {};", // workspaceId -> {value,label}
  'var sidebarEl = document.getElementById("sidebar");',
  'var sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");',
  "var GAP = 2;",
  "",
  "// --- Layout computation from PaneNode tree ---",
  "function computeRects(node, bounds) {",
  "  var result = {};",
  "  computeNode(node, bounds, result);",
  "  return result;",
  "}",
  "function computeNode(node, bounds, result) {",
  '  if (node.type === "leaf") { result[node.surfaceId] = bounds; return; }',
  "  var dir = node.direction, ratio = node.ratio, ch = node.children;",
  "  var half = GAP / 2;",
  '  if (dir === "horizontal") {',
  "    var sx = bounds.x + bounds.w * ratio;",
  "    computeNode(ch[0], { x: bounds.x, y: bounds.y, w: sx - bounds.x - half, h: bounds.h }, result);",
  "    computeNode(ch[1], { x: sx + half, y: bounds.y, w: bounds.x + bounds.w - sx - half, h: bounds.h }, result);",
  "  } else {",
  "    var sy = bounds.y + bounds.h * ratio;",
  "    computeNode(ch[0], { x: bounds.x, y: bounds.y, w: bounds.w, h: sy - bounds.y - half }, result);",
  "    computeNode(ch[1], { x: bounds.x, y: sy + half, w: bounds.w, h: bounds.y + bounds.h - sy - half }, result);",
  "  }",
  "}",
  "",
  "// --- Pane management ---",
  "function getOrCreatePane(surfaceId) {",
  "  if (panes[surfaceId]) return panes[surfaceId];",
  "  var el = document.createElement('div');",
  "  el.className = 'pane';",
  "  el.setAttribute('data-surface', surfaceId);",
  "  // Title bar",
  "  var bar = document.createElement('div');",
  "  bar.className = 'pane-bar';",
  "  var barTitle = document.createElement('span');",
  "  barTitle.className = 'pane-bar-title';",
  "  barTitle.textContent = surfaceTitles[surfaceId] || surfaceId;",
  "  bar.appendChild(barTitle);",
  "  var fsBtn = document.createElement('button');",
  "  fsBtn.className = 'pane-bar-btn';",
  "  fsBtn.title = 'Fullscreen';",
  "  fsBtn.innerHTML = '&#x26F6;';",
  "  fsBtn.addEventListener('click', function(e) { e.stopPropagation(); enterFullscreen(surfaceId); });",
  "  bar.appendChild(fsBtn);",
  "  el.appendChild(bar);",
  "  // Terminal area",
  "  var termEl = document.createElement('div');",
  "  termEl.className = 'pane-term';",
  "  el.appendChild(termEl);",
  "  container.appendChild(el);",
  "  var term = new Terminal(TERM_OPTS);",
  "  var fitAddon = new FitAddon.FitAddon();",
  "  term.loadAddon(fitAddon);",
  "  term.loadAddon(new WebLinksAddon.WebLinksAddon());",
  "  term.open(termEl);",
  "  term.onData(function(data) { sendMsg({ type: 'stdin', surfaceId: surfaceId, data: data }); });",
  "  term.onBinary(function(data) { sendMsg({ type: 'stdin', surfaceId: surfaceId, data: data }); });",
  "  // Click selects pane (does not fullscreen)",
  "  el.addEventListener('click', function() { selectPane(surfaceId); });",
  "  var p = { term: term, fitAddon: fitAddon, el: el, termEl: termEl, barTitle: barTitle, title: surfaceTitles[surfaceId] || surfaceId };",
  "  panes[surfaceId] = p;",
  "  return p;",
  "}",
  "",
  "function selectPane(surfaceId) {",
  "  focusedSurfaceId = surfaceId;",
  "  for (var fid in panes) {",
  "    if (fid === surfaceId) { panes[fid].el.classList.add('focused'); panes[fid].term.focus(); }",
  "    else panes[fid].el.classList.remove('focused');",
  "  }",
  "  clearGlow(surfaceId);",
  "}",
  "",
  "function triggerGlow(surfaceId) {",
  "  if (surfaceId && panes[surfaceId]) { panes[surfaceId].el.classList.add('notify-glow'); return; }",
  "  for (var id in panes) panes[id].el.classList.add('notify-glow');",
  "}",
  "",
  "function clearGlow(surfaceId) {",
  "  if (surfaceId) { if (panes[surfaceId]) panes[surfaceId].el.classList.remove('notify-glow'); }",
  "  else { for (var id in panes) panes[id].el.classList.remove('notify-glow'); }",
  "}",
  "",
  "// --- Sidebar ---",
  "function setSidebarOpen(open) {",
  "  sidebarOpen = open;",
  "  sidebarEl.classList.toggle('collapsed', !open);",
  "  document.body.classList.toggle('sidebar-open', open);",
  "}",
  "",
  "function toggleSidebar() {",
  "  setSidebarOpen(!sidebarOpen);",
  "  sendMsg({ type: 'sidebarToggle', visible: sidebarOpen });",
  "}",
  "",
  "sidebarToggleBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleSidebar(); });",
  "",
  "function renderSidebar() {",
  "  var html = '';",
  "  // Workspaces",
  '  html += \'<div class="sb-section"><div class="sb-section-title">Workspaces</div>\';',
  "  if (workspaces.length === 0) { html += '<div class=\"sb-empty\">No workspaces</div>'; }",
  "  else {",
  "    workspaces.forEach(function(ws, i) {",
  "      var active = ws.id === activeWorkspaceId;",
  "      var color = ws.color || '#89b4fa';",
  "      html += '<div class=\"sb-ws' + (active ? ' active' : '') + '\">';",
  "      html += '<div class=\"sb-ws-name\"><span class=\"sb-ws-dot\" style=\"background:' + color + '\"></span>' + (ws.name || 'Workspace ' + (i+1)) + '</div>';",
  "      var count = ws.surfaceIds ? ws.surfaceIds.length : 0;",
  "      html += '<div class=\"sb-ws-meta\">' + (active ? 'Active' : 'Standby') + ' &middot; ' + count + ' pane' + (count !== 1 ? 's' : '') + '</div>';",
  "      // Status pills",
  "      var st = sidebarStatus[ws.id];",
  "      if (st) {",
  "        html += '<div class=\"sb-ws-pills\">';",
  "        for (var k in st) html += '<span class=\"sb-pill\">' + k + ': ' + st[k].value + '</span>';",
  "        html += '</div>';",
  "      }",
  "      // Progress",
  "      var pr = sidebarProgress[ws.id];",
  "      if (pr) {",
  '        html += \'<div class="sb-progress"><div class="sb-progress-bar" style="width:\' + Math.min(100, Math.max(0, pr.value)) + \'%"></div></div>\';',
  "      }",
  "      html += '</div>';",
  "    });",
  "  }",
  "  html += '</div>';",
  "  // Notifications",
  "  if (sidebarNotifs.length > 0) {",
  '    html += \'<div class="sb-section"><div class="sb-section-title">Notifications (\' + sidebarNotifs.length + \')<button class="sb-section-clear" onclick="clearNotifs()">&times;</button></div>\';',
  "    for (var ni = sidebarNotifs.length - 1; ni >= Math.max(0, sidebarNotifs.length - 5); ni--) {",
  "      var n = sidebarNotifs[ni];",
  "      html += '<div class=\"sb-notif\">';",
  "      html += '<div class=\"sb-notif-title\">' + n.title + '</div>';",
  "      if (n.body) html += '<div class=\"sb-notif-body\">' + n.body + '</div>';",
  "      html += '</div>';",
  "    }",
  "    html += '</div>';",
  "  }",
  "  // Logs",
  "  if (sidebarLogs.length > 0) {",
  '    html += \'<div class="sb-section"><div class="sb-section-title">Logs (\' + sidebarLogs.length + \')<button class="sb-section-clear" onclick="clearLogs()">&times;</button></div>\';',
  "    for (var li = sidebarLogs.length - 1; li >= Math.max(0, sidebarLogs.length - 10); li--) {",
  "      var l = sidebarLogs[li];",
  "      var cls = (l.level === 'error' || l.level === 'warning' || l.level === 'success') ? ' ' + l.level : '';",
  "      html += '<div class=\"sb-log' + cls + '\">' + l.message + '</div>';",
  "    }",
  "    html += '</div>';",
  "  }",
  "  sidebarEl.innerHTML = html;",
  "}",
  "",
  "function clearNotifs() { sidebarNotifs = []; clearGlow(); renderSidebar(); sendMsg({ type: 'clearNotifications' }); }",
  "function clearLogs() { sidebarLogs = []; renderSidebar(); }",
  "// Expose for inline onclick",
  "window.clearNotifs = clearNotifs;",
  "window.clearLogs = clearLogs;",
  "",
  "function removePane(surfaceId) {",
  "  var p = panes[surfaceId];",
  "  if (!p) return;",
  "  p.term.dispose();",
  "  p.el.remove();",
  "  delete panes[surfaceId];",
  "  if (fullscreenSurfaceId === surfaceId) exitFullscreen();",
  "}",
  "",
  "function applyLayout() {",
  "  var ws = workspaces.find(function(w) { return w.id === activeWorkspaceId; });",
  "  if (!ws) return;",
  "  var cw = container.offsetWidth;",
  "  var ch = container.offsetHeight;",
  "  if (!cw || !ch) return;",
  "  var rects = computeRects(ws.layout, { x: 0, y: 0, w: cw, h: ch });",
  "  // Track which surfaces are in the layout",
  "  var activeSids = {};",
  "  for (var sid in rects) activeSids[sid] = true;",
  "  // Remove panes not in layout",
  "  for (var id in panes) {",
  "    if (!activeSids[id]) removePane(id);",
  "  }",
  "  // Position panes",
  "  for (var sid in rects) {",
  "    var r = rects[sid];",
  "    var p = getOrCreatePane(sid);",
  "    p.el.style.left = Math.round(r.x) + 'px';",
  "    p.el.style.top = Math.round(r.y) + 'px';",
  "    p.el.style.width = Math.round(r.w) + 'px';",
  "    p.el.style.height = Math.round(r.h) + 'px';",
  "    if (sid === focusedSurfaceId) p.el.classList.add('focused');",
  "    else p.el.classList.remove('focused');",
  "  }",
  "}",
  "",
  "// --- Fullscreen mode ---",
  "function enterFullscreen(surfaceId) {",
  "  fullscreenSurfaceId = surfaceId;",
  "  document.body.classList.add('fullscreen-mode');",
  "  var p = panes[surfaceId];",
  "  if (p) {",
  "    p.el.classList.add('fullscreen-active');",
  "    p.term.focus();",
  "  }",
  "}",
  "",
  "function exitFullscreen() {",
  "  document.body.classList.remove('fullscreen-mode');",
  "  if (fullscreenSurfaceId && panes[fullscreenSurfaceId]) {",
  "    panes[fullscreenSurfaceId].el.classList.remove('fullscreen-active');",
  "  }",
  "  fullscreenSurfaceId = null;",
  "  applyLayout();",
  "}",
  "",
  "backBtn.addEventListener('click', function(e) { e.stopPropagation(); exitFullscreen(); });",
  "",
  'fsBtn.addEventListener("click", function() {',
  "  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function(){});",
  "  else document.exitFullscreen().catch(function(){});",
  "});",
  "",
  "// --- Workspace select ---",
  "function updateWorkspaceSelect() {",
  "  wsSelectEl.innerHTML = '';",
  "  workspaces.forEach(function(ws) {",
  "    var opt = document.createElement('option'); opt.value = ws.id;",
  "    opt.textContent = ws.name || ws.id;",
  "    if (ws.id === activeWorkspaceId) opt.selected = true;",
  "    wsSelectEl.appendChild(opt);",
  "  });",
  "}",
  "",
  "function updatePaneTitles() {",
  "  for (var sid in panes) {",
  "    var t = surfaceTitles[sid];",
  "    if (t && panes[sid].barTitle) { panes[sid].barTitle.textContent = t; panes[sid].title = t; }",
  "  }",
  "}",
  "",
  "function applySizes() {",
  "  for (var sid in surfaceSizes) {",
  "    var p = panes[sid];",
  "    var sz = surfaceSizes[sid];",
  "    if (p && sz && sz.cols && sz.rows) {",
  "      try { p.term.resize(sz.cols, sz.rows); } catch(e) {}",
  "    }",
  "  }",
  "}",
  "",
  "wsSelectEl.addEventListener('change', function() {",
  "  var wsId = wsSelectEl.value;",
  "  if (wsId && wsId !== activeWorkspaceId) {",
  "    activeWorkspaceId = wsId;",
  "    if (fullscreenSurfaceId) exitFullscreen();",
  "    sendMsg({ type: 'subscribeWorkspace', workspaceId: wsId });",
  "    applyLayout();",
  "  }",
  "});",
  "",
  "// --- Panels (sideband content overlays) ---",
  "function handleSidebandMeta(msg) {",
  "  var id = msg.id; if (!id) return;",
  "  var pane = panes[msg.surfaceId]; if (!pane) return;",
  '  if (msg.type === "clear") { var p = panels[id]; if (p) { p.el.remove(); delete panels[id]; } return; }',
  '  if (msg.type === "update") {',
  "    var p = panels[id]; if (!p) return;",
  '    if (msg.x !== undefined) p.el.style.left = msg.x + "px";',
  '    if (msg.y !== undefined) p.el.style.top = msg.y + "px";',
  '    if (msg.width !== undefined && msg.width !== "auto") p.el.style.width = msg.width + "px";',
  '    if (msg.height !== undefined && msg.height !== "auto") p.el.style.height = msg.height + "px";',
  "    if (msg.opacity !== undefined) p.el.style.opacity = msg.opacity;",
  "    if (msg.data !== undefined) p.contentEl.innerHTML = msg.data;",
  "    return;",
  "  }",
  "  var existing = panels[id]; if (existing) existing.el.remove();",
  "  var isFixed = msg.position === 'fixed';",
  '  var el = document.createElement("div"); el.className = "web-panel" + (isFixed ? " fixed" : "");',
  '  if (msg.x !== undefined) el.style.left = msg.x + "px";',
  '  if (msg.y !== undefined) el.style.top = msg.y + "px";',
  '  if (msg.width !== undefined && msg.width !== "auto") el.style.width = msg.width + "px";',
  '  if (msg.height !== undefined && msg.height !== "auto") el.style.height = msg.height + "px";',
  "  if (msg.opacity !== undefined) el.style.opacity = msg.opacity;",
  "  if (msg.zIndex !== undefined) el.style.zIndex = msg.zIndex;",
  "  var draggable = isFixed ? false : (msg.draggable !== undefined ? msg.draggable : (msg.position === 'float'));",
  "  var resizable = isFixed ? false : (msg.resizable !== undefined ? msg.resizable : (msg.position === 'float'));",
  "  if (draggable) {",
  '    el.classList.add("draggable");',
  '    var dragH = document.createElement("div"); dragH.className = "web-panel-drag";',
  "    dragH.textContent = id;",
  "    el.insertBefore(dragH, el.firstChild);",
  "    setupPanelDrag(el, dragH, id, msg.surfaceId);",
  "  }",
  '  var contentEl = document.createElement("div"); contentEl.className = "web-panel-content";',
  "  el.appendChild(contentEl);",
  "  if (resizable) {",
  '    el.classList.add("resizable");',
  '    var resizeH = document.createElement("div"); resizeH.className = "web-panel-resize";',
  "    el.appendChild(resizeH);",
  "    setupPanelResize(el, resizeH, id, msg.surfaceId);",
  "  }",
  "  pane.el.appendChild(el);",
  "  if (msg.interactive) { el.classList.add('interactive'); setupPanelMouse(contentEl, id, msg.surfaceId); }",
  "  panels[id] = { el: el, contentEl: contentEl, meta: msg };",
  "  // Send terminal resize with pixel dimensions so scripts can size panels accurately",
  "  var rect = pane.el.getBoundingClientRect();",
  "  var pxW = Math.round(rect.width); var pxH = Math.round(rect.height);",
  "  if (pxW > 0 && pxH > 0 && pane.term) {",
  "    sendMsg({ type: 'panelMouseEvent', surfaceId: msg.surfaceId, id: '__terminal__', event: 'resize',",
  "      cols: pane.term.cols, rows: pane.term.rows, pxWidth: pxW, pxHeight: pxH });",
  "  }",
  "}",
  "",
  "function txy(e) { var t = e.touches ? e.touches[0] || e.changedTouches[0] : e; return t || e; }",
  "",
  "var lastMoveTime = 0;",
  "function setupPanelMouse(el, panelId, surfaceId) {",
  "  function sendXY(evtName, cx, cy, btn, btns) {",
  "    var rect = el.getBoundingClientRect();",
  "    sendMsg({ type: 'panelMouseEvent', surfaceId: surfaceId, id: panelId, event: evtName,",
  "      x: Math.round(cx - rect.left), y: Math.round(cy - rect.top),",
  "      button: btn, buttons: btns });",
  "  }",
  "  el.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); sendXY('mousedown', e.clientX, e.clientY, e.button, e.buttons); });",
  "  el.addEventListener('mouseup', function(e) { e.stopPropagation(); sendXY('mouseup', e.clientX, e.clientY, e.button, 0); });",
  "  el.addEventListener('click', function(e) { e.stopPropagation(); sendXY('click', e.clientX, e.clientY, e.button, 0); });",
  "  el.addEventListener('mousemove', function(e) {",
  "    var now = Date.now(); if (now - lastMoveTime < 16) return; lastMoveTime = now;",
  "    sendXY('mousemove', e.clientX, e.clientY, 0, e.buttons);",
  "  });",
  "  el.addEventListener('mouseenter', function(e) { sendXY('mouseenter', e.clientX, e.clientY, 0, e.buttons); });",
  "  el.addEventListener('mouseleave', function(e) { sendXY('mouseleave', e.clientX, e.clientY, 0, 0); });",
  "  el.addEventListener('touchstart', function(e) {",
  "    e.preventDefault(); e.stopPropagation(); var t = e.touches[0];",
  "    if (t) sendXY('mousedown', t.clientX, t.clientY, 0, 1);",
  "    function onTouchMove(me) { me.preventDefault(); var mt = me.touches[0]; if (mt) sendXY('mousemove', mt.clientX, mt.clientY, 0, 1); }",
  "    function onTouchEnd(me) {",
  "      document.removeEventListener('touchmove', onTouchMove);",
  "      document.removeEventListener('touchend', onTouchEnd);",
  "      document.removeEventListener('touchcancel', onTouchEnd);",
  "      var ct = me.changedTouches[0]; if (ct) sendXY('mouseup', ct.clientX, ct.clientY, 0, 0);",
  "    }",
  "    document.addEventListener('touchmove', onTouchMove, { passive: false });",
  "    document.addEventListener('touchend', onTouchEnd);",
  "    document.addEventListener('touchcancel', onTouchEnd);",
  "  }, { passive: false });",
  "  el.addEventListener('wheel', function(e) {",
  "    var rect = el.getBoundingClientRect();",
  "    sendMsg({ type: 'panelMouseEvent', surfaceId: surfaceId, id: panelId, event: 'wheel',",
  "      x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top),",
  "      deltaX: Math.round(e.deltaX), deltaY: Math.round(e.deltaY), buttons: e.buttons });",
  "  }, { passive: true });",
  "}",
  "",
  "function setupPanelDrag(el, handle, panelId, surfaceId) {",
  "  function startDrag(e) {",
  "    e.preventDefault(); e.stopPropagation();",
  "    var p = txy(e);",
  "    var startX = p.clientX, startY = p.clientY;",
  "    var startLeft = parseInt(el.style.left) || 0;",
  "    var startTop = parseInt(el.style.top) || 0;",
  "    function onMove(me) { var mp = txy(me); el.style.left = (startLeft + mp.clientX - startX) + 'px'; el.style.top = (startTop + mp.clientY - startY) + 'px'; }",
  "    function onUp() {",
  "      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);",
  "      document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);",
  "      sendMsg({ type: 'panelMouseEvent', surfaceId: surfaceId, id: panelId, event: 'dragend', x: parseInt(el.style.left) || 0, y: parseInt(el.style.top) || 0 });",
  "    }",
  "    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);",
  "    document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);",
  "  }",
  "  handle.addEventListener('mousedown', startDrag);",
  "  handle.addEventListener('touchstart', startDrag, { passive: false });",
  "}",
  "",
  "function setupPanelResize(el, handle, panelId, surfaceId) {",
  "  function startResize(e) {",
  "    e.preventDefault(); e.stopPropagation();",
  "    var p = txy(e); var startX = p.clientX, startY = p.clientY;",
  "    var startW = el.offsetWidth, startH = el.offsetHeight;",
  "    function onMove(me) { if (me.preventDefault) me.preventDefault(); var mp = txy(me); el.style.width = Math.max(120, startW + mp.clientX - startX) + 'px'; el.style.height = Math.max(72, startH + mp.clientY - startY) + 'px'; }",
  "    function onUp() {",
  "      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);",
  "      document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);",
  "      sendMsg({ type: 'panelMouseEvent', surfaceId: surfaceId, id: panelId, event: 'resize', width: el.offsetWidth, height: el.offsetHeight });",
  "    }",
  "    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);",
  "    document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);",
  "  }",
  "  handle.addEventListener('mousedown', startResize);",
  "  handle.addEventListener('touchstart', startResize, { passive: false });",
  "}",
  "",
  "function handleSidebandData(msg) {",
  "  var p = panels[msg.id]; if (!p) return;",
  "  var meta = p.meta;",
  '  if (meta.type === "image") {',
  '    var fmtMap = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };',
  '    var mime = fmtMap[meta.format || "png"] || "image/png";',
  "    var binary = atob(msg.data); var bytes = new Uint8Array(binary.length);",
  "    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);",
  "    var blob = new Blob([bytes.buffer], { type: mime });",
  "    var url = URL.createObjectURL(blob);",
  "    p.contentEl.innerHTML = '<img src=\"' + url + '\">';",
  '  } else if (meta.type === "svg") { p.contentEl.innerHTML = atob(msg.data); }',
  '  else if (meta.type === "html") { p.contentEl.innerHTML = atob(msg.data); }',
  "}",
  "",
  "function clearPanels() { for (var id in panels) { panels[id].el.remove(); } panels = {}; }",
  "function clearAllPanes() { for (var id in panes) { removePane(id); } }",
  "",
  "function handleSidebarAction(action, p) {",
  "  if (action === 'setStatus') {",
  "    var wsId = p.workspaceId || activeWorkspaceId;",
  "    if (!sidebarStatus[wsId]) sidebarStatus[wsId] = {};",
  "    if (p.key) sidebarStatus[wsId][p.key] = { value: p.value || '', icon: p.icon, color: p.color };",
  "  } else if (action === 'clearStatus') {",
  "    var wsId = p.workspaceId || activeWorkspaceId;",
  "    if (sidebarStatus[wsId] && p.key) delete sidebarStatus[wsId][p.key];",
  "  } else if (action === 'setProgress') {",
  "    var wsId = p.workspaceId || activeWorkspaceId;",
  "    sidebarProgress[wsId] = { value: p.value || 0, label: p.label };",
  "  } else if (action === 'clearProgress') {",
  "    var wsId = p.workspaceId || activeWorkspaceId;",
  "    delete sidebarProgress[wsId];",
  "  } else if (action === 'log') {",
  "    sidebarLogs.push({ level: p.level || 'info', message: p.message || '', source: p.source });",
  "  }",
  "  renderSidebar();",
  "}",
  "",
  "// --- WebSocket ---",
  "var ws = null; var reconnectDelay = 1000;",
  "function setStatus(s) { dotEl.className = s; }",
  "function sendMsg(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }",
  "",
  "function connect() {",
  '  var proto = location.protocol === "https:" ? "wss:" : "ws:";',
  '  ws = new WebSocket(proto + "//" + location.host);',
  '  setStatus("reconnecting");',
  '  ws.onopen = function() { setStatus("connected"); reconnectDelay = 1000; };',
  "  ws.onmessage = function(event) {",
  "    var msg; try { msg = JSON.parse(event.data); } catch(e) { return; }",
  "    switch (msg.type) {",
  '      case "welcome":',
  "        workspaces = msg.workspaces || [];",
  "        activeWorkspaceId = msg.activeWorkspaceId || (workspaces[0] && workspaces[0].id) || null;",
  "        focusedSurfaceId = msg.focusedSurfaceId || null;",
  "        if (msg.surfaces) msg.surfaces.forEach(function(s) {",
  "          surfaceTitles[s.id] = s.title;",
  "          surfaceSizes[s.id] = { cols: s.cols, rows: s.rows };",
  "        });",
  "        if (msg.sidebarVisible !== undefined) setSidebarOpen(msg.sidebarVisible);",
  "        updateWorkspaceSelect();",
  "        updatePaneTitles();",
  "        applyLayout();",
  "        applySizes();",
  "        renderSidebar();",
  "        break;",
  '      case "history":',
  "        var hp = panes[msg.surfaceId];",
  "        if (hp) { hp.term.reset(); hp.term.write(msg.data); }",
  "        break;",
  '      case "stdout":',
  "        var sp = panes[msg.surfaceId];",
  "        if (sp) sp.term.write(msg.data);",
  "        break;",
  '      case "resize":',
  "        if (msg.surfaceId && msg.cols && msg.rows) {",
  "          surfaceSizes[msg.surfaceId] = { cols: msg.cols, rows: msg.rows };",
  "          var rp = panes[msg.surfaceId];",
  "          if (rp) { try { rp.term.resize(msg.cols, msg.rows); } catch(e) {} }",
  "        }",
  "        break;",
  '      case "surfaceCreated":',
  "        if (msg.title) surfaceTitles[msg.surfaceId] = msg.title;",
  "        sendMsg({ type: 'subscribeSurface', surfaceId: msg.surfaceId });",
  "        break;",
  '      case "surfaceClosed":',
  "        removePane(msg.surfaceId);",
  "        break;",
  '      case "layoutChanged":',
  "        workspaces = msg.workspaces || [];",
  "        activeWorkspaceId = msg.activeWorkspaceId || activeWorkspaceId;",
  "        focusedSurfaceId = msg.focusedSurfaceId || focusedSurfaceId;",
  "        updateWorkspaceSelect();",
  "        applyLayout();",
  "        renderSidebar();",
  "        break;",
  '      case "focusChanged":',
  "        focusedSurfaceId = msg.surfaceId;",
  "        for (var fid in panes) {",
  "          if (fid === msg.surfaceId) panes[fid].el.classList.add('focused');",
  "          else panes[fid].el.classList.remove('focused');",
  "        }",
  "        break;",
  '      case "notification":',
  "        sidebarNotifs.push({ title: msg.title || '', body: msg.body || '', surfaceId: msg.surfaceId });",
  "        triggerGlow(msg.surfaceId || null);",
  "        renderSidebar();",
  "        break;",
  '      case "notificationClear":',
  "        sidebarNotifs = [];",
  "        clearGlow();",
  "        renderSidebar();",
  "        break;",
  '      case "sidebarState":',
  "        setSidebarOpen(msg.visible);",
  "        break;",
  '      case "sidebarAction":',
  "        handleSidebarAction(msg.action, msg.payload || {});",
  "        break;",
  '      case "sidebandMeta":',
  "        handleSidebandMeta(Object.assign({}, msg.meta, { surfaceId: msg.surfaceId })); break;",
  '      case "sidebandData": handleSidebandData(msg); break;',
  '      case "panelEvent":',
  "        var pe = panels[msg.id];",
  '        if (pe && msg.event === "dragend") {',
  '          if (msg.x !== undefined) pe.el.style.left = msg.x + "px";',
  '          if (msg.y !== undefined) pe.el.style.top = msg.y + "px";',
  "        }",
  '        if (pe && msg.event === "resize") {',
  '          if (msg.width !== undefined) pe.el.style.width = msg.width + "px";',
  '          if (msg.height !== undefined) pe.el.style.height = msg.height + "px";',
  "        }",
  '        if (pe && msg.event === "close") { pe.el.remove(); delete panels[msg.id]; }',
  "        break;",
  "    }",
  "  };",
  "  ws.onclose = function() {",
  '    setStatus(""); clearPanels(); clearAllPanes();',
  "    setTimeout(function() { reconnectDelay = Math.min(reconnectDelay * 2, 30000); connect(); }, reconnectDelay);",
  "  };",
  "  ws.onerror = function() {};",
  "}",
  "",
  "// Re-apply layout on window resize and notify scripts of new pixel dimensions",
  "var resizeTimer = null;",
  "window.addEventListener('resize', function() {",
  "  if (resizeTimer) clearTimeout(resizeTimer);",
  "  resizeTimer = setTimeout(function() {",
  "    if (!fullscreenSurfaceId) applyLayout();",
  "    for (var sid in panes) {",
  "      var rp = panes[sid];",
  "      var rect = rp.el.getBoundingClientRect();",
  "      var pxW = Math.round(rect.width); var pxH = Math.round(rect.height);",
  "      if (pxW > 0 && pxH > 0 && rp.term) {",
  "        sendMsg({ type: 'panelMouseEvent', surfaceId: sid, id: '__terminal__', event: 'resize',",
  "          cols: rp.term.cols, rows: rp.term.rows, pxWidth: pxW, pxHeight: pxH });",
  "      }",
  "    }",
  "  }, 100);",
  "});",
  "",
  "// Escape key exits fullscreen pane view",
  "document.addEventListener('keydown', function(e) {",
  "  if (e.key === 'Escape' && fullscreenSurfaceId) exitFullscreen();",
  "});",
  "",
  "connect();",
  "});",
].join("\n");
