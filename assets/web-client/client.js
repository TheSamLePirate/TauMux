(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __moduleCache = /* @__PURE__ */ new WeakMap;
  var __toCommonJS = (from) => {
    var entry = __moduleCache.get(from), desc;
    if (entry)
      return entry;
    entry = __defProp({}, "__esModule", { value: true });
    if (from && typeof from === "object" || typeof from === "function")
      __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
        get: () => from[key],
        enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
      }));
    __moduleCache.set(from, entry);
    return entry;
  };

  // src/web-client/main.ts
  var exports_main = {};

  // src/web-client/store.ts
  function initialState() {
    return {
      connection: {
        status: "connecting",
        sessionId: null,
        serverInstanceId: null,
        lastSeenSeq: -1
      },
      nativeViewport: null,
      surfaces: {},
      workspaces: [],
      activeWorkspaceId: null,
      focusedSurfaceId: null,
      sidebarVisible: false,
      fullscreenSurfaceId: null,
      panels: {},
      sidebar: {
        notifications: [],
        logs: [],
        status: {},
        progress: {}
      },
      glowingSurfaceIds: []
    };
  }
  var MAX_GLOWING = 16;
  function reducer(state, action) {
    switch (action.kind) {
      case "connection/status":
        return {
          ...state,
          connection: { ...state.connection, status: action.status }
        };
      case "connection/hello":
        return {
          ...state,
          connection: {
            ...state.connection,
            sessionId: action.sessionId,
            serverInstanceId: action.serverInstanceId,
            lastSeenSeq: action.lastSeenSeq
          }
        };
      case "connection/seq":
        if (action.seq <= state.connection.lastSeenSeq)
          return state;
        return {
          ...state,
          connection: { ...state.connection, lastSeenSeq: action.seq }
        };
      case "connection/reset":
        return {
          ...state,
          connection: {
            status: "connecting",
            sessionId: null,
            serverInstanceId: null,
            lastSeenSeq: -1
          },
          surfaces: {},
          panels: {},
          workspaces: [],
          activeWorkspaceId: null,
          focusedSurfaceId: null,
          fullscreenSurfaceId: null,
          glowingSurfaceIds: []
        };
      case "snapshot/apply": {
        const s = action.snapshot;
        const surfaces = {};
        for (const sref of s.surfaces) {
          surfaces[sref.id] = {
            id: sref.id,
            title: sref.title,
            cols: sref.cols,
            rows: sref.rows,
            metadata: s.metadata[sref.id] ?? null
          };
        }
        const panels = {};
        for (const pid in s.panels) {
          const entry = s.panels[pid];
          panels[pid] = {
            id: pid,
            surfaceId: entry.surfaceId,
            meta: entry.meta
          };
        }
        return {
          ...state,
          nativeViewport: s.nativeViewport,
          surfaces,
          workspaces: s.workspaces,
          activeWorkspaceId: s.activeWorkspaceId,
          focusedSurfaceId: s.focusedSurfaceId,
          sidebarVisible: s.sidebarVisible,
          panels,
          sidebar: {
            notifications: s.notifications.slice(),
            logs: s.logs.slice(),
            status: cloneRecord(s.status),
            progress: { ...s.progress }
          },
          fullscreenSurfaceId: null,
          glowingSurfaceIds: []
        };
      }
      case "surface/created": {
        if (state.surfaces[action.surfaceId]) {
          const existing = state.surfaces[action.surfaceId];
          return {
            ...state,
            surfaces: {
              ...state.surfaces,
              [action.surfaceId]: { ...existing, title: action.title }
            }
          };
        }
        return {
          ...state,
          surfaces: {
            ...state.surfaces,
            [action.surfaceId]: {
              id: action.surfaceId,
              title: action.title,
              cols: 80,
              rows: 24,
              metadata: null
            }
          }
        };
      }
      case "surface/renamed": {
        const s = state.surfaces[action.surfaceId];
        if (!s)
          return state;
        return {
          ...state,
          surfaces: {
            ...state.surfaces,
            [action.surfaceId]: { ...s, title: action.title }
          }
        };
      }
      case "surface/closed": {
        if (!state.surfaces[action.surfaceId])
          return state;
        const rest = {};
        for (const sid in state.surfaces) {
          if (sid !== action.surfaceId)
            rest[sid] = state.surfaces[sid];
        }
        const panels = {};
        for (const pid in state.panels) {
          if (state.panels[pid].surfaceId !== action.surfaceId) {
            panels[pid] = state.panels[pid];
          }
        }
        return {
          ...state,
          surfaces: rest,
          panels,
          fullscreenSurfaceId: state.fullscreenSurfaceId === action.surfaceId ? null : state.fullscreenSurfaceId,
          focusedSurfaceId: state.focusedSurfaceId === action.surfaceId ? null : state.focusedSurfaceId,
          glowingSurfaceIds: state.glowingSurfaceIds.filter((id) => id !== action.surfaceId)
        };
      }
      case "surface/resized": {
        const s = state.surfaces[action.surfaceId];
        if (!s)
          return state;
        return {
          ...state,
          surfaces: {
            ...state.surfaces,
            [action.surfaceId]: {
              ...s,
              cols: action.cols,
              rows: action.rows
            }
          }
        };
      }
      case "surface/metadata": {
        const s = state.surfaces[action.surfaceId];
        if (!s) {
          return {
            ...state,
            surfaces: {
              ...state.surfaces,
              [action.surfaceId]: {
                id: action.surfaceId,
                title: action.surfaceId,
                cols: 80,
                rows: 24,
                metadata: action.metadata
              }
            }
          };
        }
        return {
          ...state,
          surfaces: {
            ...state.surfaces,
            [action.surfaceId]: { ...s, metadata: action.metadata }
          }
        };
      }
      case "focus/set":
        return {
          ...state,
          focusedSurfaceId: action.surfaceId,
          glowingSurfaceIds: state.glowingSurfaceIds.filter((id) => id !== action.surfaceId)
        };
      case "layout/changed":
        return {
          ...state,
          workspaces: action.workspaces,
          activeWorkspaceId: action.activeWorkspaceId ?? state.activeWorkspaceId,
          focusedSurfaceId: action.focusedSurfaceId ?? state.focusedSurfaceId
        };
      case "workspace/active":
        return { ...state, activeWorkspaceId: action.workspaceId };
      case "sidebar/visible":
        return { ...state, sidebarVisible: action.visible };
      case "sidebar/action": {
        const wsIdRaw = action.payload["workspaceId"];
        const wsId = typeof wsIdRaw === "string" && wsIdRaw || state.activeWorkspaceId || "";
        if (!wsId)
          return state;
        const next = { ...state.sidebar };
        if (action.action === "setStatus") {
          const key = action.payload["key"];
          if (typeof key !== "string" || !key)
            return state;
          next.status = { ...next.status };
          next.status[wsId] = { ...next.status[wsId] ?? {} };
          next.status[wsId][key] = {
            value: String(action.payload["value"] ?? ""),
            icon: typeof action.payload["icon"] === "string" ? action.payload["icon"] : undefined,
            color: typeof action.payload["color"] === "string" ? action.payload["color"] : undefined
          };
        } else if (action.action === "clearStatus") {
          const key = action.payload["key"];
          if (typeof key !== "string" || !next.status[wsId])
            return state;
          next.status = { ...next.status };
          const bucket = { ...next.status[wsId] ?? {} };
          delete bucket[key];
          next.status[wsId] = bucket;
        } else if (action.action === "setProgress") {
          next.progress = {
            ...next.progress,
            [wsId]: {
              value: Number(action.payload["value"] ?? 0),
              label: typeof action.payload["label"] === "string" ? action.payload["label"] : undefined
            }
          };
        } else if (action.action === "clearProgress") {
          next.progress = { ...next.progress };
          delete next.progress[wsId];
        } else if (action.action === "log") {
          const level = action.payload["level"];
          const entry = {
            level: level === "error" || level === "warning" || level === "success" || level === "info" ? level : "info",
            message: String(action.payload["message"] ?? ""),
            source: typeof action.payload["source"] === "string" ? action.payload["source"] : undefined,
            at: Date.now()
          };
          next.logs = [...next.logs, entry].slice(-200);
        }
        return { ...state, sidebar: next };
      }
      case "notification/add": {
        const next = {
          ...state.sidebar,
          notifications: [...state.sidebar.notifications, action.entry].slice(-50)
        };
        const glow = action.entry.surfaceId ? uniqueAppend(state.glowingSurfaceIds, action.entry.surfaceId) : state.glowingSurfaceIds;
        return {
          ...state,
          sidebar: next,
          glowingSurfaceIds: glow.slice(-MAX_GLOWING)
        };
      }
      case "notification/clear":
        return {
          ...state,
          sidebar: { ...state.sidebar, notifications: [] },
          glowingSurfaceIds: []
        };
      case "glow/clear":
        if (!action.surfaceId) {
          return { ...state, glowingSurfaceIds: [] };
        }
        return {
          ...state,
          glowingSurfaceIds: state.glowingSurfaceIds.filter((id) => id !== action.surfaceId)
        };
      case "panel/meta": {
        const id = action.meta.id;
        if (!id)
          return state;
        if (action.meta.type === "clear") {
          if (!state.panels[id])
            return state;
          return { ...state, panels: omitKey(state.panels, id) };
        }
        const existing = state.panels[id];
        if (action.meta.type === "update" && existing) {
          return {
            ...state,
            panels: {
              ...state.panels,
              [id]: {
                ...existing,
                meta: { ...existing.meta, ...action.meta }
              }
            }
          };
        }
        return {
          ...state,
          panels: {
            ...state.panels,
            [id]: { id, surfaceId: action.surfaceId, meta: action.meta }
          }
        };
      }
      case "panel/event": {
        const existing = state.panels[action.panelId];
        if (!existing)
          return state;
        if (action.event === "close") {
          return { ...state, panels: omitKey(state.panels, action.panelId) };
        }
        if (action.event === "dragend" || action.event === "resize") {
          const meta = { ...existing.meta };
          if (action.x !== undefined)
            meta.x = action.x;
          if (action.y !== undefined)
            meta.y = action.y;
          if (action.width !== undefined)
            meta.width = action.width;
          if (action.height !== undefined)
            meta.height = action.height;
          return {
            ...state,
            panels: {
              ...state.panels,
              [action.panelId]: { ...existing, meta }
            }
          };
        }
        return state;
      }
      case "panel/data-failed": {
        if (!state.panels[action.panelId])
          return state;
        return { ...state, panels: omitKey(state.panels, action.panelId) };
      }
      case "native-viewport":
        return {
          ...state,
          nativeViewport: { width: action.width, height: action.height }
        };
      case "fullscreen/enter":
        return { ...state, fullscreenSurfaceId: action.surfaceId };
      case "fullscreen/exit":
        return { ...state, fullscreenSurfaceId: null };
      default:
        return state;
    }
  }
  function uniqueAppend(list, value) {
    if (list.includes(value))
      return list;
    return [...list, value];
  }
  function omitKey(r, key) {
    const out = {};
    for (const k in r) {
      if (k !== key)
        out[k] = r[k];
    }
    return out;
  }
  function cloneRecord(r) {
    const out = {};
    for (const k in r)
      out[k] = { ...r[k] };
    return out;
  }
  function createStore(seed = initialState(), reduce = reducer) {
    let state = seed;
    const listeners = new Set;
    return {
      getState: () => state,
      dispatch(action) {
        const next = reduce(state, action);
        if (next === state)
          return;
        state = next;
        for (const listener of listeners) {
          try {
            listener(state, action);
          } catch (err) {
            console.error("[store] listener error", err);
          }
        }
      },
      subscribe(listener) {
        listeners.add(listener);
        listener(state, null);
        return () => {
          listeners.delete(listener);
        };
      }
    };
  }

  // src/web-client/icons.ts
  var ICONS = {
    sidebar: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="6" y1="3" x2="6" y2="13"/></svg>',
    back: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9,3 4,8 9,13"/><line x1="4" y1="8" x2="13" y2="8"/></svg>',
    fullscreen: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3,6 3,3 6,3"/><polyline points="13,6 13,3 10,3"/><polyline points="3,10 3,13 6,13"/><polyline points="13,10 13,13 10,13"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',
    settings: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2"/><path d="M13 8a5 5 0 0 0-.12-1.1l1.1-.84-1-1.72-1.3.48a5 5 0 0 0-1.9-1.1L9.5 2h-2l-.3 1.72a5 5 0 0 0-1.9 1.1l-1.3-.48-1 1.72 1.1.84A5 5 0 0 0 4 8a5 5 0 0 0 .12 1.1l-1.1.84 1 1.72 1.3-.48a5 5 0 0 0 1.9 1.1L7.5 14h2l.3-1.72a5 5 0 0 0 1.9-1.1l1.3.48 1-1.72-1.1-.84A5 5 0 0 0 13 8z"/></svg>',
    signal: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="3" fill="currentColor" stroke="none"/></svg>'
  };

  // src/shared/web-protocol.ts
  var WEB_PROTOCOL_VERSION = 2;

  // src/web-client/main.ts
  var TERM_THEME = {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "#585b70",
    selectionForeground: "#cdd6f4",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8"
  };
  var TERM_OPTS = {
    theme: TERM_THEME,
    fontFamily: "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 1e4
  };
  var GAP = 2;
  var TOOLBAR_HEIGHT = 36;
  var SIDEBAR_WIDTH = 260;
  var fr = new FontFace("JetBrainsMono Nerd Font Mono", "url(/fonts/nerd-regular.ttf)", { style: "normal", weight: "400" });
  var fb = new FontFace("JetBrainsMono Nerd Font Mono", "url(/fonts/nerd-bold.ttf)", { style: "normal", weight: "700" });
  document.fonts.add(fr);
  document.fonts.add(fb);
  Promise.all([fr.load(), fb.load()]).then(() => document.fonts.ready).then(boot).catch(boot);
  function boot() {
    const container = document.getElementById("pane-container");
    const wsSelectEl = document.getElementById("workspace-select");
    const dotEl = document.getElementById("status-dot");
    const fsBtn = document.getElementById("fullscreen-btn");
    const backBtn = document.getElementById("back-btn");
    const sidebarEl = document.getElementById("sidebar");
    const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
    sidebarToggleBtn.innerHTML = ICONS.sidebar;
    backBtn.innerHTML = ICONS.back;
    fsBtn.innerHTML = ICONS.fullscreen;
    const store = createStore();
    const terms = {};
    const panelsDom = {};
    let ws = null;
    let reconnectDelay = 1000;
    function sendMsg(type, payload) {
      if (!ws || ws.readyState !== WebSocket.OPEN)
        return;
      const s = store.getState();
      ws.send(JSON.stringify({
        v: WEB_PROTOCOL_VERSION,
        ack: s.connection.lastSeenSeq >= 0 ? s.connection.lastSeenSeq : undefined,
        type,
        payload
      }));
    }
    function setDotFromState(state) {
      dotEl.className = state.connection.status === "connected" ? "connected" : state.connection.status === "connecting" ? "reconnecting" : "";
    }
    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const { sessionId, lastSeenSeq } = store.getState().connection;
      const pageT = new URLSearchParams(location.search).get("t");
      const params = new URLSearchParams;
      if (sessionId && lastSeenSeq >= 0) {
        params.set("resume", sessionId);
        params.set("seq", String(lastSeenSeq));
      }
      if (pageT)
        params.set("t", pageT);
      const qs = params.toString() ? `?${params.toString()}` : "";
      ws = new WebSocket(proto + "//" + location.host + "/" + qs);
      ws.binaryType = "arraybuffer";
      store.dispatch({ kind: "connection/status", status: "connecting" });
      ws.onopen = () => {
        reconnectDelay = 1000;
        store.dispatch({ kind: "connection/status", status: "connected" });
      };
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const buf = new Uint8Array(event.data);
          const dv = new DataView(event.data);
          const hLen = dv.getUint32(0, false);
          let hdr;
          try {
            hdr = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hLen)));
          } catch {
            return;
          }
          const payload = buf.subarray(4 + hLen);
          if (typeof hdr.seq === "number")
            store.dispatch({ kind: "connection/seq", seq: hdr.seq });
          if (hdr.type === "sidebandData")
            renderPanelData(hdr.id, payload, true);
          return;
        }
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (typeof msg.seq === "number")
          store.dispatch({ kind: "connection/seq", seq: msg.seq });
        const type = msg.type;
        const p = msg && typeof msg.payload === "object" && msg.payload !== null ? msg.payload : msg;
        if (!type)
          return;
        handleServerMessage(type, p);
      };
      ws.onclose = () => {
        store.dispatch({ kind: "connection/status", status: "disconnected" });
        setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          connect();
        }, reconnectDelay);
      };
      ws.onerror = () => {};
    }
    function handleServerMessage(type, p) {
      switch (type) {
        case "hello": {
          store.dispatch({
            kind: "connection/hello",
            sessionId: p.sessionId,
            serverInstanceId: p.serverInstanceId,
            lastSeenSeq: store.getState().connection.lastSeenSeq
          });
          if (p.snapshot)
            store.dispatch({ kind: "snapshot/apply", snapshot: p.snapshot });
          if (p.sessionId)
            console.info("[web] session", p.sessionId, "v", p.protocolVersion);
          break;
        }
        case "snapshot":
          store.dispatch({ kind: "snapshot/apply", snapshot: p });
          break;
        case "history": {
          const ref = terms[p.surfaceId];
          if (ref) {
            ref.term.reset();
            ref.term.write(p.data);
          }
          break;
        }
        case "output": {
          const ref = terms[p.surfaceId];
          if (ref)
            ref.term.write(p.data);
          break;
        }
        case "resize":
          store.dispatch({
            kind: "surface/resized",
            surfaceId: p.surfaceId,
            cols: p.cols,
            rows: p.rows
          });
          break;
        case "surfaceCreated":
          store.dispatch({
            kind: "surface/created",
            surfaceId: p.surfaceId,
            title: p.title || p.surfaceId
          });
          sendMsg("subscribeSurface", { surfaceId: p.surfaceId });
          break;
        case "surfaceRenamed":
          store.dispatch({
            kind: "surface/renamed",
            surfaceId: p.surfaceId,
            title: p.title
          });
          break;
        case "surfaceClosed":
          store.dispatch({ kind: "surface/closed", surfaceId: p.surfaceId });
          break;
        case "surfaceExited":
          break;
        case "nativeViewport":
          store.dispatch({
            kind: "native-viewport",
            width: p.width,
            height: p.height
          });
          break;
        case "layoutChanged":
          store.dispatch({
            kind: "layout/changed",
            workspaces: p.workspaces ?? [],
            activeWorkspaceId: p.activeWorkspaceId ?? null,
            focusedSurfaceId: p.focusedSurfaceId ?? null
          });
          break;
        case "focusChanged":
          store.dispatch({ kind: "focus/set", surfaceId: p.surfaceId });
          break;
        case "notification":
          store.dispatch({
            kind: "notification/add",
            entry: {
              id: `n:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
              title: p.title || "",
              body: p.body || "",
              surfaceId: p.surfaceId,
              at: p.at || Date.now()
            }
          });
          break;
        case "notificationClear":
          store.dispatch({ kind: "notification/clear" });
          break;
        case "surfaceMetadata":
          store.dispatch({
            kind: "surface/metadata",
            surfaceId: p.surfaceId,
            metadata: p.metadata
          });
          break;
        case "sidebarState":
          store.dispatch({
            kind: "sidebar/visible",
            visible: Boolean(p.visible)
          });
          break;
        case "sidebarAction":
          store.dispatch({
            kind: "sidebar/action",
            action: p.action,
            payload: p.payload || {}
          });
          break;
        case "sidebandMeta":
          store.dispatch({
            kind: "panel/meta",
            surfaceId: p.surfaceId,
            meta: p.meta
          });
          break;
        case "sidebandDataFailed":
          store.dispatch({ kind: "panel/data-failed", panelId: p.id });
          break;
        case "panelEvent":
          store.dispatch({
            kind: "panel/event",
            panelId: p.id,
            event: p.event,
            x: p.x,
            y: p.y,
            width: p.width,
            height: p.height
          });
          break;
      }
    }
    let scheduled = false;
    let prevState = store.getState();
    function scheduleRender() {
      if (scheduled)
        return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const s = store.getState();
        render(s, prevState);
        prevState = s;
      });
    }
    store.subscribe(() => scheduleRender());
    function render(state, prev) {
      setDotFromState(state);
      if (state.sidebarVisible !== prev.sidebarVisible)
        applySidebarVisibility(state);
      if (state.workspaces !== prev.workspaces)
        updateWorkspaceSelect(state);
      if (state.sidebar !== prev.sidebar || state.workspaces !== prev.workspaces)
        renderSidebar(state);
      reconcilePanes(state);
      reconcilePanels(state);
      applyLayout(state);
      applyChips(state, prev);
      applyFullscreen(state, prev);
      applyGlow(state, prev);
    }
    function reconcilePanes(state) {
      const ws2 = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      const activeIds = new Set;
      if (ws2)
        collectSurfaceIds(ws2.layout, activeIds);
      for (const sid in terms) {
        if (!activeIds.has(sid))
          disposePane(sid);
      }
      for (const sid of activeIds) {
        if (!terms[sid])
          createPane(sid, state);
      }
      for (const sid in terms) {
        const surf = state.surfaces[sid];
        if (surf && surf.cols && surf.rows) {
          try {
            terms[sid].term.resize(surf.cols, surf.rows);
          } catch {}
        }
      }
    }
    function collectSurfaceIds(node, out) {
      if (!node)
        return;
      if (node.type === "leaf")
        out.add(node.surfaceId);
      else
        for (const c of node.children)
          collectSurfaceIds(c, out);
    }
    function createPane(surfaceId, state) {
      const surf = state.surfaces[surfaceId];
      const el = document.createElement("div");
      el.className = "pane";
      el.setAttribute("data-surface", surfaceId);
      const bar = document.createElement("div");
      bar.className = "pane-bar";
      const barTitle = document.createElement("span");
      barTitle.className = "pane-bar-title";
      barTitle.textContent = surf?.title ?? surfaceId;
      bar.appendChild(barTitle);
      const chipsEl = document.createElement("div");
      chipsEl.className = "pane-bar-chips";
      bar.appendChild(chipsEl);
      const paneFsBtn = document.createElement("button");
      paneFsBtn.className = "pane-bar-btn";
      paneFsBtn.title = "Fullscreen";
      paneFsBtn.innerHTML = ICONS.fullscreen;
      paneFsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        store.dispatch({ kind: "fullscreen/enter", surfaceId });
      });
      bar.appendChild(paneFsBtn);
      el.appendChild(bar);
      const termEl = document.createElement("div");
      termEl.className = "pane-term";
      el.appendChild(termEl);
      container.appendChild(el);
      const term = new Terminal(TERM_OPTS);
      const fitAddon = new FitAddon.FitAddon;
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon.WebLinksAddon);
      term.open(termEl);
      term.onData((data) => sendMsg("stdin", { surfaceId, data }));
      term.onBinary((data) => sendMsg("stdin", { surfaceId, data }));
      el.addEventListener("click", () => {
        if (store.getState().focusedSurfaceId === surfaceId)
          return;
        store.dispatch({ kind: "focus/set", surfaceId });
        term.focus();
        sendMsg("focusSurface", { surfaceId });
      });
      let lastProposed = null;
      let resizeTimer2 = null;
      const ro = new ResizeObserver(() => {
        if (resizeTimer2)
          clearTimeout(resizeTimer2);
        resizeTimer2 = setTimeout(() => {
          try {
            const dims = fitAddon.proposeDimensions();
            if (!dims || !dims.cols || !dims.rows)
              return;
            if (lastProposed && lastProposed.cols === dims.cols && lastProposed.rows === dims.rows)
              return;
            lastProposed = { cols: dims.cols, rows: dims.rows };
            sendMsg("surfaceResizeRequest", {
              surfaceId,
              cols: dims.cols,
              rows: dims.rows
            });
          } catch {}
        }, 250);
      });
      ro.observe(termEl);
      terms[surfaceId] = { term, fitAddon, el, termEl, barTitle, chipsEl };
      const meta = surf?.metadata;
      if (meta)
        renderPaneChips(chipsEl, meta);
    }
    function disposePane(surfaceId) {
      const ref = terms[surfaceId];
      if (!ref)
        return;
      try {
        ref.term.dispose();
      } catch {}
      ref.el.remove();
      delete terms[surfaceId];
    }
    function applyChips(state, prev) {
      for (const sid in terms) {
        const ref = terms[sid];
        const surf = state.surfaces[sid];
        const prevSurf = prev.surfaces[sid];
        if (surf && (surf.metadata !== prevSurf?.metadata || !prevSurf)) {
          if (surf.metadata)
            renderPaneChips(ref.chipsEl, surf.metadata);
        }
        if (surf && surf.title !== prevSurf?.title) {
          ref.barTitle.textContent = surf.title;
        }
      }
    }
    function renderPaneChips(host, meta) {
      host.innerHTML = "";
      let fg = null;
      for (let i = 0;i < meta.tree.length; i++) {
        if (meta.tree[i].pid === meta.foregroundPid) {
          fg = meta.tree[i];
          break;
        }
      }
      if (fg && meta.foregroundPid !== meta.pid && fg.command) {
        const c = document.createElement("span");
        c.className = "pane-chip chip-command";
        c.textContent = fg.command.length > 48 ? fg.command.slice(0, 47) + "…" : fg.command;
        c.title = fg.command;
        host.appendChild(c);
      }
      if (meta.cwd) {
        const parts = meta.cwd.replace(/\/+$/, "").split("/").filter((s) => s);
        const short = parts.length <= 2 ? meta.cwd.charAt(0) === "/" ? "/" + parts.join("/") : parts.join("/") : "…/" + parts.slice(-2).join("/");
        const cc = document.createElement("span");
        cc.className = "pane-chip chip-cwd";
        cc.textContent = short;
        cc.title = meta.cwd;
        host.appendChild(cc);
      }
      if (meta.git) {
        const g = meta.git;
        const dirty = g.staged + g.unstaged + g.untracked + g.conflicts + g.insertions + g.deletions > 0;
        const gc = document.createElement("span");
        gc.className = "pane-chip chip-git" + (dirty ? " dirty" : "");
        const gitPart = (cls, text) => {
          const s = document.createElement("span");
          s.className = cls;
          s.textContent = text;
          return s;
        };
        gc.appendChild(gitPart("chip-git-branch", "⎇ " + g.branch));
        if (g.ahead > 0)
          gc.appendChild(gitPart("chip-git-ahead", "↑" + g.ahead));
        if (g.behind > 0)
          gc.appendChild(gitPart("chip-git-behind", "↓" + g.behind));
        if (g.conflicts > 0)
          gc.appendChild(gitPart("chip-git-conflicts", "!" + g.conflicts));
        if (g.insertions > 0)
          gc.appendChild(gitPart("chip-git-add", "+" + g.insertions));
        if (g.deletions > 0)
          gc.appendChild(gitPart("chip-git-del", "−" + g.deletions));
        let tip = "branch: " + g.branch + (g.head ? " @ " + g.head : "");
        if (g.upstream)
          tip += `
upstream: ` + g.upstream;
        tip += `
files: ` + g.staged + " staged · " + g.unstaged + " unstaged · " + g.untracked + " untracked" + (g.conflicts ? " · " + g.conflicts + " conflicts" : "");
        if (g.insertions || g.deletions)
          tip += `
diff vs HEAD: +` + g.insertions + " -" + g.deletions;
        gc.title = tip;
        host.appendChild(gc);
      }
      const seen = {};
      for (let j = 0;j < meta.listeningPorts.length; j++) {
        const lp = meta.listeningPorts[j];
        if (seen[lp.port])
          continue;
        seen[lp.port] = true;
        const pc = document.createElement("span");
        pc.className = "pane-chip chip-port";
        pc.textContent = ":" + lp.port;
        pc.title = lp.proto + " " + lp.address + ":" + lp.port + " (pid " + lp.pid + ") — click to open";
        pc.setAttribute("role", "button");
        pc.tabIndex = 0;
        const port = lp.port;
        pc.addEventListener("click", (e) => {
          e.stopPropagation();
          window.open("http://" + location.hostname + ":" + port, "_blank");
        });
        host.appendChild(pc);
      }
    }
    function applySidebarVisibility(state) {
      sidebarEl.classList.toggle("collapsed", !state.sidebarVisible);
      document.body.classList.toggle("sidebar-open", state.sidebarVisible);
    }
    function updateWorkspaceSelect(state) {
      wsSelectEl.innerHTML = "";
      for (const ws2 of state.workspaces) {
        const opt = document.createElement("option");
        opt.value = ws2.id;
        opt.textContent = ws2.name || ws2.id;
        if (ws2.id === state.activeWorkspaceId)
          opt.selected = true;
        wsSelectEl.appendChild(opt);
      }
    }
    function renderSidebar(state) {
      const { workspaces, activeWorkspaceId, sidebar } = state;
      let html = "";
      html += '<div class="sb-section"><div class="sb-section-title">Workspaces</div>';
      if (workspaces.length === 0) {
        html += '<div class="sb-empty">No workspaces</div>';
      } else {
        workspaces.forEach((ws2, i) => {
          const active = ws2.id === activeWorkspaceId;
          const color = ws2.color || "#89b4fa";
          html += '<div class="sb-ws' + (active ? " active" : "") + '">';
          html += '<div class="sb-ws-name"><span class="sb-ws-dot" style="background:' + color + '"></span>' + escapeHtml(ws2.name || "Workspace " + (i + 1)) + "</div>";
          const count = ws2.surfaceIds?.length ?? 0;
          html += '<div class="sb-ws-meta">' + (active ? "Active" : "Standby") + " · " + count + " pane" + (count !== 1 ? "s" : "") + "</div>";
          const st = sidebar.status[ws2.id];
          if (st) {
            html += '<div class="sb-ws-pills">';
            for (const k in st)
              html += '<span class="sb-pill">' + escapeHtml(k) + ": " + escapeHtml(st[k].value) + "</span>";
            html += "</div>";
          }
          const pr = sidebar.progress[ws2.id];
          if (pr) {
            html += '<div class="sb-progress"><div class="sb-progress-bar" style="width:' + Math.min(100, Math.max(0, pr.value)) + '%"></div></div>';
          }
          html += "</div>";
        });
      }
      html += "</div>";
      if (sidebar.notifications.length > 0) {
        html += '<div class="sb-section"><div class="sb-section-title">Notifications (' + sidebar.notifications.length + ')<button class="sb-section-clear" data-action="clear-notifs">' + ICONS.close + "</button></div>";
        const notifs = sidebar.notifications.slice(-5).reverse();
        for (const n of notifs) {
          html += '<div class="sb-notif">';
          html += '<div class="sb-notif-title">' + escapeHtml(n.title) + "</div>";
          if (n.body)
            html += '<div class="sb-notif-body">' + escapeHtml(n.body) + "</div>";
          html += "</div>";
        }
        html += "</div>";
      }
      if (sidebar.logs.length > 0) {
        html += '<div class="sb-section"><div class="sb-section-title">Logs (' + sidebar.logs.length + ')<button class="sb-section-clear" data-action="clear-logs">' + ICONS.close + "</button></div>";
        const logs = sidebar.logs.slice(-10).reverse();
        for (const l of logs) {
          const cls = l.level === "error" || l.level === "warning" || l.level === "success" ? " " + l.level : "";
          html += '<div class="sb-log' + cls + '">' + escapeHtml(l.message) + "</div>";
        }
        html += "</div>";
      }
      sidebarEl.innerHTML = html;
    }
    sidebarToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = !store.getState().sidebarVisible;
      store.dispatch({ kind: "sidebar/visible", visible: next });
      sendMsg("sidebarToggle", { visible: next });
    });
    sidebarEl.addEventListener("click", (e) => {
      const target = e.target;
      const btn = target.closest("[data-action]");
      if (!btn)
        return;
      const action = btn.getAttribute("data-action");
      if (action === "clear-notifs") {
        store.dispatch({ kind: "notification/clear" });
        sendMsg("clearNotifications", {});
      } else if (action === "clear-logs") {
        store.dispatch({
          kind: "sidebar/action",
          action: "__clearLogs",
          payload: {}
        });
      }
    });
    function computeRects(node, bounds) {
      const result = {};
      computeNode(node, bounds, result);
      return result;
    }
    function computeNode(node, bounds, result) {
      if (!node)
        return;
      if (node.type === "leaf") {
        result[node.surfaceId] = bounds;
        return;
      }
      const half = GAP / 2;
      if (node.direction === "horizontal") {
        const sx = bounds.x + bounds.w * node.ratio;
        computeNode(node.children[0], { x: bounds.x, y: bounds.y, w: sx - bounds.x - half, h: bounds.h }, result);
        computeNode(node.children[1], {
          x: sx + half,
          y: bounds.y,
          w: bounds.x + bounds.w - sx - half,
          h: bounds.h
        }, result);
      } else {
        const sy = bounds.y + bounds.h * node.ratio;
        computeNode(node.children[0], { x: bounds.x, y: bounds.y, w: bounds.w, h: sy - bounds.y - half }, result);
        computeNode(node.children[1], {
          x: bounds.x,
          y: sy + half,
          w: bounds.w,
          h: bounds.y + bounds.h - sy - half
        }, result);
      }
    }
    function applyMirrorScale(state) {
      const c = container;
      if (!state.nativeViewport) {
        c.style.transform = "";
        c.style.width = "";
        c.style.height = "";
        c.style.transformOrigin = "";
        c.style.left = "";
        c.style.top = "";
        c.style.right = "0";
        c.style.bottom = "0";
        return;
      }
      const sidebarW = state.sidebarVisible ? sidebarEl.offsetWidth || SIDEBAR_WIDTH : 0;
      const availW = document.documentElement.clientWidth - sidebarW;
      const availH = document.documentElement.clientHeight - TOOLBAR_HEIGHT;
      if (availW <= 0 || availH <= 0)
        return;
      const scale = Math.min(availW / state.nativeViewport.width, availH / state.nativeViewport.height);
      const scaledW = state.nativeViewport.width * scale;
      const scaledH = state.nativeViewport.height * scale;
      c.style.right = "auto";
      c.style.bottom = "auto";
      c.style.width = state.nativeViewport.width + "px";
      c.style.height = state.nativeViewport.height + "px";
      c.style.transformOrigin = "top left";
      c.style.transform = "scale(" + scale + ")";
      c.style.left = Math.round(sidebarW + (availW - scaledW) / 2) + "px";
      c.style.top = Math.round(TOOLBAR_HEIGHT + (availH - scaledH) / 2) + "px";
    }
    function applyLayout(state) {
      applyMirrorScale(state);
      const ws2 = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      if (!ws2)
        return;
      const cw = state.nativeViewport?.width ?? container.offsetWidth;
      const ch = state.nativeViewport?.height ?? container.offsetHeight;
      if (!cw || !ch)
        return;
      const rects = computeRects(ws2.layout, { x: 0, y: 0, w: cw, h: ch });
      for (const sid in rects) {
        const ref = terms[sid];
        if (!ref)
          continue;
        const r = rects[sid];
        ref.el.style.left = Math.round(r.x) + "px";
        ref.el.style.top = Math.round(r.y) + "px";
        ref.el.style.width = Math.round(r.w) + "px";
        ref.el.style.height = Math.round(r.h) + "px";
        ref.el.classList.toggle("focused", sid === state.focusedSurfaceId);
      }
      scaleTerminals(state);
    }
    function scaleTerminals(state) {
      if (!state.nativeViewport)
        return;
      requestAnimationFrame(() => {
        for (const sid in terms) {
          const ref = terms[sid];
          const xtermEl = ref.termEl.querySelector(".xterm");
          if (!xtermEl)
            continue;
          xtermEl.style.transform = "";
          const cw = ref.termEl.clientWidth;
          const ch = ref.termEl.clientHeight;
          const screen = xtermEl.querySelector(".xterm-screen");
          if (!screen || cw <= 0 || ch <= 0)
            continue;
          const sw = screen.offsetWidth;
          const sh = screen.offsetHeight;
          if (sw <= 0 || sh <= 0)
            continue;
          xtermEl.style.transformOrigin = "top left";
          xtermEl.style.transform = "scale(" + cw / sw + "," + ch / sh + ")";
        }
      });
    }
    function applyFullscreen(state, prev) {
      if (state.fullscreenSurfaceId === prev.fullscreenSurfaceId)
        return;
      document.body.classList.toggle("fullscreen-mode", state.fullscreenSurfaceId !== null);
      if (prev.fullscreenSurfaceId && terms[prev.fullscreenSurfaceId]) {
        terms[prev.fullscreenSurfaceId].el.classList.remove("fullscreen-active");
      }
      if (state.fullscreenSurfaceId && terms[state.fullscreenSurfaceId]) {
        terms[state.fullscreenSurfaceId].el.classList.add("fullscreen-active");
        try {
          terms[state.fullscreenSurfaceId].term.focus();
        } catch {}
      }
    }
    backBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      store.dispatch({ kind: "fullscreen/exit" });
    });
    fsBtn.addEventListener("click", () => {
      if (!document.fullscreenElement)
        document.documentElement.requestFullscreen().catch(() => {});
      else
        document.exitFullscreen().catch(() => {});
    });
    wsSelectEl.addEventListener("change", () => {
      const wsId = wsSelectEl.value;
      const state = store.getState();
      if (wsId && wsId !== state.activeWorkspaceId) {
        store.dispatch({ kind: "workspace/active", workspaceId: wsId });
        store.dispatch({ kind: "fullscreen/exit" });
        sendMsg("subscribeWorkspace", { workspaceId: wsId });
      }
    });
    function reconcilePanels(state) {
      for (const id in panelsDom) {
        if (!state.panels[id]) {
          panelsDom[id].el.remove();
          delete panelsDom[id];
        }
      }
      for (const id in state.panels) {
        const ps = state.panels[id];
        ensurePanelDom(id, ps);
      }
    }
    function ensurePanelDom(id, ps) {
      const existing = panelsDom[id];
      const meta = ps.meta;
      if (existing) {
        if (meta.x !== undefined)
          existing.el.style.left = meta.x + "px";
        if (meta.y !== undefined)
          existing.el.style.top = meta.y + "px";
        if (meta.width !== undefined && meta.width !== "auto")
          existing.el.style.width = meta.width + "px";
        if (meta.height !== undefined && meta.height !== "auto")
          existing.el.style.height = meta.height + "px";
        if (meta.opacity !== undefined)
          existing.el.style.opacity = String(meta.opacity);
        if (meta.data !== undefined)
          existing.contentEl.innerHTML = meta.data;
        return;
      }
      const ref = terms[ps.surfaceId];
      if (!ref)
        return;
      const isFixed = meta.position === "fixed";
      const el = document.createElement("div");
      el.className = "web-panel" + (isFixed ? " fixed" : "");
      if (meta.x !== undefined)
        el.style.left = meta.x + "px";
      if (meta.y !== undefined)
        el.style.top = meta.y + "px";
      if (meta.width !== undefined && meta.width !== "auto")
        el.style.width = meta.width + "px";
      if (meta.height !== undefined && meta.height !== "auto")
        el.style.height = meta.height + "px";
      if (meta.opacity !== undefined)
        el.style.opacity = String(meta.opacity);
      if (meta.zIndex !== undefined)
        el.style.zIndex = String(meta.zIndex);
      const draggable = isFixed ? false : meta.draggable !== undefined ? meta.draggable : meta.position === "float";
      const resizable = isFixed ? false : meta.resizable !== undefined ? meta.resizable : meta.position === "float";
      if (draggable) {
        el.classList.add("draggable");
        const dragH = document.createElement("div");
        dragH.className = "web-panel-drag";
        dragH.textContent = id;
        el.insertBefore(dragH, el.firstChild);
        setupPanelDrag(el, dragH, id, ps.surfaceId);
      }
      const contentEl = document.createElement("div");
      contentEl.className = "web-panel-content";
      el.appendChild(contentEl);
      if (resizable) {
        el.classList.add("resizable");
        const resizeH = document.createElement("div");
        resizeH.className = "web-panel-resize";
        el.appendChild(resizeH);
        setupPanelResize(el, resizeH, id, ps.surfaceId);
      }
      ref.termEl.appendChild(el);
      if (meta.interactive) {
        el.classList.add("interactive");
        setupPanelMouse(contentEl, id, ps.surfaceId);
      }
      panelsDom[id] = { el, contentEl, panelId: id };
      if (meta.data !== undefined)
        contentEl.innerHTML = meta.data;
      if (!store.getState().nativeViewport) {
        const rect = ref.termEl.getBoundingClientRect();
        const pxW = Math.round(rect.width);
        const pxH = Math.round(rect.height);
        if (pxW > 0 && pxH > 0 && ref.term) {
          sendMsg("panelMouseEvent", {
            surfaceId: ps.surfaceId,
            id: "__terminal__",
            event: "resize",
            cols: ref.term.cols,
            rows: ref.term.rows,
            pxWidth: pxW,
            pxHeight: pxH
          });
        }
      }
    }
    function txy(e) {
      const t = e.touches ? e.touches[0] || e.changedTouches[0] : e;
      return t || e;
    }
    let lastMoveTime = 0;
    function setupPanelMouse(el, panelId, surfaceId) {
      function sendXY(evtName, cx, cy, btn, btns) {
        const rect = el.getBoundingClientRect();
        sendMsg("panelMouseEvent", {
          surfaceId,
          id: panelId,
          event: evtName,
          x: Math.round(cx - rect.left),
          y: Math.round(cy - rect.top),
          button: btn,
          buttons: btns
        });
      }
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendXY("mousedown", e.clientX, e.clientY, e.button, e.buttons);
      });
      el.addEventListener("mouseup", (e) => {
        e.stopPropagation();
        sendXY("mouseup", e.clientX, e.clientY, e.button, 0);
      });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        sendXY("click", e.clientX, e.clientY, e.button, 0);
      });
      el.addEventListener("mousemove", (e) => {
        const now = Date.now();
        if (now - lastMoveTime < 16)
          return;
        lastMoveTime = now;
        sendXY("mousemove", e.clientX, e.clientY, 0, e.buttons);
      });
      el.addEventListener("mouseenter", (e) => {
        sendXY("mouseenter", e.clientX, e.clientY, 0, e.buttons);
      });
      el.addEventListener("mouseleave", (e) => {
        sendXY("mouseleave", e.clientX, e.clientY, 0, 0);
      });
      el.addEventListener("touchstart", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const t = e.touches[0];
        if (t)
          sendXY("mousedown", t.clientX, t.clientY, 0, 1);
        function onTouchMove(me) {
          me.preventDefault();
          const mt = me.touches[0];
          if (mt)
            sendXY("mousemove", mt.clientX, mt.clientY, 0, 1);
        }
        function onTouchEnd(me) {
          document.removeEventListener("touchmove", onTouchMove);
          document.removeEventListener("touchend", onTouchEnd);
          document.removeEventListener("touchcancel", onTouchEnd);
          const ct = me.changedTouches[0];
          if (ct)
            sendXY("mouseup", ct.clientX, ct.clientY, 0, 0);
        }
        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd);
        document.addEventListener("touchcancel", onTouchEnd);
      }, { passive: false });
      el.addEventListener("wheel", (e) => {
        const rect = el.getBoundingClientRect();
        sendMsg("panelMouseEvent", {
          surfaceId,
          id: panelId,
          event: "wheel",
          x: Math.round(e.clientX - rect.left),
          y: Math.round(e.clientY - rect.top),
          deltaX: Math.round(e.deltaX),
          deltaY: Math.round(e.deltaY),
          buttons: e.buttons
        });
      }, { passive: true });
    }
    function setupPanelDrag(el, handle, panelId, surfaceId) {
      function startDrag(e) {
        e.preventDefault();
        e.stopPropagation();
        const p = txy(e);
        const startX = p.clientX;
        const startY = p.clientY;
        const startLeft = parseInt(el.style.left) || 0;
        const startTop = parseInt(el.style.top) || 0;
        function onMove(me) {
          const mp = txy(me);
          el.style.left = startLeft + mp.clientX - startX + "px";
          el.style.top = startTop + mp.clientY - startY + "px";
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          document.removeEventListener("touchmove", onMove);
          document.removeEventListener("touchend", onUp);
          sendMsg("panelMouseEvent", {
            surfaceId,
            id: panelId,
            event: "dragend",
            x: parseInt(el.style.left) || 0,
            y: parseInt(el.style.top) || 0
          });
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onUp);
      }
      handle.addEventListener("mousedown", startDrag);
      handle.addEventListener("touchstart", startDrag, { passive: false });
    }
    function setupPanelResize(el, handle, panelId, surfaceId) {
      function startResize(e) {
        e.preventDefault();
        e.stopPropagation();
        const p = txy(e);
        const startX = p.clientX;
        const startY = p.clientY;
        const startW = el.offsetWidth;
        const startH = el.offsetHeight;
        function onMove(me) {
          if (me.preventDefault)
            me.preventDefault();
          const mp = txy(me);
          el.style.width = Math.max(120, startW + mp.clientX - startX) + "px";
          el.style.height = Math.max(72, startH + mp.clientY - startY) + "px";
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          document.removeEventListener("touchmove", onMove);
          document.removeEventListener("touchend", onUp);
          sendMsg("panelMouseEvent", {
            surfaceId,
            id: panelId,
            event: "resize",
            width: el.offsetWidth,
            height: el.offsetHeight
          });
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onUp);
      }
      handle.addEventListener("mousedown", startResize);
      handle.addEventListener("touchstart", startResize, { passive: false });
    }
    const contentRenderers = {};
    function registerWebRenderer(type, fn) {
      contentRenderers[type] = fn;
    }
    function decodeB64(data, isBinary) {
      if (isBinary)
        return data;
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0;i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    function decodeB64Text(data, isBinary) {
      if (isBinary)
        return new TextDecoder().decode(data);
      return atob(data);
    }
    registerWebRenderer("image", (contentEl, data, meta, isBinary) => {
      const fmtMap = {
        png: "image/png",
        jpeg: "image/jpeg",
        jpg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif"
      };
      const mime = fmtMap[meta.format || "png"] || "image/png";
      const bytes = decodeB64(data, isBinary);
      const blob = new Blob([bytes.buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      const img = contentEl.querySelector("img");
      if (img)
        img.src = url;
      else
        contentEl.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:contain">';
    });
    registerWebRenderer("svg", (contentEl, data, _meta, isBinary) => {
      contentEl.innerHTML = decodeB64Text(data, isBinary);
    });
    registerWebRenderer("html", (contentEl, data, _meta, isBinary) => {
      contentEl.innerHTML = decodeB64Text(data, isBinary);
    });
    registerWebRenderer("canvas2d", (contentEl, data, _meta, isBinary) => {
      const bytes = decodeB64(data, isBinary);
      let canvas = contentEl.querySelector("canvas");
      if (!canvas) {
        canvas = document.createElement("canvas");
        contentEl.innerHTML = "";
        contentEl.appendChild(canvas);
      }
      const blob = new Blob([bytes.buffer], { type: "image/png" });
      createImageBitmap(blob).then((bitmap) => {
        if (canvas.width !== bitmap.width)
          canvas.width = bitmap.width;
        if (canvas.height !== bitmap.height)
          canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
      });
    });
    function renderPanelData(panelId, data, isBinary) {
      const state = store.getState();
      const ps = state.panels[panelId];
      if (!ps)
        return;
      const dom = panelsDom[panelId];
      if (!dom)
        return;
      const renderer = contentRenderers[ps.meta.type];
      if (renderer)
        renderer(dom.contentEl, data, ps.meta, isBinary);
    }
    function applyGlow(state, prev) {
      const set = new Set(state.glowingSurfaceIds);
      const prevSet = new Set(prev.glowingSurfaceIds);
      for (const sid in terms) {
        const ref = terms[sid];
        const should = set.has(sid);
        const was = prevSet.has(sid);
        if (should !== was)
          ref.el.classList.toggle("notify-glow", should);
      }
    }
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      if (resizeTimer)
        clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const s = store.getState();
        if (!s.fullscreenSurfaceId)
          applyLayout(s);
        scaleTerminals(s);
      }, 100);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && store.getState().fullscreenSurfaceId) {
        store.dispatch({ kind: "fullscreen/exit" });
      }
    });
    function escapeHtml(s) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    connect();
  }
})();
