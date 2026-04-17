import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppInfo } from "./fixtures";

export interface ScreenshotOpts {
  /** Crop strategy. `window` uses screencapture -l; `full-screen` falls back
   *  to -D 1. Tier-1 defaults to full-screen because `__test.getWindowId`
   *  lives in Tier 2 — we still capture something useful until Tier 2 lands. */
  crop?: "window" | "full-screen";
}

const INDEX_FILE_RELATIVE = "screenshots-index.jsonl";

export interface CaptureArgs {
  info: AppInfo;
  name: string;
  dir: string;
  opts?: ScreenshotOpts;
}

/**
 * Capture the app window (or the full screen if we can't resolve a window id)
 * using macOS's built-in `screencapture`. Returns the PNG path.
 *
 * Until Tier 2 lands we don't have `__test.getWindowId`, so we degrade to
 * `-D 1` (full screen) which still gives reviewers and Claude Opus something
 * to look at without interactive prompts.
 */
export function captureWindow(args: CaptureArgs): string {
  if (process.platform !== "darwin") {
    // Outside macOS we can't drive screencapture. Write a placeholder so the
    // index entries stay consistent; tests don't fail on missing images.
    return writePlaceholder(args);
  }
  const outDir = ensureDir(args.dir);
  const safeName = args.name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 64);
  const outPath = join(outDir, `${safeName}.png`);

  const crop = args.opts?.crop ?? "full-screen";
  const windowId = args.info.windowId;
  try {
    if (crop === "window" && windowId) {
      execFileSync(
        "screencapture",
        ["-x", "-l", String(windowId), "-o", outPath],
        {
          stdio: "ignore",
        },
      );
    } else {
      // `-x` silences the camera-shutter sound; `-D 1` picks the primary display.
      execFileSync("screencapture", ["-x", "-D", "1", outPath], {
        stdio: "ignore",
      });
    }
  } catch {
    return writePlaceholder(args);
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
}

export function writeIndexEntry(entry: IndexEntry): void {
  const indexDir = join(process.cwd(), "test-results");
  if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
  const indexPath = join(indexDir, INDEX_FILE_RELATIVE);
  const line =
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    }) + "\n";
  try {
    appendFileSync(indexPath, line);
  } catch {
    /* best-effort */
  }
}
