export const WORKSPACE_COLOR_OPTIONS = [
  { label: "Blue", value: "#4c8bf5" },
  { label: "Green", value: "#34c759" },
  { label: "Yellow", value: "#ffd60a" },
  { label: "Red", value: "#ff453a" },
  { label: "Pink", value: "#ff6fae" },
  { label: "Teal", value: "#64d2ff" },
  { label: "Orange", value: "#ff9f0a" },
  { label: "Purple", value: "#bf5af2" },
] as const;

export const WORKSPACE_COLORS = WORKSPACE_COLOR_OPTIONS.map(
  (option) => option.value,
);
