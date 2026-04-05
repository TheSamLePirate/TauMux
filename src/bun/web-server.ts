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
  subscribedSurfaceId: string | null;
}

type WS = { data: ClientData; send(data: string): void; close(): void };

export class WebServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private clients = new Set<WS>();
  private clientCounter = 0;

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
  ) {}

  start(): void {
    if (this.server) return;
    // Clear cached page so restarts pick up code changes
    cachedPage = null;

    this.server = Bun.serve({
      port: this.port,
      hostname: "0.0.0.0",

      fetch: (req, server) => {
        const url = new URL(req.url);

        // WebSocket upgrade
        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const data: ClientData = {
            clientId: `web:${++this.clientCounter}`,
            subscribedSurfaceId: this.getFocusedSurfaceId(),
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

          // Send welcome
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
            }),
          );

          // Send output history for the subscribed surface
          if (ws.data.subscribedSurfaceId) {
            const history = this.sessions.getOutputHistory(
              ws.data.subscribedSurfaceId,
            );
            if (history) {
              ws.send(
                JSON.stringify({
                  type: "history",
                  surfaceId: ws.data.subscribedSurfaceId,
                  data: history,
                }),
              );
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
            case "subscribeSurface": {
              const surfaceId = msg["surfaceId"] as string;
              if (!surfaceId) break;
              ws.data.subscribedSurfaceId = surfaceId;
              // Send history for the new surface
              const history = this.sessions.getOutputHistory(surfaceId);
              if (history) {
                ws.send(
                  JSON.stringify({ type: "history", surfaceId, data: history }),
                );
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
                };
                // Send to script via fd5
                this.sessions.sendEvent(surfaceId, panelEvt);
                // Broadcast drag/resize/close to all web clients + host
                const evt = panelEvt.event;
                if (evt === "dragend" || evt === "resize" || evt === "close") {
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
      if (ws.data.subscribedSurfaceId === surfaceId) {
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
#surface-select {
  padding: 4px 8px; border-radius: 4px; background: var(--overlay); color: var(--text);
  border: 1px solid rgba(255,255,255,0.08); font-size: 12px; cursor: pointer; outline: none;
}
#surface-select:focus { border-color: var(--blue); }
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
#terminal-wrapper { position: absolute; top: 36px; left: 0; right: 0; bottom: 0; overflow: hidden; }
#terminal { width: 100%; height: 100%; overflow: hidden; }
#terminal-wrapper .xterm { height: 100%; }
.xterm-viewport { background-color: var(--bg) !important; }
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
@media (max-width: 768px) {
  #toolbar { height: 32px; padding: 0 8px; gap: 6px; }
  #toolbar-title { display: none; }
  #terminal-wrapper { top: 32px; }
  body { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
}`;

const APP_HTML = `\
<div id="toolbar">
  <select id="surface-select"></select>
  <span id="toolbar-title">HyperTerm Remote</span>
  <span class="toolbar-spacer"></span>
  <span id="client-count"></span>
  <button class="toolbar-btn" id="fullscreen-btn" title="Fullscreen">&#x26F6;</button>
  <div id="status-dot"></div>
</div>
<div id="terminal-wrapper"><div id="terminal"></div></div>`;

// Client-side JS — uses only regular strings (no backticks) to be safe
// inside the concatenated HTML output.
const APP_JS = [
  "// Load JetBrains Mono Nerd Font from our server (same-origin, works in Safari)",
  "var fr = new FontFace('JetBrainsMono Nerd Font Mono', 'url(/fonts/nerd-regular.ttf)', { style: 'normal', weight: '400' });",
  "var fb = new FontFace('JetBrainsMono Nerd Font Mono', 'url(/fonts/nerd-bold.ttf)', { style: 'normal', weight: '700' });",
  "document.fonts.add(fr); document.fonts.add(fb);",
  "Promise.all([fr.load(), fb.load()]).then(function() { return document.fonts.ready; }).then(function() {",
  "var term = new Terminal({",
  "  theme: {",
  '    background: "#1e1e2e", foreground: "#cdd6f4",',
  '    cursor: "#f5e0dc", cursorAccent: "#1e1e2e",',
  '    selectionBackground: "#585b70", selectionForeground: "#cdd6f4",',
  '    black: "#45475a", red: "#f38ba8", green: "#a6e3a1",',
  '    yellow: "#f9e2af", blue: "#89b4fa", magenta: "#f5c2e7",',
  '    cyan: "#94e2d5", white: "#bac2de",',
  '    brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1",',
  '    brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#f5c2e7",',
  '    brightCyan: "#94e2d5", brightWhite: "#a6adc8"',
  "  },",
  "  fontFamily: \"'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Fira Code', monospace\",",
  "  fontSize: 14, lineHeight: 1.2,",
  '  cursorBlink: true, cursorStyle: "bar",',
  "  scrollback: 10000",
  "});",
  "",
  "term.loadAddon(new WebLinksAddon.WebLinksAddon());",
  'term.open(document.getElementById("terminal"));',
  "// Terminal dimensions are set by the host, not auto-fitted to browser viewport",
  "",
  'var selectEl = document.getElementById("surface-select");',
  'var dotEl = document.getElementById("status-dot");',
  'var fsBtn = document.getElementById("fullscreen-btn");',
  "var subscribedSurface = null;",
  "",
  'selectEl.addEventListener("change", function() {',
  "  var sid = selectEl.value;",
  "  if (sid && sid !== subscribedSurface) {",
  "    subscribedSurface = sid; term.clear();",
  '    sendMsg({ type: "subscribeSurface", surfaceId: sid });',
  "  }",
  "});",
  "",
  'fsBtn.addEventListener("click", function() {',
  "  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function(){});",
  "  else document.exitFullscreen().catch(function(){});",
  "});",
  "",
  "var panels = {};",
  'var panelContainer = document.getElementById("terminal-wrapper");',
  "",
  "function handleSidebandMeta(msg) {",
  "  var id = msg.id; if (!id) return;",
  "  if (msg.surfaceId !== subscribedSurface) return;",
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
  '  var el = document.createElement("div"); el.className = "web-panel";',
  '  if (msg.x !== undefined) el.style.left = msg.x + "px";',
  '  if (msg.y !== undefined) el.style.top = msg.y + "px";',
  '  if (msg.width !== undefined && msg.width !== "auto") el.style.width = msg.width + "px";',
  '  if (msg.height !== undefined && msg.height !== "auto") el.style.height = msg.height + "px";',
  "  if (msg.opacity !== undefined) el.style.opacity = msg.opacity;",
  "  if (msg.zIndex !== undefined) el.style.zIndex = msg.zIndex;",
  "  var draggable = msg.draggable !== undefined ? msg.draggable : (msg.position === 'float');",
  "  var resizable = msg.resizable !== undefined ? msg.resizable : (msg.position === 'float');",
  "  // Drag handle",
  "  if (draggable) {",
  '    el.classList.add("draggable");',
  '    var dragH = document.createElement("div"); dragH.className = "web-panel-drag";',
  "    dragH.textContent = id;",
  "    el.insertBefore(dragH, el.firstChild);",
  "    setupPanelDrag(el, dragH, id, msg.surfaceId);",
  "  }",
  '  var contentEl = document.createElement("div"); contentEl.className = "web-panel-content";',
  "  el.appendChild(contentEl);",
  "  // Resize handle",
  "  if (resizable) {",
  '    el.classList.add("resizable");',
  '    var resizeH = document.createElement("div"); resizeH.className = "web-panel-resize";',
  "    el.appendChild(resizeH);",
  "    setupPanelResize(el, resizeH, id, msg.surfaceId);",
  "  }",
  "  panelContainer.appendChild(el);",
  "  if (msg.interactive) { el.classList.add('interactive'); setupPanelMouse(contentEl, id, msg.surfaceId); }",
  "  panels[id] = { el: el, contentEl: contentEl, meta: msg };",
  "}",
  "",
  "// Touch helper: extract clientX/clientY from touch or mouse event",
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
  "  // Mouse events",
  "  el.addEventListener('mousedown', function(e) { e.preventDefault(); sendXY('mousedown', e.clientX, e.clientY, e.button, e.buttons); });",
  "  el.addEventListener('mouseup', function(e) { sendXY('mouseup', e.clientX, e.clientY, e.button, 0); });",
  "  el.addEventListener('click', function(e) { sendXY('click', e.clientX, e.clientY, e.button, 0); });",
  "  el.addEventListener('mousemove', function(e) {",
  "    var now = Date.now(); if (now - lastMoveTime < 16) return; lastMoveTime = now;",
  "    sendXY('mousemove', e.clientX, e.clientY, 0, e.buttons);",
  "  });",
  "  el.addEventListener('mouseenter', function(e) { sendXY('mouseenter', e.clientX, e.clientY, 0, e.buttons); });",
  "  el.addEventListener('mouseleave', function(e) { sendXY('mouseleave', e.clientX, e.clientY, 0, 0); });",
  "  // Touch → mouse mapping. Capture move/end on document so we don't lose events",
  "  // when the finger slides off the element.",
  "  var touching = false;",
  "  el.addEventListener('touchstart', function(e) {",
  "    e.preventDefault(); touching = true; var t = e.touches[0];",
  "    if (t) sendXY('mousedown', t.clientX, t.clientY, 0, 1);",
  "    function onTouchMove(me) {",
  "      me.preventDefault(); var mt = me.touches[0];",
  "      if (mt) sendXY('mousemove', mt.clientX, mt.clientY, 0, 1);",
  "    }",
  "    function onTouchEnd(me) {",
  "      document.removeEventListener('touchmove', onTouchMove);",
  "      document.removeEventListener('touchend', onTouchEnd);",
  "      document.removeEventListener('touchcancel', onTouchEnd);",
  "      touching = false;",
  "      var ct = me.changedTouches[0];",
  "      if (ct) sendXY('mouseup', ct.clientX, ct.clientY, 0, 0);",
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
  "    function onMove(me) {",
  "      var mp = txy(me);",
  "      el.style.left = (startLeft + mp.clientX - startX) + 'px';",
  "      el.style.top = (startTop + mp.clientY - startY) + 'px';",
  "    }",
  "    function onUp() {",
  "      document.removeEventListener('mousemove', onMove);",
  "      document.removeEventListener('mouseup', onUp);",
  "      document.removeEventListener('touchmove', onMove);",
  "      document.removeEventListener('touchend', onUp);",
  "      var nx = parseInt(el.style.left) || 0;",
  "      var ny = parseInt(el.style.top) || 0;",
  "      sendMsg({ type: 'panelMouseEvent', surfaceId: surfaceId, id: panelId, event: 'dragend', x: nx, y: ny });",
  "    }",
  "    document.addEventListener('mousemove', onMove);",
  "    document.addEventListener('mouseup', onUp);",
  "    document.addEventListener('touchmove', onMove, { passive: false });",
  "    document.addEventListener('touchend', onUp);",
  "  }",
  "  handle.addEventListener('mousedown', startDrag);",
  "  handle.addEventListener('touchstart', startDrag, { passive: false });",
  "}",
  "",
  "function setupPanelResize(el, handle, panelId, surfaceId) {",
  "  function startResize(e) {",
  "    e.preventDefault(); e.stopPropagation();",
  "    var p = txy(e);",
  "    var startX = p.clientX, startY = p.clientY;",
  "    var startW = el.offsetWidth, startH = el.offsetHeight;",
  "    function onMove(me) {",
  "      if (me.preventDefault) me.preventDefault();",
  "      var mp = txy(me);",
  "      el.style.width = Math.max(120, startW + mp.clientX - startX) + 'px';",
  "      el.style.height = Math.max(72, startH + mp.clientY - startY) + 'px';",
  "    }",
  "    function onUp() {",
  "      document.removeEventListener('mousemove', onMove);",
  "      document.removeEventListener('mouseup', onUp);",
  "      document.removeEventListener('touchmove', onMove);",
  "      document.removeEventListener('touchend', onUp);",
  "      var nw = el.offsetWidth; var nh = el.offsetHeight;",
  "      sendMsg({ type: 'panelMouseEvent', surfaceId: surfaceId, id: panelId, event: 'resize', width: nw, height: nh });",
  "    }",
  "    document.addEventListener('mousemove', onMove);",
  "    document.addEventListener('mouseup', onUp);",
  "    document.addEventListener('touchmove', onMove, { passive: false });",
  "    document.addEventListener('touchend', onUp);",
  "  }",
  "  handle.addEventListener('mousedown', startResize);",
  "  handle.addEventListener('touchstart', startResize, { passive: false });",
  "}",
  "",
  "function handleSidebandData(msg) {",
  "  if (msg.surfaceId !== subscribedSurface) return;",
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
  "",
  "var ws = null; var reconnectDelay = 1000;",
  "function setStatus(s) { dotEl.className = s; }",
  "function sendMsg(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }",
  "",
  "function updateSurfaceList(surfaces) {",
  '  selectEl.innerHTML = "";',
  "  surfaces.forEach(function(s) {",
  '    var opt = document.createElement("option"); opt.value = s.id;',
  '    opt.textContent = s.title + " (" + s.id + ")";',
  "    if (s.id === subscribedSurface) opt.selected = true;",
  "    selectEl.appendChild(opt);",
  "  });",
  "}",
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
  "        subscribedSurface = msg.focusedSurfaceId || (msg.surfaces[0] && msg.surfaces[0].id) || null;",
  "        updateSurfaceList(msg.surfaces);",
  "        var activeSurf = msg.surfaces.find(function(s) { return s.id === subscribedSurface; });",
  "        if (activeSurf && activeSurf.cols && activeSurf.rows) term.resize(activeSurf.cols, activeSurf.rows);",
  "        break;",
  '      case "history": term.reset(); term.write(msg.data); break;',
  '      case "stdout": if (msg.surfaceId === subscribedSurface) term.write(msg.data); break;',
  '      case "resize":',
  "        if (msg.surfaceId === subscribedSurface && msg.cols && msg.rows) term.resize(msg.cols, msg.rows);",
  "        break;",
  '      case "surfaceCreated":',
  '        var opt = document.createElement("option"); opt.value = msg.surfaceId;',
  '        opt.textContent = msg.title + " (" + msg.surfaceId + ")";',
  "        selectEl.appendChild(opt); break;",
  '      case "surfaceClosed":',
  "        for (var i = 0; i < selectEl.options.length; i++) {",
  "          if (selectEl.options[i].value === msg.surfaceId) { selectEl.remove(i); break; }",
  "        }",
  "        if (msg.surfaceId === subscribedSurface) {",
  "          clearPanels();",
  "          if (selectEl.options.length > 0) {",
  "            subscribedSurface = selectEl.options[0].value; selectEl.value = subscribedSurface;",
  '            sendMsg({ type: "subscribeSurface", surfaceId: subscribedSurface });',
  "          }",
  "        } break;",
  '      case "focusChanged": break;',
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
  '    setStatus(""); clearPanels();',
  "    setTimeout(function() { reconnectDelay = Math.min(reconnectDelay * 2, 30000); connect(); }, reconnectDelay);",
  "  };",
  "  ws.onerror = function() {};",
  "}",
  "",
  'term.onData(function(data) { sendMsg({ type: "stdin", surfaceId: subscribedSurface, data: data }); });',
  "// onBinary handles mouse escape sequences that use raw bytes (X10/normal mouse protocol)",
  'term.onBinary(function(data) { sendMsg({ type: "stdin", surfaceId: subscribedSurface, data: data }); });',
  'document.getElementById("terminal").addEventListener("click", function() { term.focus(); });',
  "connect();",
  "});",
].join("\n");
