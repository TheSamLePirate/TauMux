import type { Handler, HandlerDeps } from "./types";
import { KEY_MAP, resolveSurfaceId } from "./shared";

export function registerSurface(deps: HandlerDeps): Record<string, Handler> {
  const { sessions, getState, dispatch, requestWebview, metadataPoller } = deps;

  return {
    "surface.list": () => {
      return sessions.getAllSurfaces().map((s) => ({
        id: s.id,
        pid: s.pty.pid,
        title: s.title,
        cwd: s.cwd,
      }));
    },

    "surface.metadata": (params) => {
      const id = resolveSurfaceId(params, getState().focusedSurfaceId);
      if (!id) return null;
      return metadataPoller?.getSnapshot(id) ?? null;
    },

    "surface.kill_pid": (params) => {
      const pid = Number(params["pid"]);
      if (!Number.isFinite(pid) || pid <= 0) throw new Error("pid required");

      // Signal whitelist. We only ever need termination-family signals
      // from RPC; allowing e.g. SIGSTOP would let a local client freeze
      // arbitrary user processes.
      const ALLOWED_SIGNALS = new Set<NodeJS.Signals>([
        "SIGTERM",
        "SIGINT",
        "SIGKILL",
        "SIGHUP",
        "SIGQUIT",
      ]);
      const raw = (params["signal"] as string) || "SIGTERM";
      const signal = (
        raw.startsWith("SIG") ? raw : `SIG${raw}`
      ) as NodeJS.Signals;
      if (!ALLOWED_SIGNALS.has(signal)) {
        throw new Error(
          `signal ${signal} not allowed; must be one of ${[...ALLOWED_SIGNALS].join(", ")}`,
        );
      }

      // PID must belong to a process tree we track. Without this,
      // anything that can speak JSON-RPC to our socket (mode 0600, so
      // any process the user runs) could kill ssh-agent, Finder, or
      // the Electrobun parent. We rebuild the allowed set from live
      // surface metadata — the same tree the UI exposes.
      const allowedPids = new Set<number>();
      for (const s of sessions.getAllSurfaces()) {
        const snap = metadataPoller?.getSnapshot(s.id);
        if (!snap) {
          // Fall back to the surface's own root pid if we haven't
          // polled yet — otherwise the first kill after app start
          // would always reject.
          if (typeof s.pty.pid === "number") allowedPids.add(s.pty.pid);
          continue;
        }
        for (const node of snap.tree) allowedPids.add(node.pid);
      }
      if (!allowedPids.has(pid)) {
        throw new Error(`pid ${pid} is not in a tracked surface tree`);
      }

      try {
        process.kill(pid, signal);
      } catch (err) {
        throw new Error(
          `kill failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return { pid, signal };
    },

    "surface.kill_port": (params) => {
      const id = resolveSurfaceId(params, getState().focusedSurfaceId);
      const port = Number(params["port"]);
      if (!Number.isFinite(port) || port <= 0) {
        throw new Error("port required");
      }
      if (!id) throw new Error("no surface");
      const meta = metadataPoller?.getSnapshot(id);
      if (!meta) throw new Error("no metadata yet — try again in a second");
      const entry = meta.listeningPorts.find((p) => p.port === port);
      if (!entry) {
        throw new Error(`no process listening on :${port} in this surface`);
      }
      const rawSignal = (params["signal"] as string) || "SIGTERM";
      const signal = rawSignal.startsWith("SIG")
        ? (rawSignal as NodeJS.Signals)
        : (`SIG${rawSignal}` as NodeJS.Signals);
      try {
        process.kill(entry.pid, signal);
      } catch (err) {
        throw new Error(
          `kill failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return { pid: entry.pid, port, signal };
    },

    "surface.open_port": (params) => {
      const id = resolveSurfaceId(params, getState().focusedSurfaceId);
      let port = Number(params["port"]);

      if (!Number.isFinite(port) || port <= 0) {
        if (!id) throw new Error("no surface");
        const meta = metadataPoller?.getSnapshot(id);
        if (!meta) throw new Error("no metadata yet — try again in a second");
        const uniquePorts = [
          ...new Set(meta.listeningPorts.map((p) => p.port)),
        ].sort((a, b) => a - b);
        if (uniquePorts.length === 0) {
          throw new Error("no listening ports in this surface");
        }
        if (uniquePorts.length > 1) {
          throw new Error(
            `multiple listening ports (${uniquePorts.join(", ")}); pass one explicitly`,
          );
        }
        port = uniquePorts[0];
      }

      const url = `http://localhost:${port}`;
      dispatch("openExternal", { url });
      return { url, port };
    },

    "surface.split": (params) => {
      const dir = params["direction"] as string;
      const direction =
        dir === "right" || dir === "horizontal"
          ? "horizontal"
          : dir === "down" || dir === "vertical"
            ? "vertical"
            : "horizontal";
      dispatch("splitSurface", { direction });
      return "OK";
    },

    "surface.close": (params) => {
      const id = resolveSurfaceId(params, getState().focusedSurfaceId);
      if (id) sessions.closeSurface(id);
      return "OK";
    },

    "surface.focus": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (id) dispatch("focusSurface", { surfaceId: id });
      return "OK";
    },

    "surface.rename": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const title = (params["name"] as string) ?? (params["title"] as string);
      if (id && title) dispatch("renameSurface", { surfaceId: id, title });
      return "OK";
    },

    "surface.send_text": (params) => {
      const id = resolveSurfaceId(params, getState().focusedSurfaceId);
      const text = params["text"] as string;
      if (id && text) sessions.writeStdin(id, text);
      return "OK";
    },

    "surface.send_key": (params) => {
      const id = resolveSurfaceId(params, getState().focusedSurfaceId);
      const key = (params["key"] as string)?.toLowerCase();
      const seq = KEY_MAP[key];
      if (id && seq) sessions.writeStdin(id, seq);
      return "OK";
    },

    "surface.read_text": async (params) => {
      const id = resolveSurfaceId(params, getState().focusedSurfaceId);
      if (!id) return "";
      if (!requestWebview) return "";
      return await requestWebview("readScreen", {
        surfaceId: id,
        lines: params["lines"],
        scrollback: params["scrollback"],
      });
    },
  };
}
