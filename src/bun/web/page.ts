import {
  XTERM_JS,
  XTERM_CSS,
  FIT_ADDON_JS,
  WEB_LINKS_ADDON_JS,
  readAsset,
} from "./asset-loader";

// Cache the assembled page so we only concatenate once per process.
// The server's start() clears this so dev restarts pick up client rebuilds.
let cachedPage: string | null = null;

export function invalidatePageCache(): void {
  cachedPage = null;
}

export function buildHtmlPage(): string {
  if (cachedPage) return cachedPage;

  const clientJs = readAsset("assets/web-client/client.js");
  const clientCss = readAsset("assets/web-client/client.css");
  const tokensCss = readAsset("assets/web-client/tokens.css");

  // Assemble via array join — xterm.js UMD contains backticks, ${} and
  // </script> strings, so template literal interpolation is unsafe here.
  const p: string[] = [];
  p.push('<!DOCTYPE html><html lang="en"><head>');
  p.push('<meta charset="UTF-8">');
  p.push(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
  );
  p.push("<title>HyperTerm Remote</title>");
  p.push("<style>");
  p.push(XTERM_CSS);
  p.push("</style>");
  // Graphite design tokens — must come before client.css so it can
  // reference the custom properties.
  p.push("<style>");
  p.push(tokensCss);
  p.push("</style>");
  p.push("<style>");
  p.push(clientCss);
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

  // Client bundle (bun-built, IIFE)
  p.push("<script>");
  p.push(clientJs);
  p.push("</" + "script>");
  p.push("</body></html>");
  cachedPage = p.join("\n");
  return cachedPage;
}

const APP_HTML = `\
<div id="toolbar">
  <button class="toolbar-btn" id="sidebar-toggle-btn" title="Toggle Sidebar">&#x2261;</button>
  <button class="toolbar-btn" id="back-btn" title="Back to split view">&#x2190;</button>
  <select id="workspace-select"></select>
  <span id="toolbar-title">HyperTerm Remote</span>
  <span class="toolbar-spacer"></span>
  <span id="client-count"></span>
  <button class="toolbar-btn" id="fullscreen-btn" title="Fullscreen">&#x26F6;</button>
  <div id="status-dot"></div>
</div>
<div id="sidebar" class="collapsed"></div>
<div id="pane-container"></div>`;
