#!/usr/bin/env bun
/**
 * =============================================================================
 * HYPERTERM CANVAS - INTERACTIVE SHOWCASE
 * =============================================================================
 * 
 * An ultra-interactive demo of the Sideband protocol featuring:
 * 1. A simulated UI with clickable HTML buttons.
 * 2. A 60FPS fluid/particle Canvas2D simulation reacting to mouse clicks and theme toggles.
 * 3. A HUD logging live keystrokes from standard input (stdin).
 * 4. Physics-based "falling blocks" spawned via button clicks.
 * 
 * To run: bun scripts/demo_interactive_showcase.ts
 */

import { ht } from "./hyperterm";
import { encodePNG } from "./png";

declare const process: any;

// -----------------------------------------------------------------------------
// 1. SETUP & SAFETY
// -----------------------------------------------------------------------------
if (!ht.available) {
  console.error("❌ Not running inside τ-mux.");
  process.exit(1);
}

// Ensure the console is clear below so we have space
console.log("\n\n\n\n\n\n\n\n\n\n\n\n\n");

// State
const activePanels = new Set<string>();
let terminalDims = { cols: 80, rows: 24, pxWidth: 800, pxHeight: 600 };
let theme: "fire" | "ice" = "fire";
let lastKey = "None";
let lastAction = "System booted.";

// -----------------------------------------------------------------------------
// 2. STDIN KEYBOARD INTERCEPTION
// -----------------------------------------------------------------------------
// We capture raw keystrokes from the user!
if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (key: string) => {
  if (key === "\u0003" || key === "q") {
    // Ctrl-C or 'q' -> Exit
    cleanup();
  } else if (key === " ") {
    lastKey = "Space";
    lastAction = "Spawned Block from Keyboard!";
    spawnFallingBlock();
    updateHud();
  } else if (key === "\r") {
    lastKey = "Enter";
    toggleTheme();
    lastAction = "Toggled theme from Keyboard!";
    updateHud();
  } else {
    // Escape control characters for display
    lastKey = key.replace(/\u001b/g, "ESC").replace(/\r/g, "ENTER").replace(/\n/g, "ENTER");
    if (lastKey.length === 1 && lastKey.charCodeAt(0) < 32) {
      lastKey = `CTRL+${String.fromCharCode(lastKey.charCodeAt(0) + 64)}`;
    }
    updateHud();
  }
});

// -----------------------------------------------------------------------------
// 3. CONTROL PANEL (HTML)
// -----------------------------------------------------------------------------
const controlWidth = 260;
const controlHeight = 280;

function generateControlHtml() {
  const btnStyle = `
    color: #1e1e2e; padding: 12px; border-radius: 6px; font-weight: bold; text-align: center; margin-bottom: 15px; cursor: pointer; user-select: none;
  `;
  return `
    <div style="font-family: sans-serif; background: #1e1e2e; color: #cdd6f4; border: 2px solid #89b4fa; border-radius: 8px; padding: 15px; width: ${controlWidth}px; height: ${controlHeight}px; box-sizing: border-box; box-shadow: 0 10px 20px rgba(0,0,0,0.5);">
      <h3 style="margin-top: 0; color: #f9e2af; font-size: 16px; border-bottom: 1px solid #45475a; padding-bottom: 8px;">🎮 Command Center</h3>
      
      <!-- Button A: Spawn -->
      <div style="background: #a6e3a1; box-shadow: 0 4px 0 #81c89b; ${btnStyle}">
        ↓ Spawn Falling Block (Space)
      </div>
      
      <!-- Button B: Theme -->
      <div style="background: #f38ba8; box-shadow: 0 4px 0 #d96f8c; ${btnStyle}">
        ◑ Toggle Theme (Enter)
      </div>
      
      <!-- Button C: Exit -->
      <div style="background: #eba0ac; box-shadow: 0 4px 0 #d18a96; ${btnStyle}">
        ✖ Exit Showcase (Q)
      </div>
      
      <div style="font-size: 12px; color: #a6adc8; text-align: center; margin-top: 10px;">
        Drag me anywhere!
      </div>
    </div>
  `;
}

const controlId = ht.showHtml(generateControlHtml(), {
  position: "float",
  x: 30, y: 30, width: controlWidth, height: controlHeight,
  draggable: true, interactive: true, zIndex: 100
});
activePanels.add(controlId);

// Handle Clicks using coordinate mapping!
ht.onClick(controlId, (e) => {
  // We approximate the bounding boxes of the buttons based on padding and layout
  // Box padding: 15px. Header height: ~35px.
  // Btn 1 Y: 50-92
  // Btn 2 Y: 107-149
  // Btn 3 Y: 164-206
  
  if (e.x >= 15 && e.x <= controlWidth - 15) {
    if (e.y >= 50 && e.y <= 95) {
      lastAction = "Clicked: Spawn Block";
      spawnFallingBlock();
      updateHud();
    } else if (e.y >= 105 && e.y <= 150) {
      lastAction = "Clicked: Toggle Theme";
      toggleTheme();
      updateHud();
    } else if (e.y >= 160 && e.y <= 205) {
      lastAction = "Clicked: Exit";
      updateHud();
      cleanup();
    }
  }
});


// -----------------------------------------------------------------------------
// 4. PHYSICS CANVAS (Canvas2D)
// -----------------------------------------------------------------------------
const cw = 300;
const ch = 280;
const canvasPixels = new Uint8Array(cw * ch * 4);

interface Particle { x: number; y: number; vx: number; vy: number; life: number; }
const particles: Particle[] = [];

const canvasId = ht.showCanvas(new Uint8Array(cw*ch*4), { // Empty init
  position: "float",
  x: 310, y: 30, width: cw, height: ch,
  draggable: true, interactive: true, zIndex: 90
});
activePanels.add(canvasId);

// Clicking the canvas spawns a burst of particles
ht.onClick(canvasId, (e) => {
  lastAction = `Canvas Burst at ${e.x}, ${e.y}!`;
  updateHud();
  for(let i=0; i<30; i++) {
    particles.push({
      x: e.x, y: e.y,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 0.5) * 10,
      life: 1.0
    });
  }
});

function toggleTheme() {
  theme = theme === "fire" ? "ice" : "fire";
}

function renderCanvasFrame(): Uint8Array {
  // Fade background
  for (let i = 0; i < cw * ch; i++) {
    const idx = i * 4;
    canvasPixels[idx+0] = Math.max(30, canvasPixels[idx+0] - 10);
    canvasPixels[idx+1] = Math.max(30, canvasPixels[idx+1] - 10);
    canvasPixels[idx+2] = Math.max(46, canvasPixels[idx+2] - 10);
    canvasPixels[idx+3] = 255;
  }
  
  // Update & Draw Particles
  const isFire = theme === "fire";
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += 0.2; // gravity
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.02;
    
    // Bounce
    if (p.y > ch - 5) { p.y = ch - 5; p.vy *= -0.6; }
    if (p.x < 5) { p.x = 5; p.vx *= -0.6; }
    if (p.x > cw - 5) { p.x = cw - 5; p.vx *= -0.6; }
    
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const radius = 3;
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx*dx + dy*dy > radius*radius) continue;
        const nx = px + dx, ny = py + dy;
        if (nx >= 0 && nx < cw && ny >= 0 && ny < ch) {
          const idx = (ny * cw + nx) * 4;
          canvasPixels[idx+0] = isFire ? 250 : 137; // R
          canvasPixels[idx+1] = isFire ? 150 : 180; // G
          canvasPixels[idx+2] = isFire ? 50  : 250; // B
        }
      }
    }
  }
  
  // Draw Border matching theme
  const br = isFire ? 243 : 137;
  const bg = isFire ? 139 : 180;
  const bb = isFire ? 168 : 250;
  for (let x = 0; x < cw; x++) {
    const top = x * 4, bot = ((ch - 1) * cw + x) * 4;
    canvasPixels[top+0] = br; canvasPixels[top+1] = bg; canvasPixels[top+2] = bb;
    canvasPixels[bot+0] = br; canvasPixels[bot+1] = bg; canvasPixels[bot+2] = bb;
  }
  for (let y = 0; y < ch; y++) {
    const left = (y * cw) * 4, right = (y * cw + (cw - 1)) * 4;
    canvasPixels[left+0] = br; canvasPixels[left+1] = bg; canvasPixels[left+2] = bb;
    canvasPixels[right+0] = br; canvasPixels[right+1] = bg; canvasPixels[right+2] = bb;
  }
  
  return encodePNG(cw, ch, canvasPixels);
}

const canvasLoop = setInterval(() => {
  // Auto-spawn some particles
  if (Math.random() < 0.1) {
    particles.push({
      x: cw / 2, y: 20,
      vx: (Math.random() - 0.5) * 4,
      vy: 0,
      life: 1.0 + Math.random()
    });
  }
  if (activePanels.has(canvasId)) {
    ht.update(canvasId, { data: renderCanvasFrame() });
  }
}, 1000 / 30);


// -----------------------------------------------------------------------------
// 5. THE FALLING BLOCK (Dynamic physics panel)
// -----------------------------------------------------------------------------
const emojis = ["📦", "🔥", "💎", "🍔", "🚀", "👾", "💀"];

function spawnFallingBlock() {
  const emoji = emojis[Math.floor(Math.random() * emojis.length)];
  const size = 60 + Math.random() * 40;
  const startX = Math.random() * 500 + 50;
  
  const html = `
    <div style="background:#fab387; width:100%; height:100%; border-radius:12px; border:4px solid #f38ba8; display:flex; align-items:center; justify-content:center; font-size:${size/2}px; box-sizing: border-box; box-shadow: 0 10px 20px rgba(0,0,0,0.5);">
      ${emoji}
    </div>
  `;
  
  const dropId = ht.showHtml(html, {
    position: "float",
    x: startX, y: -100, width: size, height: size,
    zIndex: 1000,
    interactive: true
  });
  activePanels.add(dropId);
  
  let dropY = -100;
  let dropVy = Math.random() * 5;
  let bounces = 0;
  
  // Pop the block if clicked!
  ht.onClick(dropId, () => {
    lastAction = `Smashed ${emoji}!`;
    updateHud();
    clearInterval(interval);
    ht.clear(dropId);
    activePanels.delete(dropId);
  });
  
  const interval = setInterval(() => {
    dropVy += 1.5; // gravity
    dropY += dropVy;
    
    // Floor collision
    const floorY = terminalDims.pxHeight ? terminalDims.pxHeight - size - 20 : 600;
    if (dropY > floorY) {
      dropY = floorY;
      dropVy *= -0.7; // bounce!
      bounces++;
      if (bounces > 4 && Math.abs(dropVy) < 2) {
        // Settle
        clearInterval(interval);
        setTimeout(() => {
          ht.clear(dropId);
          activePanels.delete(dropId);
        }, 1500); // Remove after 1.5s
      }
    }
    
    if (activePanels.has(dropId)) {
      ht.update(dropId, { y: Math.round(dropY) });
    } else {
      clearInterval(interval);
    }
  }, 30);
}


// -----------------------------------------------------------------------------
// 6. HUD STATUS BAR (Fixed)
// -----------------------------------------------------------------------------
function generateHud(w: number) {
  return `
    <div style="font-family: monospace; background: rgba(17,17,27,0.9); border: 1px solid #45475a; border-radius: 8px; color: #a6adc8; padding: 12px 20px; width: ${w}px; height: 50px; box-sizing: border-box; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 -4px 10px rgba(0,0,0,0.3);">
      <div>
        <span style="color:#f38ba8; font-weight:bold;">KEYBOARD:</span> 
        <span style="background:#313244; color:#cdd6f4; padding:2px 6px; border-radius:4px;">${lastKey}</span>
      </div>
      <div style="color: #a6e3a1; font-weight: bold;">
        ${lastAction}
      </div>
      <div>
        <span style="color:#89b4fa; font-weight:bold;">THEME:</span> ${theme.toUpperCase()}
      </div>
    </div>
  `;
}

const hudId = ht.showHtml(generateHud(760), {
  position: "fixed",
  x: 20, y: 350, width: 760, height: 50, zIndex: 9999
});
activePanels.add(hudId);

function updateHud() {
  // Anchor HUD to bottom if we know the terminal pxHeight
  let newY = 350;
  let newW = 760;
  if (terminalDims.pxHeight > 100) {
    newY = terminalDims.pxHeight - 80;
    newW = Math.max(400, terminalDims.pxWidth - 40);
  }
  
  if (activePanels.has(hudId)) {
    ht.update(hudId, { data: generateHud(newW), y: newY, width: newW });
  }
}

ht.onTerminalResize((dims) => {
  terminalDims = dims;
  updateHud(); 
});


// -----------------------------------------------------------------------------
// 7. CLEANUP
// -----------------------------------------------------------------------------
ht.onError((code, message, ref) => console.error(`\n[Error] ${code}: ${message}`, ref ? `(ref: ${ref})` : ""));

const cleanup = () => {
  clearInterval(canvasLoop);
  for (const id of activePanels) {
    ht.clear(id);
  }
  activePanels.clear();
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
ht.onEvent((e) => {
  if (e.event === "close" && e.id === controlId) {
    cleanup(); // If user closes main control panel, exit
  }
});

// Fire initial HUD positioning based on stdout guess until resize triggers
terminalDims.pxHeight = process.stdout.rows * 20; 
updateHud();
