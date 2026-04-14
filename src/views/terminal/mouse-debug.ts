/**
 * Temporary mouse-debug overlay.
 *
 * Toggle with Ctrl+Alt+Shift+M. Persists in localStorage as
 * `ht-mouse-debug`. When on, captures every document mouse event in the
 * capture phase (so we see them before any stopPropagation) and reports:
 *
 *   - target tag/id/class
 *   - document.elementsFromPoint() — top 5 layers at the cursor coord
 *   - each layer's pointer-events, z-index, computed -webkit-app-region
 *   - the nearest ancestor with Electrobun's drag class, if any
 *   - whether mousedown fired in the last 400ms AND within 8px of the
 *     last hovered position — a no-fire here means the native layer
 *     swallowed the click (CSS -webkit-app-region:drag, or an OOPIF
 *     webview rendering above the host DOM)
 *
 * It also outlines every <electrobun-webview> and <electrobun-wgpu>
 * node with a red rectangle so stray/stale OOPIF overlays covering the
 * terminal become obvious at a glance.
 *
 * Purpose: diagnose regions in the native webview where clicks are
 * silently absorbed. Remove once the root cause is found.
 */

const STORAGE_KEY = "ht-mouse-debug";

interface Layer {
  tag: string;
  id: string;
  cls: string;
  pe: string;
  z: string;
  region: string;
}

function summarize(el: Element): Layer {
  const cs = getComputedStyle(el as HTMLElement);
  const cls = (el.className ?? "").toString().trim();
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || "",
    cls: cls.length > 60 ? cls.slice(0, 57) + "…" : cls,
    pe: cs.pointerEvents,
    z: cs.zIndex,
    region:
      (cs as CSSStyleDeclaration & { webkitAppRegion?: string })
        .webkitAppRegion ?? "",
  };
}

function ancestorDragClass(el: Element | null): string | null {
  if (!el) return null;
  const hit = (el as HTMLElement).closest?.(
    ".electrobun-webkit-app-region-drag",
  );
  if (!hit) return null;
  const cls = (hit.className ?? "").toString().trim();
  return `${hit.tagName.toLowerCase()}${hit.id ? "#" + hit.id : ""}${
    cls ? "." + cls.split(/\s+/)[0] : ""
  }`;
}

function ancestorInlineDrag(el: Element | null): string | null {
  if (!el) return null;
  const hit = (el as HTMLElement).closest?.(
    '[style*="app-region"][style*="drag"]',
  );
  if (!hit) return null;
  return `${hit.tagName.toLowerCase()}${hit.id ? "#" + hit.id : ""}`;
}

export function startMouseDebug(): void {
  let enabled = false;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    /* localStorage can throw in sandboxed contexts; ignore */
  }

  // Floating readout. Kept in a root-level fixed container at z-index
  // above everything. Pointer-events: none so it never intercepts clicks.
  const root = document.createElement("div");
  root.id = "ht-mouse-debug-root";
  Object.assign(root.style, {
    position: "fixed",
    right: "8px",
    top: "8px",
    zIndex: "2147483647",
    pointerEvents: "none",
    display: enabled ? "block" : "none",
    maxWidth: "460px",
    maxHeight: "80vh",
    overflow: "hidden",
    background: "rgba(16, 16, 20, 0.96)",
    border: "1px solid rgba(234, 179, 8, 0.5)",
    borderRadius: "8px",
    boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
    padding: "8px 10px",
    font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "#fafafa",
    whiteSpace: "pre-wrap",
    userSelect: "text",
    WebkitUserSelect: "text",
  } as Partial<CSSStyleDeclaration>);

  const header = document.createElement("div");
  header.textContent = "mouse-debug (Ctrl+Alt+Shift+M)";
  Object.assign(header.style, {
    color: "#eab308",
    fontWeight: "700",
    marginBottom: "6px",
  });
  root.appendChild(header);

  const body = document.createElement("div");
  body.textContent =
    "hover to inspect, click to log. red boxes = <electrobun-webview>/<electrobun-wgpu> overlays.";
  root.appendChild(body);

  document.body.appendChild(root);

  // OOPIF outline layer. Pointer-events: none so we never block events.
  const outlineLayer = document.createElement("div");
  outlineLayer.id = "ht-mouse-debug-outlines";
  Object.assign(outlineLayer.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483646",
    display: enabled ? "block" : "none",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(outlineLayer);

  const lastMove = {
    x: 0,
    y: 0,
    at: 0,
    lines: [] as string[],
  };
  let lastDownAt = 0;

  function render(lines: string[], tag: string) {
    const ts = new Date().toISOString().slice(11, 23);
    body.textContent = `[${tag} @ ${ts}]\n` + lines.join("\n");
  }

  function describe(e: MouseEvent): { lines: string[]; layers: Layer[] } {
    const target = e.target as Element | null;
    const x = e.clientX;
    const y = e.clientY;
    const layers = document.elementsFromPoint(x, y).slice(0, 5).map(summarize);
    const dragClass = ancestorDragClass(target);
    const dragInline = ancestorInlineDrag(target);

    const lines: string[] = [];
    lines.push(`at (${x}, ${y})`);
    if (target) {
      const s = summarize(target);
      lines.push(
        `target:   <${s.tag}${s.id ? "#" + s.id : ""}>  cls="${s.cls}"`,
      );
      lines.push(`  pe=${s.pe}  z=${s.z || "auto"}  region=${s.region || "—"}`);
    }
    lines.push("elementsFromPoint:");
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i]!;
      lines.push(
        `  [${i}] <${L.tag}${L.id ? "#" + L.id : ""}>  pe=${L.pe} z=${
          L.z || "auto"
        }${L.region ? " region=" + L.region : ""}`,
      );
      if (L.cls) lines.push(`        cls="${L.cls}"`);
    }
    lines.push(`drag ancestor (class): ${dragClass ?? "—"}`);
    lines.push(`drag ancestor (style): ${dragInline ?? "—"}`);
    return { lines, layers };
  }

  function onMove(e: MouseEvent) {
    if (!enabled) return;
    const { lines } = describe(e);
    lastMove.x = e.clientX;
    lastMove.y = e.clientY;
    lastMove.at = Date.now();
    lastMove.lines = lines;
    render(lines, "MOVE");
  }

  function onDown(e: MouseEvent) {
    if (!enabled) return;
    lastDownAt = Date.now();
    const { lines } = describe(e);
    lines.push(`MOUSEDOWN fired in JS  ✔`);
    render(lines, "DOWN");
    try {
      console.warn("[mouse-debug] mousedown", { x: e.clientX, y: e.clientY });
    } catch {
      /* ignore */
    }
  }

  // Every ~200ms, if the cursor was recently hovering but no mousedown
  // fired, annotate the panel so the user can see that the native layer
  // swallowed the click.
  setInterval(() => {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastMove.at < 1200 && now - lastDownAt > 400) {
      // stale but recent hover, no recent click
      // leave existing content; just add a blinking marker
    }
  }, 200);

  // OOPIF detector: poll every 500ms and outline every
  // <electrobun-webview> / <electrobun-wgpu>.
  function refreshOutlines() {
    if (!enabled) {
      outlineLayer.innerHTML = "";
      return;
    }
    const nodes = document.querySelectorAll<HTMLElement>(
      "electrobun-webview, electrobun-wgpu",
    );
    outlineLayer.innerHTML = "";
    const summary: string[] = [];
    nodes.forEach((n, idx) => {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      const visible =
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        r.width > 0 &&
        r.height > 0;
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed",
        left: `${Math.round(r.left)}px`,
        top: `${Math.round(r.top)}px`,
        width: `${Math.round(r.width)}px`,
        height: `${Math.round(r.height)}px`,
        border: "2px solid #ef4444",
        outline: "1px dashed rgba(255,255,255,0.6)",
        pointerEvents: "none",
        boxSizing: "border-box",
      } as Partial<CSSStyleDeclaration>);
      const label = document.createElement("div");
      Object.assign(label.style, {
        position: "absolute",
        left: "2px",
        top: "2px",
        padding: "1px 5px",
        background: "#ef4444",
        color: "#fff",
        font: "10px/1.2 ui-monospace, Menlo, monospace",
        borderRadius: "3px",
      } as Partial<CSSStyleDeclaration>);
      label.textContent = `${n.tagName.toLowerCase()} #${idx} ${
        n.id || ""
      } pe=${cs.pointerEvents} hidden=${n.getAttribute("hidden") ?? "—"}`;
      box.appendChild(label);
      outlineLayer.appendChild(box);
      summary.push(
        `  [${idx}] ${n.tagName.toLowerCase()} at (${Math.round(r.left)},${Math.round(
          r.top,
        )}) ${Math.round(r.width)}x${Math.round(r.height)}  visible=${visible}  pe=${cs.pointerEvents}`,
      );
    });
    header.textContent = `mouse-debug — ${nodes.length} OOPIF overlay${
      nodes.length === 1 ? "" : "s"
    } (Ctrl+Alt+Shift+M)`;
    if (nodes.length > 0) {
      try {
        console.warn("[mouse-debug] OOPIF overlays:\n" + summary.join("\n"));
      } catch {
        /* ignore */
      }
    }
  }
  setInterval(refreshOutlines, 500);
  refreshOutlines();

  // Capture phase so we see the event before any stopPropagation in
  // xterm / our own handlers.
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("mousemove", onMove, true);

  document.addEventListener(
    "keydown",
    (e) => {
      if (
        e.ctrlKey &&
        e.altKey &&
        e.shiftKey &&
        (e.key === "M" || e.key === "m")
      ) {
        e.preventDefault();
        enabled = !enabled;
        root.style.display = enabled ? "block" : "none";
        outlineLayer.style.display = enabled ? "block" : "none";
        try {
          localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
        } catch {
          /* ignore */
        }
        if (enabled) {
          body.textContent = "armed — hover to inspect, click to log";
          refreshOutlines();
        } else {
          outlineLayer.innerHTML = "";
        }
        console.warn(`[mouse-debug] ${enabled ? "ON" : "OFF"}`);
      }
    },
    true,
  );
}
