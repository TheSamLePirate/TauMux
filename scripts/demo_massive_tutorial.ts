#!/usr/bin/env bun
/**
 * =============================================================================
 * HYPERTERM CANVAS - SIDEBAND PROTOCOL MASTERCLASS
 * =============================================================================
 * 
 * Welcome to the Sideband Masterclass! 🎓
 * 
 * This tutorial script demonstrates every major feature of the HyperTerm Canvas 
 * Sideband protocol in a single, massive, interactive dashboard.
 * 
 * It will teach you:
 * 1. How to initialize the client and check for availability.
 * 2. How to handle system-level events (terminal resizes, protocol errors).
 * 3. Positioning strategies: `fixed`, `inline`, `float`, and `overlay`.
 * 4. Content types: `html`, `svg`, and `canvas2d`.
 * 5. Interactivity: Handling `onClick`, `onWheel`, and raw coordinate mapping.
 * 6. Live updates: Animating SVGs and rendering raw RGBA buffers to Canvas.
 * 7. Best practices: Graceful shutdown and memory cleanup on exit.
 * 
 * 🏃‍♂️ TO RUN:
 * Open a HyperTerm Canvas pane and run:
 *   bun scripts/demo_massive_tutorial.ts
 * =============================================================================
 */

import { ht } from "./hyperterm";
import { encodePNG } from "./png";

declare const process: any;

// =============================================================================
// CHAPTER 1: INITIALIZATION & SAFETY CHECKS
// =============================================================================
// The sideband protocol relies on specific file descriptors (3, 4, 5) 
// injected by the terminal emulator at spawn time. If we aren't in HyperTerm,
// we must gracefully exit.

if (!ht.available) {
  console.error("❌ Not running inside HyperTerm Canvas.");
  console.error("Please run this script from inside a HyperTerm pane.");
  process.exit(1);
}

console.log("🚀 Starting HyperTerm Sideband Masterclass...");
console.log("📚 Read the source code of this script to see the tutorial commentary.");

// We track our active panels so we can clean them up gracefully on exit.
const activePanels = new Set<string>();

// Global State for our dashboard
let terminalDims = { cols: 80, rows: 24, pxWidth: 800, pxHeight: 600 };
let clickCount = 0;
let wheelDelta = 0;

// =============================================================================
// CHAPTER 2: GLOBAL EVENT LISTENERS
// =============================================================================
// Sideband exposes a few global events that aren't tied to a specific panel.
// `__system__` fires errors, and `__terminal__` fires when the pane resizes.
// It is a BEST PRACTICE to always listen to `onError` to catch protocol faults.

ht.onError((code, message, ref) => {
  console.error(`\n[Sideband Error] ${code}: ${message}`, ref ? `(Panel ID: ${ref})` : "");
});

ht.onTerminalResize((dims) => {
  // Update our global state
  terminalDims = dims;
  
  // We can use this event to re-render or re-position elements that depend
  // on the terminal's pixel dimensions.
  updateHud(); 
});


// =============================================================================
// CHAPTER 3: FIXED HUD (Position: fixed, Content: html)
// =============================================================================
// `fixed` position anchors the panel to the viewport window coordinates,
// exactly like CSS `position: fixed`. It ignores text scrolling entirely.
// We'll use this for a non-interactive Status Header.

function generateHudHtml(): string {
  return `
    <div style="
      font-family: system-ui, sans-serif;
      background: rgba(30, 30, 46, 0.85); /* Catppuccin Base */
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      color: #cdd6f4; /* Catppuccin Text */
      padding: 12px 20px;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 50px;
      width: 100%;
      box-sizing: border-box;
      user-select: none;
    ">
      <div>
        <strong style="color: #89b4fa; font-size: 16px;">🎓 Masterclass HUD</strong>
        <span style="font-size: 12px; color: #a6adc8; margin-left: 10px;">(Fixed HTML)</span>
      </div>
      <div style="font-family: monospace; font-size: 13px; color: #f38ba8;">
        Terminal: ${terminalDims.cols}x${terminalDims.rows} (${terminalDims.pxWidth}x${terminalDims.pxHeight}px)
      </div>
    </div>
  `;
}

// Show the panel!
const hudId = ht.showHtml(generateHudHtml(), {
  position: "fixed",
  x: 20,              // 20px from the left of the viewport
  y: 20,              // 20px from the top of the viewport
  width: "auto",      // Let the content dictate width (or we could specify pixels)
  height: 50,
  interactive: false, // HUD doesn't need to capture mouse events
  zIndex: 9999,       // Keep it above everything
});
activePanels.add(hudId);

// We'll expose an update function so the terminal resize event can refresh it.
function updateHud() {
  if (activePanels.has(hudId)) {
    // `ht.update` patches the panel properties. 
    // Passing `data: string` for HTML/SVG replaces the content entirely.
    ht.update(hudId, { data: generateHudHtml() });
  }
}


// =============================================================================
// CHAPTER 4: INLINE SVG PLOT (Position: inline, Content: svg)
// =============================================================================
// `inline` position anchors the panel to a specific terminal row. By default, 
// it uses `anchor: "cursor"`, meaning it spawns right where the terminal 
// cursor currently is. When you scroll the text, the panel scrolls with it!

console.log("\n\n📊 Generating an inline SVG animated plot below this line...");
console.log("   (Scroll up and down to see it follow the text buffer!)\n\n\n\n\n\n");

function generateSvgPlot(v1: number, v2: number, v3: number): string {
  // A simple SVG bar chart
  return `
    <svg width="350" height="120" xmlns="http://www.w3.org/2000/svg">
      <rect width="350" height="120" rx="8" fill="#181825" stroke="#313244"/>
      <text x="15" y="25" fill="#a6adc8" font-family="sans-serif" font-size="12">Live System Metrics (Anchored Inline)</text>
      
      <!-- Bar 1 -->
      <rect x="15" y="45" width="${v1}" height="14" rx="4" fill="#f38ba8" />
      <text x="${v1 + 25}" y="57" fill="#f38ba8" font-family="monospace" font-size="12">${Math.round(v1)}</text>
      
      <!-- Bar 2 -->
      <rect x="15" y="65" width="${v2}" height="14" rx="4" fill="#a6e3a1" />
      <text x="${v2 + 25}" y="77" fill="#a6e3a1" font-family="monospace" font-size="12">${Math.round(v2)}</text>
      
      <!-- Bar 3 -->
      <rect x="15" y="85" width="${v3}" height="14" rx="4" fill="#89b4fa" />
      <text x="${v3 + 25}" y="97" fill="#89b4fa" font-family="monospace" font-size="12">${Math.round(v3)}</text>
    </svg>
  `;
}

// Spawn the inline panel
const plotId = ht.showSvg(generateSvgPlot(100, 150, 200), {
  position: "inline",
  anchor: "cursor",   // Attach to the current line
  width: 350,
  height: 120,
  interactive: false, // We'll make the floating panel interactive instead
});
activePanels.add(plotId);

// Animate the SVG every 100ms
let timeOffset = 0;
const plotInterval = setInterval(() => {
  timeOffset += 0.1;
  const val1 = 100 + Math.sin(timeOffset) * 80;
  const val2 = 100 + Math.cos(timeOffset * 1.5) * 60;
  const val3 = 150 + Math.sin(timeOffset * 0.5) * 100;
  
  if (activePanels.has(plotId)) {
    ht.update(plotId, { data: generateSvgPlot(val1, val2, val3) });
  }
}, 100);


// =============================================================================
// CHAPTER 5: INTERACTIVE FLOATING PALETTE (Position: float, Content: html)
// =============================================================================
// `float` panels exist at absolute pixel coordinates relative to the pane's 
// top-left corner. They are perfect for floating toolbars. We'll make this 
// one `draggable` and `interactive`.

function generateControlHtml(): string {
  return `
    <div style="
      background: #11111b;
      border: 2px solid #cba6f7;
      border-radius: 12px;
      color: #cdd6f4;
      font-family: sans-serif;
      padding: 16px;
      height: 200px;
      width: 250px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      user-select: none;
      cursor: crosshair;
    ">
      <div style="font-weight: bold; padding-bottom: 8px; border-bottom: 1px dashed #45475a; cursor: grab;">
        🎛️ Control Panel (Float)
      </div>
      <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
        <p style="font-size: 13px; color: #a6adc8;">Click me!<br/>Scroll over me!<br/>Drag my header!</p>
      </div>
      <div style="font-size: 12px; color: #f9e2af; margin-top: 8px;">
        Clicks: ${clickCount} | Wheel: ${wheelDelta.toFixed(0)}
      </div>
    </div>
  `;
}

const controlId = ht.showHtml(generateControlHtml(), {
  position: "float",
  x: 400,
  y: 150,
  width: 250,
  height: 200,
  draggable: true,      // The user can drag it around the pane!
  interactive: true,    // Send pointer/wheel events to fd 5
  zIndex: 100,
});
activePanels.add(controlId);

// -----------------------------------------------------------------------------
// EVENT BINDING
// -----------------------------------------------------------------------------
// Because `interactive: true` is set, we can listen for user actions.

// 1. Clicks
ht.onClick(controlId, (e) => {
  clickCount++;
  console.log(`🖱️ Clicked Control Panel at relative coords: (${e.x}, ${e.y})`);
  ht.update(controlId, { data: generateControlHtml() });
});

// 2. Wheel (Scroll)
ht.onWheel(controlId, (e) => {
  wheelDelta += e.deltaY;
  ht.update(controlId, { data: generateControlHtml() });
});

// 3. Dragging (fires on dragend)
ht.onDrag(controlId, (e) => {
  console.log(`✋ Control Panel was dragged to new absolute coords: (${e.x}, ${e.y})`);
});


// =============================================================================
// CHAPTER 6: HIGH-PERFORMANCE CANVAS2D (Position: overlay, Content: canvas2d)
// =============================================================================
// `canvas2d` receives raw PNG bytes, decodes them via `createImageBitmap`, 
// and paints them. It's much faster for pixel-manipulation than pushing SVGs.
// We'll create a bouncing square animation.

const cw = 200;
const ch = 200;
const canvasPixels = new Uint8Array(cw * ch * 4);

let boxX = 20;
let boxY = 20;
let boxVx = 4;
let boxVy = 3.5;

function renderCanvasFrame(): Uint8Array {
  // Clear to dark transparent background
  for (let i = 0; i < cw * ch; i++) {
    canvasPixels[i * 4 + 0] = 30;  // R
    canvasPixels[i * 4 + 1] = 30;  // G
    canvasPixels[i * 4 + 2] = 46;  // B
    canvasPixels[i * 4 + 3] = 200; // Alpha
  }

  // Physics update
  boxX += boxVx;
  boxY += boxVy;
  const size = 30;
  
  if (boxX < 0 || boxX + size > cw) boxVx *= -1;
  if (boxY < 0 || boxY + size > ch) boxVy *= -1;

  // Draw the bouncing box
  const r = 166, g = 227, b = 161; // Catppuccin Green
  
  const ix = Math.floor(boxX);
  const iy = Math.floor(boxY);

  for (let y = iy; y < iy + size; y++) {
    for (let x = ix; x < ix + size; x++) {
      if (x >= 0 && x < cw && y >= 0 && y < ch) {
        const idx = (y * cw + x) * 4;
        canvasPixels[idx + 0] = r;
        canvasPixels[idx + 1] = g;
        canvasPixels[idx + 2] = b;
        canvasPixels[idx + 3] = 255;
      }
    }
  }

  // Draw a border
  for (let x = 0; x < cw; x++) {
    const topIdx = x * 4;
    const botIdx = ((ch - 1) * cw + x) * 4;
    canvasPixels[topIdx+0] = 255; canvasPixels[topIdx+3] = 255;
    canvasPixels[botIdx+0] = 255; canvasPixels[botIdx+3] = 255;
  }
  for (let y = 0; y < ch; y++) {
    const leftIdx = (y * cw) * 4;
    const rightIdx = (y * cw + (cw - 1)) * 4;
    canvasPixels[leftIdx+0] = 255; canvasPixels[leftIdx+3] = 255;
    canvasPixels[rightIdx+0] = 255; canvasPixels[rightIdx+3] = 255;
  }

  // Encode using the minimal zlib encoder provided in png.ts
  return encodePNG(cw, ch, canvasPixels);
}

// Spawn the canvas panel
const canvasId = ht.showCanvas(renderCanvasFrame(), {
  position: "overlay", // Overlays are similar to floats but intended for popups/modals
  x: 50,
  y: 200,
  width: cw,
  height: ch,
  draggable: true,
});
activePanels.add(canvasId);
console.log(`✅ Created Overlay Canvas2D (ID: ${canvasId})`);

// Animation Loop for Canvas (60 fps target)
const canvasInterval = setInterval(() => {
  if (activePanels.has(canvasId)) {
    const png = renderCanvasFrame();
    ht.update(canvasId, { data: png });
  }
}, 1000 / 60);


// =============================================================================
// CHAPTER 7: GRACEFUL SHUTDOWN & CLEANUP
// =============================================================================
// IMPORTANT: Sideband panels are intentionally persistent! If your script exits 
// without clearing them, they stay frozen on the screen. 
// Always trap SIGINT and clear your panels.

const cleanup = () => {
  console.log("\n\n🧹 Initiating Masterclass Cleanup Sequence...");
  
  // Stop background loops
  clearInterval(plotInterval);
  clearInterval(canvasInterval);
  
  // Clear all panels
  for (const id of activePanels) {
    console.log(`   Removing panel: ${id}`);
    ht.clear(id);
  }
  activePanels.clear();
  
  console.log("✨ All clear! Thank you for attending the Masterclass.");
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Also handle the user closing panels directly
ht.onEvent((e) => {
  if (e.event === "close") {
    console.log(`👋 User closed panel ${e.id} via the UI.`);
    activePanels.delete(e.id);
    
    // If all panels are closed, we can exit cleanly
    if (activePanels.size === 0) {
      console.log("All panels closed. Exiting naturally.");
      cleanup();
    }
  }
});

// =============================================================================
// The Event Loop is now running.
// Node/Bun will stay alive because of the setIntervals and event listeners!
// =============================================================================
