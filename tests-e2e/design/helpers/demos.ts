/**
 * Shared catalog of sideband demo scripts under `scripts/demo_*`. Both
 * the web (`tests-e2e/design/demos.spec.ts`) and native
 * (`tests-e2e-native/specs/demos.spec.ts`) suites iterate this list so
 * the design report groups the same demo side-by-side across platforms.
 *
 * The launched shell runs in `$HOME` (web fixture now uses `/bin/zsh
 * -l -f` since `/bin/sh -l` closes extra fds on macOS and killed the
 * sideband channel; native fixture allocates a throwaway `HOME`). We
 * always call demos via an absolute path resolved at test time — `bun
 * scripts/demo_X.ts` would fail because the shell's cwd isn't the repo
 * root.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the repo root. */
export const REPO_ROOT = resolve(__dirname, "../../..");
/** Absolute path to `scripts/` in the repo. */
export const SCRIPTS_DIR = resolve(REPO_ROOT, "scripts");

export type Runner = "bun" | "python3";

export interface DemoEntry {
  /** File name under `scripts/`, e.g. `demo_3d.ts`. */
  file: string;
  /** Short kebab slug used as the screenshot step name. */
  slug: string;
  /** Human-readable label for the report. */
  label: string;
  /** Interpreter to run the demo with. */
  runner: Runner;
  /** ms to wait after the command before screenshotting. */
  settleMs: number;
  /** Extra shell args appended after the script path. Paths must be
   *  repo-relative (the command `cd`s to the repo root first) and will
   *  be single-quoted by `commandFor` so spaces survive. */
  args?: string[];
  /** Skip entirely (needs input, hardware, long tutorial, etc.). */
  skip?: boolean;
  /** Opt out of the `.web-panel` / `rpc.panel.list` assertion. Set to
   *  true for demos that print to stdout only (none today — future-
   *  proofing). The assertion catches sideband regressions that would
   *  otherwise silently produce "UI only, no panel" screenshots. */
  expectNoPanel?: boolean;
  /** Notes shown in the report's state JSON. */
  notes?: string;
}

/** Quote a shell argument — single-quotes with single-quote escape. Good
 *  enough for the paths + URLs we pass here. */
function shellQuote(a: string): string {
  return `'${a.replace(/'/g, `'\\''`)}'`;
}

/** Build the shell command for a demo. Always `cd`s to the repo root
 *  first so demos see the same cwd the user has day-to-day (relative
 *  paths, git context, .env files, etc.). Extra args from `demo.args`
 *  are single-quoted so spaces in repo paths survive. */
export function commandFor(demo: DemoEntry): string {
  const argStr = (demo.args ?? []).map(shellQuote).join(" ");
  const tail = argStr ? ` ${argStr}` : "";
  return `cd ${shellQuote(REPO_ROOT)} && ${demo.runner} ${shellQuote(join(SCRIPTS_DIR, demo.file))}${tail}`;
}

export const DEMOS: DemoEntry[] = [
  // ── Canvas / graphics ─────────────────────────────────────────────
  {
    file: "demo_3d.ts",
    slug: "3d",
    label: "3D solid renderer",
    runner: "bun",
    settleMs: 2500,
    notes: "Renders a torus/sphere/icosahedron via sideband SVG.",
  },
  {
    file: "demo_canvas_life.ts",
    slug: "canvas-life",
    label: "Conway's life (canvas2d)",
    runner: "bun",
    settleMs: 2500,
  },
  {
    file: "demo_canvas_particles.ts",
    slug: "canvas-particles",
    label: "Canvas particles",
    runner: "bun",
    settleMs: 2500,
  },
  {
    file: "demo_canvas_heatmap.py",
    slug: "canvas-heatmap",
    label: "Canvas heatmap (Python)",
    runner: "python3",
    settleMs: 2500,
  },
  {
    file: "demo_canvas_mandelbrot.py",
    slug: "canvas-mandelbrot",
    label: "Canvas mandelbrot (Python)",
    runner: "python3",
    settleMs: 3000,
  },
  {
    file: "demo_clock.ts",
    slug: "clock",
    label: "Fixed clock widget",
    runner: "bun",
    settleMs: 2000,
  },
  {
    file: "demo_draw.ts",
    slug: "draw",
    label: "Drawing surface",
    runner: "bun",
    settleMs: 2000,
  },

  // ── Data / diagnostics ────────────────────────────────────────────
  {
    file: "demo_chart.py",
    slug: "chart",
    label: "Chart (Python)",
    runner: "python3",
    settleMs: 2500,
  },
  {
    file: "demo_dashboard.py",
    slug: "dashboard",
    label: "Dashboard (Python)",
    runner: "python3",
    settleMs: 2500,
  },
  {
    file: "demo_sysmon.ts",
    slug: "sysmon",
    label: "System monitor",
    runner: "bun",
    settleMs: 2500,
  },
  {
    file: "demo_procs.ts",
    slug: "procs",
    label: "Process table",
    runner: "bun",
    settleMs: 2500,
  },

  // ── Content viewers ───────────────────────────────────────────────
  {
    file: "demo_files.ts",
    slug: "files",
    label: "File explorer",
    runner: "bun",
    settleMs: 2500,
    args: ["./src"],
    notes: "Browsing the repo's src/ tree.",
  },
  {
    file: "demo_gallery.ts",
    slug: "gallery",
    label: "Image gallery",
    runner: "bun",
    settleMs: 2500,
    args: ["./scripts"],
    notes: "scripts/ holds one real image (gravite terre.jpg).",
  },
  {
    file: "demo_image.py",
    slug: "image",
    label: "Image display (Python)",
    runner: "python3",
    settleMs: 2000,
    args: ["./scripts/gravite terre.jpg"],
  },
  {
    file: "demo_json.ts",
    slug: "json",
    label: "JSON viewer",
    runner: "bun",
    settleMs: 2000,
    args: ["./package.json"],
    notes: "Loaded via Bun.resolveSync — path must be relative.",
  },
  {
    file: "demo_mdpreview.ts",
    slug: "mdpreview",
    label: "Markdown preview",
    runner: "bun",
    settleMs: 2000,
    args: ["./README.md"],
  },
  {
    file: "demo_qrcode.ts",
    slug: "qrcode",
    label: "QR code",
    runner: "bun",
    settleMs: 2000,
    args: ["https://github.com/olivvein/crazyShell"],
  },

  // ── Git ───────────────────────────────────────────────────────────
  {
    file: "demo_gitdiff.ts",
    slug: "gitdiff",
    label: "Git diff",
    runner: "bun",
    settleMs: 2500,
  },
  {
    file: "demo_gitgraph.ts",
    slug: "gitgraph",
    label: "Git graph",
    runner: "bun",
    settleMs: 2500,
  },

  // ── Interactive / input-driven ────────────────────────────────────
  {
    file: "demo_colorpick.ts",
    slug: "colorpick",
    label: "Color picker",
    runner: "bun",
    settleMs: 2000,
  },
  {
    file: "demo_interactive.py",
    slug: "interactive-py",
    label: "Interactive (Python)",
    runner: "python3",
    settleMs: 2000,
    notes: "Interactive — captures the initial state only.",
  },
  {
    file: "demo_interactive_showcase.ts",
    slug: "interactive-showcase",
    label: "Interactive showcase",
    runner: "bun",
    settleMs: 2500,
    notes: "Interactive — captures the initial state only.",
  },

  // ── Skipped by default ────────────────────────────────────────────
  {
    file: "demo_webcam.ts",
    slug: "webcam",
    label: "Webcam (hardware)",
    runner: "bun",
    settleMs: 2000,
    skip: true,
    notes: "Skipped — requires macOS camera permission.",
  },
  {
    file: "demo_massive_tutorial.ts",
    slug: "massive-tutorial",
    label: "Massive tutorial",
    runner: "bun",
    settleMs: 2500,
    skip: true,
    notes:
      "Skipped — multi-step tutorial, too long to settle in a single snap.",
  },
];

export const ACTIVE_DEMOS = DEMOS.filter((d) => !d.skip);
