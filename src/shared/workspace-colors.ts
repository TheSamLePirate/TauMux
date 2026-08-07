/**
 * Workspace accent palette.
 *
 * These are an *organisational* axis (which project am I looking at),
 * distinct from the §7 identity axis (cyan = human, amber = agent). They
 * are still required to live in the same visual world as the rest of the
 * app: the previous set was the stock macOS system palette (#4c8bf5,
 * #34c759, #ffd60a, #ff453a …), which is tuned for a light-grey chrome
 * and reads as foreign — over-saturated and slightly acid — against the
 * #07090b window the τ-mux canon specifies.
 *
 * The replacements keep the same eight hue positions, so a user's mental
 * "green project / red project" mapping survives, but each is re-voiced
 * in the luminous-pastel register the canon tokens already use. Four are
 * exactly the canon tokens (--tau-cyan / --tau-ok / --tau-agent /
 * --tau-err); the other four are interpolated between them at matching
 * lightness so no single swatch jumps out of the set.
 *
 * Index 0 is what a first workspace gets, and it is the app's own cyan.
 *
 * Changing these values is safe for existing installs: a workspace
 * persists the resolved hex it was created with, so old workspaces keep
 * their colour and simply no longer match an entry in the picker.
 */
export const WORKSPACE_COLOR_OPTIONS = [
  { label: "Cyan", value: "#6fe9ff" },
  { label: "Teal", value: "#5ad1c4" },
  { label: "Green", value: "#8ce99a" },
  { label: "Amber", value: "#ffc56b" },
  { label: "Orange", value: "#ff9e64" },
  { label: "Red", value: "#ff8a8a" },
  { label: "Pink", value: "#f2a0c8" },
  { label: "Violet", value: "#b4a0f0" },
] as const;

export const WORKSPACE_COLORS = WORKSPACE_COLOR_OPTIONS.map(
  (option) => option.value,
);
