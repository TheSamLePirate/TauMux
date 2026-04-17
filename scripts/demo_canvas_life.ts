#!/usr/bin/env bun
/**
 * Conway's Game of Life — interactive canvas2d simulation.
 * Click cells to toggle them. The simulation runs continuously.
 * Starts with a random soup.
 *
 * Run inside HyperTerm Canvas: bun scripts/demo_canvas_life.ts
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

const CELL = 4;
const COLS = 100;
const ROWS = 75;
const W = COLS * CELL;
const H = ROWS * CELL;
const FPS = 15;
const PANEL_ID = "life";

const BG: [number, number, number] = [30, 30, 46];
const ALIVE: [number, number, number] = [166, 227, 161];
const GRID: [number, number, number] = [49, 50, 68];

let grid = new Uint8Array(COLS * ROWS);

function randomize(density = 0.3) {
  for (let i = 0; i < grid.length; i++) {
    grid[i] = Math.random() < density ? 1 : 0;
  }
}

function step() {
  const next = new Uint8Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          // Toroidal wrap: edges connect to opposite edges (no boundary deaths).
          const nx = (x + dx + COLS) % COLS;
          const ny = (y + dy + ROWS) % ROWS;
          neighbors += grid[ny * COLS + nx];
        }
      }
      const alive = grid[y * COLS + x];
      if (alive) {
        next[y * COLS + x] = neighbors === 2 || neighbors === 3 ? 1 : 0;
      } else {
        next[y * COLS + x] = neighbors === 3 ? 1 : 0;
      }
    }
  }
  grid = next;
}

function render(): Uint8Array {
  const pixels = new Uint8Array(W * H * 4);

  for (let i = 0; i < W * H; i++) {
    pixels[i * 4] = BG[0];
    pixels[i * 4 + 1] = BG[1];
    pixels[i * 4 + 2] = BG[2];
    pixels[i * 4 + 3] = 255;
  }

  // Grid lines
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x % CELL === 0 || y % CELL === 0) {
        const idx = (y * W + x) * 4;
        pixels[idx] = GRID[0];
        pixels[idx + 1] = GRID[1];
        pixels[idx + 2] = GRID[2];
      }
    }
  }

  // Alive cells
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      if (!grid[cy * COLS + cx]) continue;
      const px0 = cx * CELL + 1;
      const py0 = cy * CELL + 1;
      for (let dy = 0; dy < CELL - 1; dy++) {
        for (let dx = 0; dx < CELL - 1; dx++) {
          const idx = ((py0 + dy) * W + (px0 + dx)) * 4;
          pixels[idx] = ALIVE[0];
          pixels[idx + 1] = ALIVE[1];
          pixels[idx + 2] = ALIVE[2];
        }
      }
    }
  }

  return encodePNG(W, H, pixels);
}

// --- Main ---

console.log("Game of Life — click to toggle cells, Ctrl+C to stop");
console.log(`  ${COLS}x${ROWS} grid, ${FPS} fps`);

randomize();

const firstPng = render();
ht.sendMeta({
  id: PANEL_ID,
  type: "canvas2d",
  position: "float",
  x: 50,
  y: 50,
  width: W,
  height: H + 20,
  draggable: true,
  resizable: true,
  interactive: true,
  byteLength: firstPng.byteLength,
});
ht.sendData(firstPng);

let generation = 0;
// Skip frames while the previous step+render is still in flight — on a slow
// machine the timer can fire faster than the PNG encode + IPC round-trip.
let rendering = false;

ht.onEvent((event) => {
  if (event.id !== PANEL_ID) return;
  if (
    event.event === "click" &&
    event.x !== undefined &&
    event.y !== undefined
  ) {
    const cx = Math.floor(event.x / CELL);
    const cy = Math.floor(event.y / CELL);
    if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
      grid[cy * COLS + cx] ^= 1;
    }
  } else if (event.event === "close") {
    clearInterval(timer);
    console.log(`\nStopped at generation ${generation}.`);
    process.exit(0);
  }
});

const timer = setInterval(() => {
  if (rendering) return;
  rendering = true;
  try {
    step();
    generation++;

    const png = render();
    ht.update(PANEL_ID, { data: png, timeout: 20000 });

    const alive = grid.reduce((s, v) => s + v, 0);
    process.stdout.write(
      `\r  gen: ${generation} | alive: ${alive}/${COLS * ROWS} | png: ${(png.byteLength / 1024).toFixed(1)}KB   `,
    );
  } finally {
    rendering = false;
  }
}, 1000 / FPS);

process.on("SIGINT", () => {
  clearInterval(timer);
  ht.clear(PANEL_ID);
  console.log(`\nGame of Life stopped at generation ${generation}.`);
  process.exit(0);
});
