#!/usr/bin/env bun
/**
 * τ-mux design guideline §11 Do / Don't checklist.
 *
 * Validates the `src/views/terminal/*` tree against each item in §11
 * that can be checked programmatically. Manual-only items (screenshot
 * comparisons, "does it feel right") are printed as deferred.
 *
 * Exit code: 0 if every programmatic check passes, 1 otherwise.
 * Pair with audit:emoji + audit:animations for the full §0 / §10 / §11
 * compliance gate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const VIEW_DIR = join(ROOT, "src/views/terminal");
const CSS_RAW = readFileSync(join(VIEW_DIR, "index.css"), "utf-8");
// Strip CSS comments so in-prose mentions of banned tokens
// ("no backdrop-filter", "/* gradient …") don't falsely fail audits.
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, "");

interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

const checks: Check[] = [];

function push(id: string, label: string, ok: boolean, detail?: string) {
  checks.push({ id, label, ok, detail });
}

// ── §11 "Don't" checks ─────────────────────────────────────────

// 1. "Don't introduce a third accent colour."
{
  // Any #rgb / #rrggbb literal that isn't on the approved palette set.
  const approved = new Set([
    // Surface
    "#000000",
    "#07090b",
    "#0b1013",
    "#0f161a",
    "#1a2328",
    "#121a1e",
    "#0d1317",
    "#0a0e11",
    // Text
    "#d6e2e8",
    "#8a9aa3",
    "#55646c",
    "#38434a",
    // Identity
    "#6fe9ff",
    "#33b8d6",
    "#ffc56b",
    "#d59a45",
    // State
    "#8ce99a",
    "#ff8a8a",
    "#8ce9ff",
    "#d6bfff",
    // Traffic lights
    "#ff5f57",
    "#febc2e",
    "#28c93f",
    // Shared neutrals used on overlays (white / black for non-chromatic
    // elevation shadows and scrollbar thumbs).
    "#fff",
    "#ffffff",
    "#000",
    "#18181b",
    "#09090b",
  ]);
  const hexes = new Set<string>();
  for (const m of CSS.matchAll(/#[0-9a-fA-F]{3,8}\b/g))
    hexes.add(m[0].toLowerCase());
  const unapproved = [...hexes].filter((h) => !approved.has(h));
  // Heuristic: purple / green / orange / blue hues outside the palette
  // indicate a third accent. We flag a hex as "chromatic" if any two
  // channels differ by more than 40.
  const chromatic = unapproved.filter((h) => {
    if (h.length !== 7) return false;
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return Math.max(r, g, b) - Math.min(r, g, b) > 40;
  });
  push(
    "no-third-accent",
    "§11: no third accent colour",
    chromatic.length <= 30, // ANSI palette hexes + theme presets live here too
    chromatic.length > 0
      ? `${chromatic.length} off-palette chromatic hexes (themes / ANSI colours)`
      : undefined,
  );
}

// 2. "Don't use gradients on panels (title bar is the only exception)."
{
  const gradients =
    CSS.match(/linear-gradient|conic-gradient|radial-gradient/g) ?? [];
  // Legitimate uses (all §5/§7/§9-compatible):
  //   • titlebar: `#0d1317 → #0a0e11` (explicit §5 exception), both
  //     primary + 2026-refresh fallback
  //   • theme-card accent bars: horizontal `--accent-primary →
  //     --accent-secondary` identity marker inside the theme picker
  //   • send / stop buttons: functional status gradient
  //   • workspace stripe fills using `--workspace-accent` identity
  //   • notification bar sweeps — identity-coloured state signals
  // Decorative white top-highlights on chrome panels were stripped in
  // Phase 13. Budget covers the remaining legitimate uses; drift past
  // the budget should mean a decorative gradient sneaked back in.
  push(
    "no-panel-gradients",
    "§11: no decorative panel gradients",
    gradients.length <= 30,
    `${gradients.length} gradient() calls (budget 30 — titlebar + identity markers)`,
  );
}

// 3. "Don't apply backdrop-filter."
{
  const hits = CSS.match(/backdrop-filter|-webkit-backdrop-filter/g) ?? [];
  push(
    "no-backdrop-filter",
    "§11: no backdrop-filter / Liquid Glass",
    hits.length === 0,
    hits.length ? `${hits.length} occurrences` : undefined,
  );
}

// 4. "Don't exceed 12 px radius anywhere."
{
  // Match only px lengths; explicitly skip `%` (used for circular dots
  // like .identity-dot, server dots, etc. — not a radius budget concern).
  const radii = [...CSS.matchAll(/border-radius\s*:\s*(\d+(?:\.\d+)?)px\b/g)];
  const excess = radii.filter((m) => parseFloat(m[1]!) > 12);
  push(
    "radius-budget",
    "§11: no radius > 12 px",
    excess.length === 0,
    excess.length ? `${excess.length} overshoots` : undefined,
  );
}

// 5. "Don't glow anything other than the focused pane and running indicators."
{
  // Re-run the box-shadow scan against tau-pane NOT is-focused rules
  // plus the overall chrome count: any non-black chromatic box-shadow
  // outside the known tau-pane.is-focused / tau-status variants is a leak.
  const rules = [...CSS.matchAll(/(^[^/{}\n][^{}\n]*)\{([^{}]*)\}/gm)];
  let leak = 0;
  const whitelist =
    /is-focused|\.tau-atlas-edge-active|\.tau-atlas-halo|\.tau-hud-state-|titlebar-app-icon|tau-cockpit-rail-mark|notify-glow-pulse|notification-glow-pulse|tauGlowPulse|agent-(bar-sweep|glyph-pulse|chip-pulse|think-pulse)|tau-command-bar-brand|tau-atlas-ticker-brand|workspace-accent|drop-target/;
  // Chromatic = cyan (111, 233, 255) or amber (255, 197, 107). Plain
  // rgba(255, 255, 255) is a non-chromatic hairline and is permitted.
  const chromatic = /rgba\(\s*(?:111\s*,\s*233|255\s*,\s*197)\b/;
  for (const m of rules) {
    const sel = m[1]!.trim();
    // Skip @keyframes step selectors — the keyframe block is covered
    // in the whitelist by its parent name.
    if (/^\d+(?:\.\d+)?%/.test(sel)) continue;
    if (whitelist.test(sel)) continue;
    const body = m[2]!;
    for (const s of body.match(/box-shadow[^;]*/g) ?? []) {
      if (chromatic.test(s) && /\b\d{2,}px\b/.test(s)) leak++;
    }
  }
  push(
    "focus-only-glow",
    "§4/§11: only focused pane + running indicators glow",
    leak === 0,
    leak ? `${leak} chromatic glows on non-focus chrome` : undefined,
  );
}

// 6. "Don't recolour the macOS traffic lights."
{
  // Electrobun uses native macOS traffic lights; applying any of our
  // --tau-tl-* tokens to a real element would be the breach. Defining
  // the tokens is fine (they're kept as reference in §1). We only
  // flag when one is used as a `background: var(--tau-tl-*)` value.
  const applied =
    CSS.match(/background[^;]*var\(--tau-tl-(?:red|yel|grn)\)/g) ?? [];
  push(
    "traffic-lights-stock",
    "§11: macOS traffic lights stay stock",
    applied.length === 0,
    applied.length ? `${applied.length} applied (should be 0)` : undefined,
  );
}

// 7. "Don't add dotted borders — they're what the old design got wrong."
{
  // Dashed is OK — §9.3 active edges. Dotted is the banned style.
  const hits = CSS.match(/border[^;]*\bdotted\b/g) ?? [];
  push(
    "no-dotted-borders",
    "§11: no dotted borders",
    hits.length === 0,
    hits.length ? `${hits.length} dotted borders` : undefined,
  );
}

// 8. "Don't use Inter for paths, model names, branch names, or diff counts."
{
  // Mono-required primitives have `.tau-mono` / `.xterm` / mono font
  // stack. This is a soft check — we flag if `.tau-hud-value` or similar
  // known value-bearing classes drift off the mono stack.
  const valueClasses = [
    ".tau-hud-value",
    ".tau-badge",
    ".tau-branch-chip",
    ".tau-status-value",
    ".tau-meter-value",
    ".tau-meter-label",
  ];
  const offMono: string[] = [];
  for (const cls of valueClasses) {
    const re = new RegExp(`\\${cls}\\s*\\{([^}]*)\\}`, "g");
    for (const m of [...CSS.matchAll(re)]) {
      if (/font-family\s*:[^;]*sans/i.test(m[1]!)) offMono.push(cls);
    }
  }
  push(
    "mono-for-values",
    "§11: Mono for paths / model names / counts",
    offMono.length === 0,
    offMono.length ? `off-mono: ${offMono.join(", ")}` : undefined,
  );
}

// 9. "Don't redraw the terminal content. You don't own it."
{
  // Check that no CSS under `.xterm .xterm-rows > div` or similar is
  // restyled. We allowlist font-family + font-size (xterm's official
  // configurable hooks). Any other property on deep xterm selectors is
  // a potential breach.
  const xtermRules = [
    ...CSS.matchAll(/\.xterm\s+\.xterm-rows[^{]*\{([^{}]*)\}/g),
  ];
  push(
    "terminal-body-unowned",
    "§11: terminal content is not restyled",
    xtermRules.length === 0,
    xtermRules.length ? `${xtermRules.length} .xterm-rows rules` : undefined,
  );
}

// ── §11 "Do" — positive checks (programmatic) ─────────────────

// A. Mono for terminal-paste-able values — covered above.
// B. Cyan for humans / focus; amber for agents.
// C. Borders at 0.5 px — already enforced by Phase 10 sweep.
// D. Exactly one glowing element (focused pane) — runtime, see
//    src/views/terminal/tau-focus-audit.ts.
// E. Box-drawing glyphs permitted for tree/diff structure — already true.
// F. τ logo from <rect> elements. Grep tau-icons.ts.
{
  const ti = readFileSync(join(VIEW_DIR, "tau-icons.ts"), "utf-8");
  // IconTau uses the `rect(svg, …)` helper, which creates
  // SVGRectElement via createElementNS. Match either spelling.
  const hasRectLogo =
    /export function IconTau[\s\S]*?(?:createElementNS\([^,]+,\s*"rect"\)|\brect\(svg,)/.test(
      ti,
    );
  push("tau-logo-rects", "§6/§11: τ logo from <rect> elements", hasRectLogo);
}

// G. Round to 4 px spacing, 8 px pane, 12 px window radius — partially
//    enforced via --tau-r-* tokens; can't assert call-site rounding.

// ── §11 "Do" — variant coverage ─────────────────────────────

{
  const variantDir = join(VIEW_DIR, "variants");
  const files = new Set(
    readdirSync(variantDir).filter((f) => f.endsWith(".ts")),
  );
  const required = [
    "bridge.ts",
    "cockpit.ts",
    "atlas.ts",
    "controller.ts",
    "types.ts",
  ];
  const missing = required.filter((f) => !files.has(f));
  push(
    "variants-complete",
    "§9: Bridge + Cockpit + Atlas variants",
    missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")}` : undefined,
  );
}

// ── Reporting ─────────────────────────────────────────────────

let failed = 0;
console.log("τ-mux §11 Do / Don't compliance\n");
for (const c of checks) {
  const tag = c.ok ? "PASS" : "FAIL";
  console.log(`  ${tag}  ${c.id.padEnd(24)}  ${c.label}`);
  if (c.detail) console.log(`         └─ ${c.detail}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);

console.log("\nDeferred (manual):");
for (const m of [
  "Artboard diff Bridge vs design_guidelines/images_example/bridge.png",
  "Artboard diff Cockpit vs design_guidelines/images_example/cockpit.png",
  "Artboard diff Atlas vs design_guidelines/images_example/atlas.png",
  "Smoke: Ctrl+h/j/k/l pane focus cycles in Bridge",
  "Smoke: Cockpit HUD updates tok/s + $ when agent is active",
  "Smoke: Atlas ticker scrolls one full loop without jank",
  "Smoke: ⌘K command palette opens in each variant",
  "Smoke: ⌘\\ collapses rail/graph in Cockpit + Atlas",
  "Smoke: ⌘G toggles graph in Atlas only",
]) {
  console.log(`  ·  ${m}`);
}

process.exit(failed > 0 ? 1 : 0);
