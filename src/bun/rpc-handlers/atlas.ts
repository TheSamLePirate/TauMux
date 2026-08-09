/**
 * `atlas.*` RPC handlers — the graph's write side.
 *
 * Everything else the Atlas graph draws is observed. These verbs let the
 * thing doing the work say something observation cannot reach: which
 * node matters, what it is blocked on, how far along it is, and when a
 * milestone landed.
 *
 * Target resolution mirrors the rest of the CLI: an explicit
 * `--surface` / `--workspace`, else `HT_SURFACE` (which every pane's
 * shell exports), else the focused surface. An agent inside a pane
 * therefore annotates its own node with no arguments at all.
 */
import type { AtlasAnnotationStore } from "../atlas-annotations";
import type { Handler, HandlerDeps } from "./types";

function tone(value: unknown): "info" | "ok" | "warn" | "err" | undefined {
  return value === "ok" ||
    value === "warn" ||
    value === "err" ||
    value === "info"
    ? value
    : undefined;
}

function text(params: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = params[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

export function registerAtlas(
  deps: HandlerDeps,
  store: AtlasAnnotationStore,
): Record<string, Handler> {
  /** Which node an annotation lands on. Explicit workspace beats
   *  explicit surface beats the caller's own pane beats the focused one —
   *  so `ht atlas note "…"` inside a pane needs no arguments. */
  const target = (params: Record<string, unknown>): string | null => {
    const ws = params["workspace"] ?? params["workspace_id"];
    if (typeof ws === "string" && ws) return ws;
    const surface =
      params["surface"] ?? params["surface_id"] ?? params["surfaceId"];
    if (typeof surface === "string" && surface) return surface;
    return deps.getState().focusedSurfaceId;
  };

  const need = (params: Record<string, unknown>): string | null =>
    target(params);

  return {
    /** Keep a node visible: it stays expanded and reads as pinned. */
    "atlas.pin": (params) => {
      const id = need(params);
      if (!id) return "ERR: no target (pass --surface or --workspace)";
      store.pin(id, params["off"] !== true);
      return "OK";
    },

    "atlas.unpin": (params) => {
      const id = need(params);
      if (!id) return "ERR: no target (pass --surface or --workspace)";
      store.pin(id, false);
      return "OK";
    },

    /** One line of context on a node — "waiting on CI", "rebasing". */
    "atlas.note": (params) => {
      const id = need(params);
      if (!id) return "ERR: no target (pass --surface or --workspace)";
      store.note(
        id,
        text(params, "text", "note", "message"),
        tone(params["tone"]),
      );
      return "OK";
    },

    /** A named 0…1 reading. Values outside the range are clamped rather
     *  than refused: a caller reporting 1.4 means "done". */
    "atlas.meter": (params) => {
      const id = need(params);
      if (!id) return "ERR: no target (pass --surface or --workspace)";
      const key = text(params, "key", "name");
      if (!key) return "ERR: meter needs a key";
      const raw = params["value"];
      const value =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
            ? Number(raw)
            : Number.NaN;
      if (!Number.isFinite(value)) return "ERR: meter needs a numeric value";
      // Accept 0–100 as a percentage too — a caller writing `62` almost
      // certainly means 62 %, and refusing would be pedantry.
      const normalised = value > 1 ? value / 100 : value;
      const label = text(params, "label");
      store.meter(id, key, normalised, label || undefined);
      return "OK";
    },

    "atlas.clear_meter": (params) => {
      const id = need(params);
      const key = text(params, "key", "name");
      if (!id || !key) return "ERR: clear_meter needs a target and a key";
      store.clearMeter(id, key);
      return "OK";
    },

    /** A timestamped milestone on the activity river. */
    "atlas.mark": (params) => {
      const body = text(params, "text", "message", "note");
      if (!body) return "ERR: mark needs text";
      const explicit =
        params["workspace"] ?? params["surface"] ?? params["surface_id"];
      const entry = store.mark(body, {
        ...(typeof explicit === "string" && explicit
          ? { target: explicit }
          : {}),
        ...(tone(params["tone"]) ? { tone: tone(params["tone"])! } : {}),
      });
      return entry ? { ok: true, id: entry.id, at: entry.at } : "ERR: empty";
    },

    /** Drop annotations for one target, or all of them. */
    "atlas.clear": (params) => {
      const scopeAll = params["all"] === true;
      if (scopeAll) {
        store.clear();
        return "OK";
      }
      const id = need(params);
      if (!id) return "ERR: no target (pass --surface, --workspace or --all)";
      store.clear(id);
      return "OK";
    },

    /** Read back what is currently annotated. */
    "atlas.state": () => store.snapshot(),
  };
}
