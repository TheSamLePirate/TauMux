#!/usr/bin/env bun
/**
 * HyperTerm Canvas — Drawing App
 *
 * A fully-featured Paint-style drawing application that renders as an
 * interactive HTML panel via the sideband protocol. All interactivity is
 * driven from the Bun process — the HTML panel is re-rendered on every
 * state change.
 *
 * Usage:
 *   bun scripts/demo_draw.ts             — floating draggable panel
 *   bun scripts/demo_draw.ts --fullpane  — large fixed panel
 */

// ---------------------------------------------------------------------------
// Environment / fd setup
// ---------------------------------------------------------------------------

const META_FD = process.env["HYPERTERM_META_FD"]
  ? parseInt(process.env["HYPERTERM_META_FD"])
  : null;
const DATA_FD = process.env["HYPERTERM_DATA_FD"]
  ? parseInt(process.env["HYPERTERM_DATA_FD"])
  : null;
const EVENT_FD = process.env["HYPERTERM_EVENT_FD"]
  ? parseInt(process.env["HYPERTERM_EVENT_FD"])
  : null;

const hasHyperTerm = META_FD !== null && DATA_FD !== null;

if (!hasHyperTerm) {
  console.log(
    "This script requires HyperTerm Canvas.\n" +
      "Run it inside the HyperTerm terminal emulator.",
  );
  process.exit(0);
}

const fullPane = process.argv.includes("--fullpane");
const PANEL_ID = "draw";

// ---------------------------------------------------------------------------
// Low-level fd helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function writeMeta(meta: Record<string, unknown>): void {
  try {
    Bun.write(Bun.file(META_FD!), encoder.encode(JSON.stringify(meta) + "\n"));
  } catch {
    /* fd write failed */
  }
}

function writeData(str: string): void {
  try {
    Bun.write(Bun.file(DATA_FD!), encoder.encode(str));
  } catch {
    /* fd write failed */
  }
}

// ---------------------------------------------------------------------------
// Catppuccin Mocha palette
// ---------------------------------------------------------------------------

const C = {
  base: "#1e1e2e",
  surface0: "#313244",
  surface1: "#45475a",
  overlay0: "#6c7086",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  red: "#f38ba8",
  green: "#a6e3a1",
  blue: "#89b4fa",
  yellow: "#f9e2af",
  pink: "#f5c2e7",
  teal: "#94e2d5",
  peach: "#fab387",
  mauve: "#cba6f7",
  white: "#ffffff",
  black: "#000000",
} as const;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type Tool = "pen" | "line" | "rect" | "circle" | "eraser" | "fill" | "text";

const TOOLS: { name: Tool; label: string; icon: string }[] = [
  { name: "pen", label: "Pen", icon: "&#9998;" },
  { name: "line", label: "Line", icon: "&#9585;" },
  { name: "rect", label: "Rect", icon: "&#9633;" },
  { name: "circle", label: "Circle", icon: "&#9675;" },
  { name: "eraser", label: "Eraser", icon: "&#9003;" },
  { name: "fill", label: "Fill", icon: "&#9781;" },
  { name: "text", label: "Text", icon: "T" },
];

// ---------------------------------------------------------------------------
// Color / size options
// ---------------------------------------------------------------------------

const PALETTE_COLORS = [
  C.black,
  C.white,
  C.red,
  C.green,
  C.blue,
  C.yellow,
  C.pink,
  C.teal,
  C.peach,
  C.mauve,
  C.overlay0,
  C.surface0,
];

const BRUSH_SIZES = [2, 4, 8, 14, 24];

// ---------------------------------------------------------------------------
// Layout constants (px) — used for hit-testing
// ---------------------------------------------------------------------------

const TOOLBAR_H = 40;
const ACTION_BAR_H = 34;
const PALETTE_W = 52;
const STATUS_H = 26;

// Panel dimensions (updated by resize events)
let panelW = fullPane ? 1100 : 900;
let panelH = fullPane ? 750 : 650;
let panelX = fullPane ? 20 : 50;
let panelY = fullPane ? 10 : 30;

// Derived: canvas area within the panel
function canvasX0(): number {
  return PALETTE_W;
}
function canvasY0(): number {
  return TOOLBAR_H + ACTION_BAR_H;
}
function canvasW(): number {
  return Math.max(10, panelW - PALETTE_W);
}
function canvasH(): number {
  return Math.max(10, panelH - TOOLBAR_H - ACTION_BAR_H - STATUS_H);
}

// ---------------------------------------------------------------------------
// Drawing state
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

interface PenStroke {
  kind: "pen" | "eraser";
  color: string;
  size: number;
  points: Point[];
}

interface LineShape {
  kind: "line";
  color: string;
  size: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface RectShape {
  kind: "rect";
  color: string;
  size: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CircleShape {
  kind: "circle";
  color: string;
  size: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface FillShape {
  kind: "fill";
  color: string;
}

interface TextShape {
  kind: "text";
  color: string;
  size: number;
  x: number;
  y: number;
  content: string;
}

type Shape =
  | PenStroke
  | LineShape
  | RectShape
  | CircleShape
  | FillShape
  | TextShape;

// State
let currentTool: Tool = "pen";
let currentColor: string = C.white;
let currentSize: number = 4;

const shapes: Shape[] = [];
const redoStack: Shape[] = [];

// In-progress drawing
let drawing = false;
let drawStart: Point | null = null;
let currentPoints: Point[] = [];
let previewEnd: Point | null = null;

// Text placement
let textPending = false;
let textCounter = 0;

// Throttle
let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 16; // ~60fps cap
let renderQueued = false;

// ---------------------------------------------------------------------------
// Hit testing helpers
// ---------------------------------------------------------------------------

interface HitResult {
  area: "toolbar" | "actionbar" | "palette" | "canvas" | "status" | "none";
  toolIndex?: number;
  actionIndex?: number;
  colorIndex?: number;
  sizeIndex?: number;
  canvasPoint?: Point;
}

function hitTest(x: number, y: number): HitResult {
  // Toolbar row (tools)
  if (y < TOOLBAR_H) {
    const toolBtnW = 70;
    const toolBtnGap = 4;
    const toolStartX = 8;
    for (let i = 0; i < TOOLS.length; i++) {
      const bx = toolStartX + i * (toolBtnW + toolBtnGap);
      if (x >= bx && x < bx + toolBtnW) {
        return { area: "toolbar", toolIndex: i };
      }
    }
    return { area: "toolbar" };
  }

  // Action bar (undo, redo, clear)
  if (y < TOOLBAR_H + ACTION_BAR_H) {
    const actionBtnW = 64;
    const actionBtnGap = 4;
    const actionStartX = PALETTE_W + 8;
    for (let i = 0; i < 3; i++) {
      const bx = actionStartX + i * (actionBtnW + actionBtnGap);
      if (x >= bx && x < bx + actionBtnW) {
        return { area: "actionbar", actionIndex: i };
      }
    }
    return { area: "actionbar" };
  }

  // Palette (left column)
  if (x < PALETTE_W) {
    const swatchSize = 20;
    const swatchGap = 4;
    const swatchStartY = TOOLBAR_H + ACTION_BAR_H + 8;
    const cols = 2;

    // Color swatches
    for (let i = 0; i < PALETTE_COLORS.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const sx = 6 + col * (swatchSize + swatchGap);
      const sy = swatchStartY + row * (swatchSize + swatchGap);
      if (x >= sx && x < sx + swatchSize && y >= sy && y < sy + swatchSize) {
        return { area: "palette", colorIndex: i };
      }
    }

    // Brush sizes (below colors)
    const sizeStartY =
      swatchStartY +
      Math.ceil(PALETTE_COLORS.length / cols) * (swatchSize + swatchGap) +
      12;
    for (let i = 0; i < BRUSH_SIZES.length; i++) {
      const sy = sizeStartY + i * 28;
      if (y >= sy && y < sy + 24 && x >= 4 && x < PALETTE_W - 4) {
        return { area: "palette", sizeIndex: i };
      }
    }

    return { area: "palette" };
  }

  // Status bar
  if (y >= panelH - STATUS_H) {
    return { area: "status" };
  }

  // Canvas area
  const cx = x - canvasX0();
  const cy = y - canvasY0();
  if (cx >= 0 && cy >= 0 && cx < canvasW() && cy < canvasH()) {
    return { area: "canvas", canvasPoint: { x: cx, y: cy } };
  }

  return { area: "none" };
}

// ---------------------------------------------------------------------------
// SVG rendering for shapes
// ---------------------------------------------------------------------------

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderShape(shape: Shape): string {
  switch (shape.kind) {
    case "pen":
    case "eraser": {
      if (shape.points.length === 0) return "";
      if (shape.points.length === 1) {
        const p = shape.points[0];
        return `<circle cx="${p.x}" cy="${p.y}" r="${shape.size / 2}" fill="${shape.color}"/>`;
      }
      const d = shape.points
        .map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
        .join(" ");
      return `<path d="${d}" stroke="${shape.color}" stroke-width="${shape.size}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
    }
    case "line":
      return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${shape.color}" stroke-width="${shape.size}" stroke-linecap="round"/>`;
    case "rect": {
      const rx = Math.min(shape.x, shape.x + shape.w);
      const ry = Math.min(shape.y, shape.y + shape.h);
      const rw = Math.abs(shape.w);
      const rh = Math.abs(shape.h);
      return `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" stroke="${shape.color}" stroke-width="${shape.size}" fill="none"/>`;
    }
    case "circle":
      return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${Math.abs(shape.rx)}" ry="${Math.abs(shape.ry)}" stroke="${shape.color}" stroke-width="${shape.size}" fill="none"/>`;
    case "fill":
      return `<rect x="0" y="0" width="${canvasW()}" height="${canvasH()}" fill="${shape.color}"/>`;
    case "text":
      return `<text x="${shape.x}" y="${shape.y}" fill="${shape.color}" font-size="${Math.max(12, shape.size * 3)}" font-family="sans-serif">${escapeAttr(shape.content)}</text>`;
  }
}

function renderPreview(): string {
  if (!drawing || !drawStart || !previewEnd) return "";

  const color = currentColor;
  const size = currentSize;

  switch (currentTool) {
    case "line":
      return `<line x1="${drawStart.x}" y1="${drawStart.y}" x2="${previewEnd.x}" y2="${previewEnd.y}" stroke="${color}" stroke-width="${size}" stroke-linecap="round" opacity="0.6" stroke-dasharray="4,4"/>`;
    case "rect": {
      const w = previewEnd.x - drawStart.x;
      const h = previewEnd.y - drawStart.y;
      const rx = Math.min(drawStart.x, drawStart.x + w);
      const ry = Math.min(drawStart.y, drawStart.y + h);
      return `<rect x="${rx}" y="${ry}" width="${Math.abs(w)}" height="${Math.abs(h)}" stroke="${color}" stroke-width="${size}" fill="none" opacity="0.6" stroke-dasharray="4,4"/>`;
    }
    case "circle": {
      const rx = Math.abs(previewEnd.x - drawStart.x);
      const ry = Math.abs(previewEnd.y - drawStart.y);
      return `<ellipse cx="${drawStart.x}" cy="${drawStart.y}" rx="${rx}" ry="${ry}" stroke="${color}" stroke-width="${size}" fill="none" opacity="0.6" stroke-dasharray="4,4"/>`;
    }
    case "pen":
    case "eraser": {
      if (currentPoints.length === 0) return "";
      const drawColor = currentTool === "eraser" ? C.base : color;
      if (currentPoints.length === 1) {
        const p = currentPoints[0];
        return `<circle cx="${p.x}" cy="${p.y}" r="${size / 2}" fill="${drawColor}" opacity="0.7"/>`;
      }
      const d = currentPoints
        .map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
        .join(" ");
      return `<path d="${d}" stroke="${drawColor}" stroke-width="${size}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.7"/>`;
    }
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Full HTML rendering
// ---------------------------------------------------------------------------

function renderHtml(): string {
  const cw = canvasW();
  const ch = canvasH();

  // Tool buttons
  const toolButtons = TOOLS.map((t, _i) => {
    const active = currentTool === t.name;
    const bg = active ? C.blue : C.surface1;
    const fg = active ? C.base : C.text;
    return `<div style="display:inline-flex;align-items:center;justify-content:center;gap:4px;width:66px;height:28px;background:${bg};color:${fg};border-radius:5px;font-size:12px;font-weight:${active ? 700 : 500};cursor:pointer;user-select:none;flex-shrink:0;">${t.icon} ${t.label}</div>`;
  }).join("");

  // Action buttons
  const actions = [
    { label: "&#8617; Undo", enabled: shapes.length > 0 },
    { label: "&#8618; Redo", enabled: redoStack.length > 0 },
    { label: "&#10005; Clear", enabled: shapes.length > 0 },
  ];
  const actionButtons = actions
    .map((a) => {
      const bg = a.enabled ? C.surface1 : C.surface0;
      const fg = a.enabled ? C.text : C.overlay0;
      return `<div style="display:inline-flex;align-items:center;justify-content:center;width:60px;height:24px;background:${bg};color:${fg};border-radius:4px;font-size:11px;cursor:pointer;user-select:none;flex-shrink:0;">${a.label}</div>`;
    })
    .join("");

  // Color swatches
  const swatchSize = 20;
  const swatchGap = 4;
  const cols = 2;
  const colorSwatches = PALETTE_COLORS.map((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const sx = 6 + col * (swatchSize + swatchGap);
    const sy = 8 + row * (swatchSize + swatchGap);
    const border =
      c === currentColor
        ? `2px solid ${C.blue}`
        : c === C.black
          ? `1px solid ${C.overlay0}`
          : "1px solid transparent";
    return `<div style="position:absolute;left:${sx}px;top:${sy}px;width:${swatchSize}px;height:${swatchSize}px;background:${c};border:${border};border-radius:3px;cursor:pointer;box-sizing:border-box;"></div>`;
  }).join("");

  // Brush sizes
  const colorRows = Math.ceil(PALETTE_COLORS.length / cols);
  const sizeStartY = 8 + colorRows * (swatchSize + swatchGap) + 12;
  const sizeButtons = BRUSH_SIZES.map((s, i) => {
    const sy = sizeStartY + i * 28;
    const active = s === currentSize;
    const bg = active ? C.surface1 : "transparent";
    const dotR = Math.min(s, 10);
    return `<div style="position:absolute;left:4px;top:${sy}px;width:${PALETTE_W - 8}px;height:24px;background:${bg};border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
      <svg width="${PALETTE_W - 12}" height="20"><circle cx="${(PALETTE_W - 12) / 2}" cy="10" r="${dotR / 2 + 1}" fill="${active ? C.blue : C.subtext0}"/></svg>
    </div>`;
  }).join("");

  // SVG shapes
  const allShapes = shapes.map(renderShape).join("\n");
  const preview = renderPreview();

  // Canvas background — checkerboard for transparency indication
  const canvasBg = `<rect width="${cw}" height="${ch}" fill="${C.base}"/>`;

  // Crosshair cursor indicator
  const cursorStyle = textPending
    ? "cursor:text;"
    : currentTool === "eraser"
      ? "cursor:crosshair;"
      : "cursor:crosshair;";

  // Status text
  const toolLabel =
    TOOLS.find((t) => t.name === currentTool)?.label ?? currentTool;
  const statusText = textPending
    ? "Click on canvas to place text"
    : `${toolLabel} | ${currentColor} | Size: ${currentSize} | Shapes: ${shapes.length}`;

  return `<div style="width:${panelW}px;height:${panelH}px;background:${C.base};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;display:flex;flex-direction:column;user-select:none;">
  <!-- Toolbar -->
  <div style="height:${TOOLBAR_H}px;background:${C.surface0};display:flex;align-items:center;gap:4px;padding:0 8px;flex-shrink:0;border-bottom:1px solid ${C.surface1};">
    ${toolButtons}
  </div>

  <!-- Main area -->
  <div style="display:flex;flex:1;min-height:0;">
    <!-- Palette -->
    <div style="width:${PALETTE_W}px;background:${C.surface0};border-right:1px solid ${C.surface1};position:relative;flex-shrink:0;overflow:hidden;">
      ${colorSwatches}
      ${sizeButtons}
    </div>

    <!-- Canvas + action bar -->
    <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
      <!-- Action bar -->
      <div style="height:${ACTION_BAR_H}px;background:${C.surface0};display:flex;align-items:center;gap:4px;padding:0 8px;flex-shrink:0;border-bottom:1px solid ${C.surface1};">
        ${actionButtons}
        <div style="flex:1;"></div>
        <div style="font-size:10px;color:${C.overlay0};margin-right:4px;">${cw}x${ch}</div>
      </div>

      <!-- SVG Canvas -->
      <div style="flex:1;overflow:hidden;${cursorStyle}">
        <svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}" style="display:block;">
          ${canvasBg}
          ${allShapes}
          ${preview}
        </svg>
      </div>
    </div>
  </div>

  <!-- Status bar -->
  <div style="height:${STATUS_H}px;background:${C.surface0};display:flex;align-items:center;padding:0 10px;flex-shrink:0;border-top:1px solid ${C.surface1};">
    <span style="font-size:11px;color:${C.subtext0};">${statusText}</span>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Rendering / update
// ---------------------------------------------------------------------------

let firstRender = true;

function render(force = false): void {
  const now = Date.now();
  if (!force && now - lastRenderTime < MIN_RENDER_INTERVAL) {
    if (!renderQueued) {
      renderQueued = true;
      setTimeout(
        () => {
          renderQueued = false;
          render(true);
        },
        MIN_RENDER_INTERVAL - (now - lastRenderTime),
      );
    }
    return;
  }

  lastRenderTime = now;
  const html = renderHtml();
  const bytes = encoder.encode(html);

  if (firstRender) {
    writeMeta({
      id: PANEL_ID,
      type: "html",
      position: fullPane ? "float" : "float",
      x: panelX,
      y: panelY,
      width: panelW,
      height: panelH,
      interactive: true,
      draggable: !fullPane,
      resizable: true,
      byteLength: bytes.byteLength,
    });
    firstRender = false;
  } else {
    writeMeta({
      id: PANEL_ID,
      type: "update",
      byteLength: bytes.byteLength,
    });
  }

  writeData(html);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function undo(): void {
  if (shapes.length === 0) return;
  redoStack.push(shapes.pop()!);
  render(true);
}

function redo(): void {
  if (redoStack.length === 0) return;
  shapes.push(redoStack.pop()!);
  render(true);
}

function clearCanvas(): void {
  if (shapes.length === 0) return;
  // Push all shapes onto redo so the user can get them back
  while (shapes.length > 0) {
    redoStack.push(shapes.pop()!);
  }
  render(true);
}

function finalizeStroke(): void {
  if (!drawing || !drawStart) return;

  switch (currentTool) {
    case "pen":
      if (currentPoints.length > 0) {
        shapes.push({
          kind: "pen",
          color: currentColor,
          size: currentSize,
          points: [...currentPoints],
        });
        redoStack.length = 0;
      }
      break;
    case "eraser":
      if (currentPoints.length > 0) {
        shapes.push({
          kind: "eraser",
          color: C.base,
          size: currentSize * 3,
          points: [...currentPoints],
        });
        redoStack.length = 0;
      }
      break;
    case "line":
      if (previewEnd) {
        shapes.push({
          kind: "line",
          color: currentColor,
          size: currentSize,
          x1: drawStart.x,
          y1: drawStart.y,
          x2: previewEnd.x,
          y2: previewEnd.y,
        });
        redoStack.length = 0;
      }
      break;
    case "rect":
      if (previewEnd) {
        shapes.push({
          kind: "rect",
          color: currentColor,
          size: currentSize,
          x: drawStart.x,
          y: drawStart.y,
          w: previewEnd.x - drawStart.x,
          h: previewEnd.y - drawStart.y,
        });
        redoStack.length = 0;
      }
      break;
    case "circle":
      if (previewEnd) {
        shapes.push({
          kind: "circle",
          color: currentColor,
          size: currentSize,
          cx: drawStart.x,
          cy: drawStart.y,
          rx: Math.abs(previewEnd.x - drawStart.x),
          ry: Math.abs(previewEnd.y - drawStart.y),
        });
        redoStack.length = 0;
      }
      break;
  }

  drawing = false;
  drawStart = null;
  currentPoints = [];
  previewEnd = null;
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  // Terminal resize → scale panel to match available space
  if (evtId === "__terminal__" && evtType === "resize") {
    const cols = (event["cols"] as number) ?? 0;
    const rows = (event["rows"] as number) ?? 0;
    if (cols > 0 && rows > 0) {
      // Estimate pixel dimensions from character grid (approx 8px wide, 17px tall)
      const pxW = Math.round(cols * 8);
      const pxH = Math.round(rows * 17);
      const newW = fullPane ? pxW - 40 : Math.min(panelW, pxW - 60);
      const newH = fullPane ? pxH - 20 : Math.min(panelH, pxH - 40);
      if (newW !== panelW || newH !== panelH) {
        panelW = Math.max(400, newW);
        panelH = Math.max(300, newH);
        writeMeta({
          id: PANEL_ID,
          type: "update",
          width: panelW,
          height: panelH,
        });
        render(true);
      }
    }
    return;
  }

  if (evtId !== PANEL_ID) return;

  const ex = (event["x"] as number) ?? 0;
  const ey = (event["y"] as number) ?? 0;
  switch (evtType) {
    case "close": {
      console.log("Panel closed.");
      process.exit(0);
      break;
    }

    case "dragend": {
      panelX = ex;
      panelY = ey;
      break;
    }

    case "resize": {
      const newW = (event["width"] as number) ?? panelW;
      const newH = (event["height"] as number) ?? panelH;
      if (newW !== panelW || newH !== panelH) {
        panelW = newW;
        panelH = newH;
        render(true);
      }
      break;
    }

    case "mousedown": {
      const hit = hitTest(ex, ey);

      // Tool selection
      if (hit.area === "toolbar" && hit.toolIndex !== undefined) {
        const newTool = TOOLS[hit.toolIndex].name;
        if (newTool !== currentTool) {
          currentTool = newTool;
          textPending = newTool === "text";
          render(true);
        }
        return;
      }

      // Action buttons
      if (hit.area === "actionbar" && hit.actionIndex !== undefined) {
        if (hit.actionIndex === 0) undo();
        else if (hit.actionIndex === 1) redo();
        else if (hit.actionIndex === 2) clearCanvas();
        return;
      }

      // Color selection
      if (hit.area === "palette" && hit.colorIndex !== undefined) {
        currentColor = PALETTE_COLORS[hit.colorIndex];
        render(true);
        return;
      }

      // Size selection
      if (hit.area === "palette" && hit.sizeIndex !== undefined) {
        currentSize = BRUSH_SIZES[hit.sizeIndex];
        render(true);
        return;
      }

      // Canvas interaction
      if (hit.area === "canvas" && hit.canvasPoint) {
        const cp = hit.canvasPoint;

        if (currentTool === "fill") {
          shapes.push({ kind: "fill", color: currentColor });
          redoStack.length = 0;
          render(true);
          return;
        }

        if (currentTool === "text") {
          textCounter++;
          shapes.push({
            kind: "text",
            color: currentColor,
            size: currentSize,
            x: cp.x,
            y: cp.y,
            content: `Text ${textCounter}`,
          });
          redoStack.length = 0;
          textPending = false;
          render(true);
          return;
        }

        // Start drawing
        drawing = true;
        drawStart = cp;
        previewEnd = cp;

        if (currentTool === "pen" || currentTool === "eraser") {
          currentPoints = [cp];
        }

        render();
      }
      break;
    }

    case "mousemove": {
      if (!drawing) return;

      const hit = hitTest(ex, ey);
      if (hit.area === "canvas" && hit.canvasPoint) {
        const cp = hit.canvasPoint;
        previewEnd = cp;

        if (currentTool === "pen" || currentTool === "eraser") {
          // Only add point if it moved enough (reduces point count)
          const lastPt = currentPoints[currentPoints.length - 1];
          const dx = cp.x - lastPt.x;
          const dy = cp.y - lastPt.y;
          if (dx * dx + dy * dy >= 4) {
            currentPoints.push(cp);
          }
        }

        render();
      }
      break;
    }

    case "mouseup": {
      if (drawing) {
        const hit = hitTest(ex, ey);
        if (hit.area === "canvas" && hit.canvasPoint) {
          previewEnd = hit.canvasPoint;
          if (currentTool === "pen" || currentTool === "eraser") {
            currentPoints.push(hit.canvasPoint);
          }
        }
        finalizeStroke();
        render(true);
      }
      break;
    }

    case "mouseleave": {
      // Finalize any in-progress drawing when mouse leaves
      if (drawing) {
        finalizeStroke();
        render(true);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Event loop
// ---------------------------------------------------------------------------

async function readEvents(): Promise<void> {
  if (EVENT_FD === null) return;

  try {
    const stream = Bun.file(EVENT_FD).stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          // invalid JSON — skip
        }
      }
    }
  } catch {
    // fd closed or unavailable
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log("HyperTerm Drawing App started.");
console.log(
  fullPane
    ? "Mode: full-pane (fixed position)"
    : "Mode: floating (drag title bar to move)",
);
console.log("Tools: Pen, Line, Rect, Circle, Eraser, Fill, Text");
console.log("Press Ctrl+C to exit.\n");

// Initial render
render(true);

// Start event loop
readEvents();

// Cleanup on exit
process.on("SIGINT", () => {
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\nDrawing app closed.");
  process.exit(0);
});
