// ============================================================================
// main.ts — Nebula entry point.
//
// Boots three pieces and wires them together:
//   1. the frontend SDK bridge  (talks to Nebula's own Bun backend)
//   2. the 3D scene             (deep-space visualization)
//   3. the DOM HUD              (Postman-style request/response client)
//
// Data flow:
//   HUD  --onSend-->  send to backend  +  scene.fireRequest (packet animation)
//   backend --response-->  scene.onResponse (ring/pulse)  +  hud.showResponse
//   backend --endpoints-->  scene.setEndpoints  +  hud.setEndpoints
//   scene  --node click-->  hud.setUrl  (fill the URL bar)
//
// Defensive throughout: the SDK bridge may be slow, the backend may be down,
// messages may be malformed — none of that should throw on mount.
// ============================================================================

import "./styles.css";
import { createFrontendSdk } from "@tau-mux/sdk/frontend";
import { createScene } from "./scene";
import { createHud } from "./hud";
import type {
  Endpoint,
  HistoryEntry,
  HttpResult,
  ReqSpec,
  SavedRequest,
  ToBackend,
  ToFrontend,
} from "./protocol";

function boot() {
  const app = document.getElementById("app");
  if (!app) {
    console.error("[nebula] #app not found");
    return;
  }

  // --- SDK bridge (guarded) ----------------------------------------------
  // createFrontendSdk only wires postMessage listeners; it won't throw if the
  // host is slow. But we still wrap so a future change can't break mount.
  let sdk: ReturnType<typeof createFrontendSdk> | null = null;
  try {
    sdk = createFrontendSdk();
  } catch (err) {
    console.warn("[nebula] SDK bridge unavailable:", err);
  }

  /** Fire-and-forget send to the backend; never throws into UI code. */
  const sendToBackend = (msg: ToBackend) => {
    try {
      sdk?.sendToBackend(msg);
    } catch (err) {
      console.warn("[nebula] sendToBackend failed:", err);
    }
  };

  // --- 3D scene ----------------------------------------------------------
  const scene = createScene({
    // Clicking an orbiting node fills the URL bar (and selects it).
    onNodeClick: (ep: Endpoint) => {
      hud.setUrl(ep.url);
      hud.toast("info", `Targeting ${ep.url}`);
    },
  });
  try {
    scene.mount(app);
  } catch (err) {
    // A WebGL failure must not take the HUD down — it stays fully usable.
    console.error("[nebula] scene mount failed (HUD still works):", err);
  }

  // --- DOM HUD -----------------------------------------------------------
  const hud = createHud(app, {
    onSend: (req: ReqSpec) => {
      const id = crypto.randomUUID();
      hud.setLoading(true);
      armLoadingTimeout(); // safety net: never strand the Send button
      // Animate the outbound packet to the matching node (or into space).
      try {
        scene.fireRequest(id, req.url);
      } catch {
        /* scene optional */
      }
      sendToBackend({ t: "send", id, req });
    },
    onDiscover: () => {
      sendToBackend({ t: "discover" });
      hud.toast("info", "Scanning for live servers…");
    },
    onOpenBrowser: (url: string) => sendToBackend({ t: "open-browser", url }),
    onCurl: (req: ReqSpec) => sendToBackend({ t: "curl", req }),
    onSave: (req: SavedRequest) => sendToBackend({ t: "save", req }),
    onDelete: (id: string) => sendToBackend({ t: "delete", id }),
    onSelectEndpoint: (ep: Endpoint) => {
      // Pulse the node in the scene as a confirmation of selection.
      try {
        scene.fireRequest(crypto.randomUUID(), ep.url);
      } catch {
        /* optional */
      }
    },
  });

  // A safety net so a malformed in-flight request can't strand the Send button.
  let loadingTimer = 0;
  const armLoadingTimeout = () => {
    window.clearTimeout(loadingTimer);
    loadingTimer = window.setTimeout(() => hud.setLoading(false), 30_000);
  };

  // --- backend → frontend dispatch ---------------------------------------
  const handleBackendMessage = (raw: unknown) => {
    const msg = raw as ToFrontend;
    if (
      !msg ||
      typeof msg !== "object" ||
      typeof (msg as { t?: unknown }).t !== "string"
    ) {
      return;
    }
    try {
      switch (msg.t) {
        case "response": {
          const res = msg.res as HttpResult;
          window.clearTimeout(loadingTimer);
          hud.setLoading(false);
          hud.showResponse(res);
          try {
            scene.onResponse(res);
          } catch {
            /* optional */
          }
          break;
        }
        case "endpoints": {
          const items = (msg.items ?? []) as Endpoint[];
          hud.setEndpoints(items);
          try {
            scene.setEndpoints(items);
          } catch {
            /* optional */
          }
          break;
        }
        case "history":
          hud.setHistory((msg.items ?? []) as HistoryEntry[]);
          break;
        case "collection":
          hud.setCollection((msg.items ?? []) as SavedRequest[]);
          break;
        case "toast":
          hud.toast(msg.level, msg.message);
          break;
      }
    } catch (err) {
      console.warn("[nebula] dispatch error:", err);
    }
  };

  try {
    sdk?.onBackendMessage(handleBackendMessage);
  } catch (err) {
    console.warn("[nebula] onBackendMessage wiring failed:", err);
  }

  // --- resize: pane resize (SDK) + window resize -------------------------
  const doResize = (w: number, h: number) => {
    try {
      scene.resize(w, h);
    } catch {
      /* optional */
    }
  };
  try {
    sdk?.onResize(({ width, height }) => doResize(width, height));
  } catch {
    /* optional */
  }
  window.addEventListener("resize", () =>
    doResize(
      app.clientWidth || window.innerWidth,
      app.clientHeight || window.innerHeight,
    ),
  );

  // --- lifecycle: surface "backend offline" subtly -----------------------
  const setOffline = (
    hud.el as unknown as { _setOffline?: (v: boolean) => void }
  )._setOffline;
  try {
    sdk?.onLifecycle((state) => {
      if (state === "exited") {
        setOffline?.(true);
        hud.toast("error", "Backend exited");
      } else if (state === "ready") {
        setOffline?.(false);
        // On (re)ready, refresh discovery + saved state.
        sendToBackend({ t: "history" });
        sendToBackend({ t: "discover" });
      }
    });
  } catch {
    /* optional */
  }

  // --- on mount: pull persisted state + scan servers ---------------------
  sendToBackend({ t: "history" });
  sendToBackend({ t: "discover" });

  // Clean up on teardown (HMR / unload).
  window.addEventListener("beforeunload", () => {
    try {
      scene.dispose();
    } catch {
      /* ignore */
    }
  });
}

// Mount once the DOM is ready.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
