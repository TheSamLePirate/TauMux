import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Read xterm.js assets at module load time. In dev mode they live under
// node_modules in the project root. In a packaged Electrobun app they are
// copied to the vendor/ directory next to the bun/ bundle via electrobun.config copy.

// Vendor directory inside the packaged .app (app/vendor/ sits next to app/bun/)
const VENDOR_DIR = resolve(import.meta.dir, "../../vendor");

// Map from dev-mode paths (relative to project root) to vendor filenames.
// Keeping this flat makes it explicit which assets we bundle into the .app.
export const VENDOR_MAP: Record<string, string> = {
  "node_modules/xterm/lib/xterm.js": "xterm.js",
  "node_modules/xterm/css/xterm.css": "xterm.css",
  "node_modules/@xterm/addon-fit/lib/addon-fit.js": "addon-fit.js",
  "node_modules/@xterm/addon-web-links/lib/addon-web-links.js":
    "addon-web-links.js",
  "assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf":
    "fonts/nerd-regular.ttf",
  "assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf": "fonts/nerd-bold.ttf",
  "assets/web-client/client.js": "web-client/client.js",
  "assets/web-client/client.css": "web-client/client.css",
  "assets/web-client/tokens.css": "web-client/tokens.css",
};

function findProjectRoot(): string {
  const startDir = import.meta.dir;
  const candidates = [
    resolve(startDir, "../.."),
    process.cwd(),
    resolve(startDir, "../../.."),
    resolve(startDir, "../../../.."),
  ];
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    candidates.push(dir);
  }
  for (const d of candidates) {
    try {
      readFileSync(resolve(d, "node_modules/xterm/lib/xterm.js"), "utf-8");
      return d;
    } catch {
      // try next
    }
  }
  return candidates[0]!;
}

export const PROJECT_ROOT = findProjectRoot();

export function readBinaryAsset(relativePath: string): Uint8Array | null {
  try {
    const buf = readFileSync(resolve(PROJECT_ROOT, relativePath));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    /* try vendor */
  }
  const vendorName = VENDOR_MAP[relativePath];
  if (vendorName) {
    try {
      const buf = readFileSync(resolve(VENDOR_DIR, vendorName));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      /* fall through */
    }
  }
  return null;
}

export function readAsset(relativePath: string): string {
  try {
    return readFileSync(resolve(PROJECT_ROOT, relativePath), "utf-8");
  } catch {
    /* try vendor */
  }
  const vendorName = VENDOR_MAP[relativePath];
  if (vendorName) {
    try {
      return readFileSync(resolve(VENDOR_DIR, vendorName), "utf-8");
    } catch {
      /* fall through */
    }
  }
  return `/* asset not found: ${relativePath} */`;
}

// Vendor assets loaded once at module load. The xterm bundle is ~300 KB;
// loading it synchronously here keeps the first-fetch latency low.
export const XTERM_JS = readAsset("node_modules/xterm/lib/xterm.js");
export const XTERM_CSS = readAsset("node_modules/xterm/css/xterm.css");
export const FIT_ADDON_JS = readAsset(
  "node_modules/@xterm/addon-fit/lib/addon-fit.js",
);
export const WEB_LINKS_ADDON_JS = readAsset(
  "node_modules/@xterm/addon-web-links/lib/addon-web-links.js",
);
export const NERD_FONT_REGULAR = readBinaryAsset(
  "assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf",
);
export const NERD_FONT_BOLD = readBinaryAsset(
  "assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf",
);
