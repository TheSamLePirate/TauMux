import type { Page, TestInfo } from "@playwright/test";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
// Stage artifacts outside `test-results/` so a second Playwright run
// (e.g. `test:native` after `test:e2e`) doesn't wipe them. Playwright
// cleans `test-results/` at startup by default.
const STAGE_DIR = join(REPO_ROOT, ".design-artifacts");
const INDEX_PATH = join(STAGE_DIR, "screenshots-index.jsonl");
const SHOTS_DIR = join(STAGE_DIR, "shots/web");

export interface SnapOptions {
  /** CSS selectors whose bounding rect + computed style are recorded next
   *  to the PNG. The HTML report renders these as a table so reviewers
   *  can inspect colors / fonts / spacing without re-opening the code. */
  annotate?: string[];
  /** Arbitrary JSON blob describing the UI state at capture time. */
  state?: Record<string, unknown>;
  /** Clip to a specific selector's bounding box rather than full viewport. */
  clip?: string;
  /** Wait for this selector before capturing. */
  waitFor?: string;
  /** Extra pause (ms) after `waitFor` / before capture. Use sparingly; most
   *  shots don't need one. */
  settleMs?: number;
}

const STYLE_KEYS = [
  "color",
  "backgroundColor",
  "backgroundImage",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "padding",
  "margin",
  "border",
  "borderRadius",
  "boxShadow",
  "opacity",
  "zIndex",
  "display",
  "flexDirection",
  "gap",
  "textAlign",
] as const;

export interface SnapAnnotation {
  selector: string;
  found: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  style?: Record<string, string>;
  textSample?: string;
}

export async function snap(
  page: Page,
  testInfo: TestInfo,
  name: string,
  opts: SnapOptions = {},
): Promise<void> {
  if (opts.waitFor) await page.locator(opts.waitFor).first().waitFor();
  if (opts.settleMs) await page.waitForTimeout(opts.settleMs);

  mkdirSync(SHOTS_DIR, { recursive: true });
  const safe = name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
  const outPath = join(SHOTS_DIR, `${safe}.png`);

  const screenshotOpts: Parameters<Page["screenshot"]>[0] = {
    path: outPath,
    animations: "disabled",
    caret: "hide",
  };
  if (opts.clip) {
    const box = await page.locator(opts.clip).first().boundingBox();
    if (box) screenshotOpts.clip = box;
  } else {
    screenshotOpts.fullPage = false;
  }
  await page.screenshot(screenshotOpts);

  // Capture terminal text. xterm renders each visible row as a `<div>`
  // inside `.xterm-rows`; concatenating their textContent gives a
  // reasonable facsimile of what the user sees. Capped so demos that
  // produce many status lines don't bloat the JSONL.
  const terminal = await page.evaluate(() => {
    const rows = document.querySelectorAll(".xterm-rows > div");
    const text = Array.from(rows)
      .map((r) => (r.textContent ?? "").replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
    return text.length > 4000 ? text.slice(-4000) : text;
  });

  let annotations: SnapAnnotation[] = [];
  if (opts.annotate && opts.annotate.length > 0) {
    annotations = await page.evaluate(
      ({ selectors, keys }) => {
        const pick = (el: Element) => {
          const rect = el.getBoundingClientRect();
          const cs = window.getComputedStyle(el);
          const style: Record<string, string> = {};
          for (const k of keys) {
            style[k] = cs.getPropertyValue(
              k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
            );
          }
          const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          return {
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            style,
            textSample: txt.slice(0, 120),
          };
        };
        return selectors.map((sel) => {
          const el = document.querySelector(sel);
          if (!el) return { selector: sel, found: false };
          return { selector: sel, found: true, ...pick(el) };
        });
      },
      { selectors: opts.annotate, keys: STYLE_KEYS as unknown as string[] },
    );
  }

  try {
    await testInfo.attach(`design-${name}`, {
      path: outPath,
      contentType: "image/png",
    });
  } catch {
    /* best-effort */
  }

  mkdirSync(dirname(INDEX_PATH), { recursive: true });
  const entry = {
    timestamp: new Date().toISOString(),
    suite: "web",
    spec: (testInfo.file.split("/").pop() ?? "unknown").replace(
      /\.spec\.ts$/,
      "",
    ),
    test: testInfo.title,
    testSlug: testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
    step: name,
    path: outPath,
    state: opts.state ?? {},
    annotate: annotations,
    terminal,
    file: testInfo.file,
    line: testInfo.line,
  };
  try {
    appendFileSync(INDEX_PATH, JSON.stringify(entry) + "\n");
  } catch {
    /* best-effort */
  }
}

export function ensureSuiteMeta(_suite: "web"): void {
  if (!existsSync(dirname(INDEX_PATH))) {
    mkdirSync(dirname(INDEX_PATH), { recursive: true });
  }
}
