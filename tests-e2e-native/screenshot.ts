import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { AppInfo } from "./fixtures";
import type { SocketRpc } from "./client";

export interface ScreenshotOpts {
  /** Crop strategy.
   *  - `window` (default on Tier-2 runs): `screencapture -l <CGWindowID>` —
   *    just the app window, no wallpaper, no chrome pollution.
   *  - `full-screen`: `screencapture -D 1` — fallback when no window id is
   *    resolvable. Noisier but always produces something. */
  crop?: "window" | "full-screen";
}

const INDEX_FILE_RELATIVE = "screenshots-index.jsonl";

export interface CaptureArgs {
  info: AppInfo;
  name: string;
  dir: string;
  /** Socket RPC client — if provided and Tier 2 is ready, we resolve the
   *  window id via `__test.getWindowId` for a clean windowed capture. */
  rpc?: SocketRpc;
  opts?: ScreenshotOpts;
}

/**
 * Capture the app window using macOS's built-in `screencapture`. Returns
 * the PNG path.
 *
 * Strategy:
 *   1. If Tier 2 is ready, ask the webview for its `CGWindowID` (cached on
 *      `AppInfo.windowId` after first call).
 *   2. If we have a window id, `screencapture -l <id>` — tight crop.
 *   3. Otherwise, `screencapture -D 1` full-screen fallback.
 *   4. Non-macOS platforms get a text placeholder so index entries stay
 *      consistent and tests never fail from a missing screenshot.
 *
 * Falls back automatically if `-l` fails (e.g. window just minimized).
 */
export async function captureWindow(args: CaptureArgs): Promise<string> {
  if (process.platform !== "darwin") {
    return writePlaceholder(args);
  }
  const outDir = ensureDir(args.dir);
  const safeName = args.name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 64);
  const outPath = join(outDir, `${safeName}.png`);

  const crop = args.opts?.crop ?? "window";

  // Resolve windowId lazily. Cache on AppInfo so repeated snaps in one
  // test don't pay the RPC roundtrip every time.
  let windowId: number | null = args.info.windowId ?? null;
  if (!windowId && crop === "window" && args.rpc && args.info.tier2Ready) {
    try {
      windowId = await args.rpc.ui.getWindowId();
      if (windowId) args.info.windowId = windowId;
    } catch {
      /* fall through to full-screen */
    }
  }

  try {
    if (crop === "window" && windowId) {
      // `-x` silences the shutter; `-o` excludes the drop shadow so the
      // PNG bbox matches the window bbox (better for side-by-side diffs).
      execFileSync(
        "screencapture",
        ["-x", "-o", "-l", String(windowId), outPath],
        { stdio: "ignore" },
      );
    } else {
      execFileSync("screencapture", ["-x", "-D", "1", outPath], {
        stdio: "ignore",
      });
    }
  } catch {
    // `screencapture -l` can fail on a window that's just been minimised
    // or moved off-screen — retry with full-screen as a last resort so
    // we still get *something* for postmortem.
    try {
      execFileSync("screencapture", ["-x", "-D", "1", outPath], {
        stdio: "ignore",
      });
    } catch {
      return writePlaceholder(args);
    }
  }
  return outPath;
}

function writePlaceholder(args: CaptureArgs): string {
  const outDir = ensureDir(args.dir);
  const safeName = args.name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 64);
  const outPath = join(outDir, `${safeName}.placeholder.txt`);
  try {
    appendFileSync(outPath, `placeholder screenshot: ${args.name}\n`);
  } catch {
    /* ignore */
  }
  return outPath;
}

function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export interface IndexEntry {
  spec: string;
  test: string;
  testSlug: string;
  step: string;
  path: string;
  state?: Record<string, unknown>;
  annotate?: Record<string, unknown>;
  /** Visible terminal buffer (ANSI-stripped) for the focused surface at
   *  the time of the snap. The report renders it below the PNG. */
  terminal?: string;
}

export function writeIndexEntry(entry: IndexEntry): void {
  // Persistent stage dir sits outside `test-results/` so Playwright
  // doesn't wipe it between suite runs (e.g. web → native).
  const stageDir = join(process.cwd(), ".design-artifacts");
  const stageShots = join(stageDir, "shots/native");
  if (!existsSync(stageShots)) mkdirSync(stageShots, { recursive: true });

  // Copy the PNG out of testInfo.outputDir into the stage so the report
  // builder can still find it after Playwright's next startup cleanup.
  let persistedPath = entry.path;
  if (entry.path && existsSync(entry.path) && entry.path.endsWith(".png")) {
    const safe = `${entry.spec.replace(/\W+/g, "_")}-${entry.testSlug}-${entry.step}.png`;
    const dest = join(stageShots, safe);
    try {
      copyFileSync(entry.path, dest);
      persistedPath = dest;
    } catch {
      /* fall through — keep the original path */
    }
  }

  const indexPath = join(stageDir, INDEX_FILE_RELATIVE);
  if (!existsSync(stageDir)) mkdirSync(stageDir, { recursive: true });
  const line =
    JSON.stringify({
      timestamp: new Date().toISOString(),
      suite: "native",
      ...entry,
      path: persistedPath,
    }) + "\n";
  try {
    appendFileSync(indexPath, line);
  } catch {
    /* best-effort */
  }
}

void basename;
