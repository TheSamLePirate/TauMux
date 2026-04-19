#!/usr/bin/env bun
/**
 * Demo: inline panel that scrolls with terminal content.
 * Run inside τ-mux: bun scripts/test_inline.ts
 */

const META_FD = process.env["HYPERTERM_META_FD"]
  ? parseInt(process.env["HYPERTERM_META_FD"])
  : null;
const DATA_FD = process.env["HYPERTERM_DATA_FD"]
  ? parseInt(process.env["HYPERTERM_DATA_FD"])
  : null;

const hasHyperTerm = META_FD !== null && DATA_FD !== null;

if (!hasHyperTerm) {
  console.log("This demo requires τ-mux (run inside the terminal).");
  process.exit(0);
}

function writeMeta(meta: Record<string, unknown>) {
  try {
    const line = JSON.stringify(meta) + "\n";
    Bun.write(Bun.file(META_FD!), new TextEncoder().encode(line));
  } catch {
    // fd write failed
  }
}

function writeData(str: string) {
  try {
    Bun.write(Bun.file(DATA_FD!), new TextEncoder().encode(str));
  } catch {
    // fd write failed
  }
}

// Print some initial lines
console.log("=== Inline Panel Demo ===");
console.log("This panel is anchored to the terminal row where it was created.");
console.log("Scroll down to see it move with the content.\n");

// Create an inline SVG panel anchored at the current cursor position
const svg = `<svg width="300" height="80" xmlns="http://www.w3.org/2000/svg">
  <rect width="300" height="80" rx="6" fill="rgba(30,30,46,0.85)"/>
  <rect x="1" y="1" width="298" height="78" rx="6" fill="none" stroke="#89b4fa" stroke-width="1" opacity="0.5"/>
  <text x="150" y="30" text-anchor="middle" fill="#cdd6f4" font-size="14" font-family="sans-serif">Inline Panel</text>
  <text x="150" y="52" text-anchor="middle" fill="#a6e3a1" font-size="11" font-family="sans-serif">I scroll with the terminal content</text>
  <text x="150" y="70" text-anchor="middle" fill="#6c7086" font-size="10" font-family="monospace">anchor: cursor</text>
</svg>`;

const svgBytes = new TextEncoder().encode(svg);

writeMeta({
  id: "inline-demo",
  type: "svg",
  position: "inline",
  anchor: "cursor",
  x: 20,
  width: 320,
  height: 100,
  draggable: false,
  resizable: false,
  byteLength: svgBytes.byteLength,
});
writeData(svg);

console.log("[panel created at current cursor row]");
console.log("");

// Now print lots of lines to push the panel up — it should scroll with them
await Bun.sleep(1000);

for (let i = 1; i <= 40; i++) {
  console.log(
    `Line ${i} — the inline panel above should scroll with this text`,
  );
  await Bun.sleep(100);
}

console.log("\n=== Done! Scroll up to find the inline panel. ===");
console.log(
  "It should be right where it was created, scrolling with the content.",
);

// Keep alive briefly so the panel stays visible
await Bun.sleep(5000);

// Clean up
writeMeta({ id: "inline-demo", type: "clear" });
console.log("Panel cleared.");
