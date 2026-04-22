/**
 * τ-mux design tokens — source of truth for the revamp.
 *
 * Mirrors the TAU palette from
 *   design_guidelines/Design Guidelines tau-mux.md §1
 *   design_guidelines/src/tokens.jsx
 *
 * These constants are design-system invariants. They are NEVER
 * overridden at runtime by the user's theme preset — user-customisable
 * accents live under `--accent-primary` / `--accent-secondary` in
 * `index.css` and are applied by `SurfaceManager.applySettings`.
 *
 * Use `TAU` from TypeScript, and `var(--tau-*)` from CSS. The two
 * must stay in sync.
 */
export const TAU = {
  // Surface
  void: "#000000",
  bg: "#07090b",
  panel: "#0b1013",
  panelHi: "#0f161a",
  panelEdge: "#1a2328",
  panelEdgeSoft: "#121a1e",

  // Text
  text: "#d6e2e8",
  textDim: "#8a9aa3",
  textMute: "#55646c",
  textFaint: "#38434a",

  // Accent — cyan (logo glow / humans / focus / system)
  cyan: "#6fe9ff",
  cyanSoft: "#33b8d6",
  cyanDim: "rgba(111, 233, 255, 0.18)",
  cyanGlow: "rgba(111, 233, 255, 0.55)",

  // Agent identity — warm amber
  agent: "#ffc56b",
  agentSoft: "#d59a45",
  agentDim: "rgba(255, 197, 107, 0.14)",

  // States
  ok: "#8ce99a",
  warn: "#ffc56b",
  err: "#ff8a8a",

  // macOS traffic lights — stock colours, never recolour (§5).
  tlRed: "#ff5f57",
  tlYel: "#febc2e",
  tlGrn: "#28c93f",
} as const;

export type TauToken = keyof typeof TAU;

/** CSS-variable name for a given token, e.g. `tauVar("cyan") === "var(--tau-cyan)"`. */
export const tauVar = (k: TauToken): string => {
  // Convert camelCase → kebab-case to match the --tau-* names in index.css.
  const kebab = k.replace(/([A-Z])/g, "-$1").toLowerCase();
  return `var(--tau-${kebab})`;
};

/** Radius scale (§3). Nothing larger than window=12px anywhere. */
export const TAU_RADIUS = {
  window: 12,
  pane: 8,
  button: 5,
  chip: 3,
} as const;

/** Spacing grid unit — every padding/gap is a multiple of 4. */
export const TAU_GRID = 4;

/** Identity kinds per §7 — cyan (human / system / focus) / amber (agent) / white (mixed). */
export type TauIdentity = "human" | "agent" | "mixed";

export const identityColor = (k: TauIdentity): string => {
  if (k === "agent") return TAU.agent;
  if (k === "mixed") return TAU.text;
  return TAU.cyan;
};

export const identityDim = (k: TauIdentity): string => {
  if (k === "agent") return TAU.agentDim;
  if (k === "mixed") return "rgba(214, 226, 232, 0.14)";
  return TAU.cyanDim;
};
