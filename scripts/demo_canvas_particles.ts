#!/usr/bin/env bun
/**
 * Real-time particle system rendered on a canvas2d panel.
 * Particles spawn from the center, drift outward with gravity, and fade out.
 * Interactive: click to spawn a burst, drag to reposition.
 *
 * Run inside HyperTerm Canvas: bun scripts/demo_canvas_particles.ts
 */

import { ht } from "./hyperterm";
import { encodePNG } from "./png";

if (!ht.available) {
  console.log("Not running inside HyperTerm Canvas. Exiting.");
  process.exit(0);
}

ht.onError((code, message, ref) => {
  console.error(
    `[hyperterm error] ${code}: ${message}${ref ? ` (ref=${ref})` : ""}`,
  );
});

// Logical (CSS) size — what the panel declares in its meta.
const PANEL_W = 400;
const PANEL_H = 300;
// Internal render size — 2× for crisp pixels on HiDPI displays. All particle
// simulation runs at this scale; the panel stretches the PNG down to logical.
const SCALE = 2;
const W = PANEL_W * SCALE;
const H = PANEL_H * SCALE;
const MAX_PARTICLES = 500;
const FPS = 24;
const PANEL_ID = "particles";

// Catppuccin Mocha palette
const COLORS = [
  [166, 227, 161], // green
  [137, 180, 250], // blue
  [249, 226, 175], // yellow
  [243, 139, 168], // red
  [203, 166, 247], // mauve
  [148, 226, 213], // teal
  [250, 179, 135], // peach
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number[];
}

const particles: Particle[] = [];
const spawnX = W / 2;
const spawnY = H / 2;

function spawn(count: number, cx: number, cy: number) {
  for (let i = 0; i < count; i++) {
    if (particles.length >= MAX_PARTICLES) break;
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.5 + Math.random() * 3) * SCALE;
    const life = 30 + Math.random() * 60;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1 * SCALE,
      life,
      maxLife: life,
      size: (2 + Math.random() * 4) * SCALE,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }
}

function tick() {
  spawn(3, spawnX, spawnY);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.03 * SCALE;
    p.life--;
    if (p.life <= 0 || p.x < -10 || p.x > W + 10 || p.y > H + 10) {
      particles.splice(i, 1);
    }
  }
}

function render(): Uint8Array {
  const pixels = new Uint8Array(W * H * 4);

  // Dark background
  for (let i = 0; i < W * H; i++) {
    pixels[i * 4] = 30;
    pixels[i * 4 + 1] = 30;
    pixels[i * 4 + 2] = 46;
    pixels[i * 4 + 3] = 255;
  }

  // Draw particles
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    const r = Math.floor(p.size);
    const ix = Math.round(p.x);
    const iy = Math.round(p.y);
    const [cr, cg, cb] = p.color;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const px = ix + dx;
        const py = iy + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const idx = (py * W + px) * 4;
        const a = alpha * (1 - Math.sqrt(dx * dx + dy * dy) / r);
        pixels[idx] = Math.min(255, pixels[idx] + cr * a);
        pixels[idx + 1] = Math.min(255, pixels[idx + 1] + cg * a);
        pixels[idx + 2] = Math.min(255, pixels[idx + 2] + cb * a);
      }
    }
  }

  return encodePNG(W, H, pixels);
}

// --- Main ---

console.log("Particle system running (click panel to burst, Ctrl+C to stop)");

// Create the panel with first frame. Panel declares logical size; the PNG
// is 2× that, so the webview scales it down for crisp rendering.
tick();
const firstPng = render();
ht.sendMeta({
  id: PANEL_ID,
  type: "canvas2d",
  position: "float",
  x: 50,
  y: 50,
  width: PANEL_W,
  height: PANEL_H + 20,
  draggable: true,
  resizable: true,
  interactive: true,
  byteLength: firstPng.byteLength,
});
ht.sendData(firstPng);

// Debounce click bursts so a trackpad "double-click" or a stuck button can't
// flood the particle array.
const CLICK_DEBOUNCE_MS = 50;
let lastClickAt = 0;

ht.onEvent((event) => {
  if (event.id !== PANEL_ID) return;
  if (
    event.event === "click" &&
    event.x !== undefined &&
    event.y !== undefined
  ) {
    const now = Date.now();
    if (now - lastClickAt < CLICK_DEBOUNCE_MS) return;
    lastClickAt = now;
    // Panel reports logical coords; scale to render space.
    spawn(40, event.x * SCALE, event.y * SCALE);
  } else if (event.event === "close") {
    clearInterval(timer);
    console.log("\nPanel closed.");
    process.exit(0);
  }
});

const timer = setInterval(() => {
  tick();
  const png = render();
  ht.update(PANEL_ID, { data: png, timeout: 20000 });
  process.stdout.write(
    `\r  particles: ${particles.length}/${MAX_PARTICLES} | png: ${(png.byteLength / 1024).toFixed(1)}KB   `,
  );
}, 1000 / FPS);

process.on("SIGINT", () => {
  clearInterval(timer);
  ht.clear(PANEL_ID);
  console.log("\nParticle system stopped.");
  process.exit(0);
});
