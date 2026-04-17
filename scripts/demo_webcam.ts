#!/usr/bin/env bun
/**
 * HyperTerm Canvas — Webcam Demo
 *
 * Streams the MacBook webcam as a floating image panel via the sideband protocol.
 * Uses ffmpeg with AVFoundation to capture JPEG frames.
 *
 * Usage:
 *   bun scripts/demo_webcam.ts                    — stream default camera (index 0)
 *   bun scripts/demo_webcam.ts --list              — list available cameras
 *   bun scripts/demo_webcam.ts --camera 1          — use camera at index 1
 *   bun scripts/demo_webcam.ts --size 1280x720     — capture resolution (default 640x480)
 *   bun scripts/demo_webcam.ts --fps 30            — capture framerate (default 30)
 *   bun scripts/demo_webcam.ts --fps-out 15        — output framerate to panel (default: same as --fps)
 */

import { HyperTerm } from "./hyperterm";

const ht = new HyperTerm();

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getFlag(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const showHelp = args.includes("--help") || args.includes("-h");
const listDevices = args.includes("--list");
const inlineMode = args.includes("--inline");
const cameraIndex = getFlag("camera", "0");
const size = getFlag("size", "640x480");
const fps = getFlag("fps", "30");
const fpsOut = parseInt(getFlag("fps-out", fps), 10);
const minFrameInterval = 1000 / fpsOut;

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

if (showHelp) {
  console.log(`demo_webcam — Stream webcam as a floating/inline panel

Usage: bun scripts/demo_webcam.ts [options]

Options:
  --help              Show this help
  --list              List available cameras and exit
  --camera <index>    Camera device index (default: 0)
  --size <WxH>        Capture resolution (default: 640x480)
  --fps <n>           Capture framerate from camera (default: 30)
  --fps-out <n>       Output framerate to panel (default: same as --fps)
                      Frames captured faster than this are dropped.
  --inline            Show as inline panel (scrolls with terminal content)
                      Default is a floating draggable panel.

Examples:
  bun scripts/demo_webcam.ts                        # default camera, floating
  bun scripts/demo_webcam.ts --inline               # inline, scrolls with content
  bun scripts/demo_webcam.ts --camera 1 --fps 15    # second camera, 15fps
  bun scripts/demo_webcam.ts --size 1280x720        # HD resolution
  bun scripts/demo_webcam.ts --fps 30 --fps-out 10  # capture 30, send 10`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// List devices mode (works without HyperTerm so users can discover cameras
// from any shell).
// ---------------------------------------------------------------------------

if (listDevices) {
  console.log("Listing available cameras (via ffmpeg AVFoundation)...\n");
  const proc = Bun.spawn(
    ["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
    { stderr: "pipe", stdout: "pipe" },
  );
  const stderrText = await new Response(proc.stderr).text();
  await proc.exited;

  const lines = stderrText.split("\n");
  let inVideo = false;
  for (const line of lines) {
    if (line.includes("AVFoundation video devices:")) {
      inVideo = true;
      console.log("Video devices:");
      continue;
    }
    if (line.includes("AVFoundation audio devices:")) break;
    if (inVideo && line.includes("]")) {
      const match = line.match(/\[(\d+)\]\s+(.+)/);
      if (match) {
        console.log(`  ${match[1]}: ${match[2]}`);
      }
    }
  }
  console.log("\nUsage: bun scripts/demo_webcam.ts --camera <index>");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Availability check — must come before ffmpeg spawn so we don't burn a
// camera activation + AVFoundation permission prompt outside HyperTerm.
// ---------------------------------------------------------------------------

if (!ht.available) {
  console.log(
    "This script requires HyperTerm Canvas.\n" +
      "Run it inside the HyperTerm terminal emulator.\n" +
      "Use --list to see available cameras.",
  );
  process.exit(0);
}

ht.onError((code, message) => {
  console.error(`[demo_webcam] sideband error — ${code}: ${message}`);
});

// ---------------------------------------------------------------------------
// JPEG frame extraction from MJPEG stream
// ---------------------------------------------------------------------------

function findJpegStart(buf: Uint8Array, start: number): number {
  for (let i = start; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8) return i;
  }
  return -1;
}

function findJpegEnd(buf: Uint8Array, start: number): number {
  for (let i = start + 2; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd9) return i + 2;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [width, height] = size.split("x").map(Number);

console.log(
  `Webcam streaming — camera ${cameraIndex}, ${size} @ ${fps}fps capture, ${fpsOut}fps output, ${inlineMode ? "inline" : "floating"}`,
);
console.log("Press Ctrl+C to stop.\n");

// Spawn ffmpeg
const ffmpeg = Bun.spawn(
  [
    "ffmpeg",
    "-f",
    "avfoundation",
    "-framerate",
    fps,
    "-video_size",
    size,
    "-i",
    `${cameraIndex}:none`,
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "-q:v",
    "5",
    "-an",
    "pipe:1",
  ],
  { stdout: "pipe", stderr: "pipe" },
);

// Capture stderr fully. On an early ffmpeg exit (camera permission denied,
// device busy, missing framework, etc.) we replay the tail so the failure
// is visible instead of silently printing "Done" with zero frames.
const stderrBuf: string[] = [];
(async () => {
  const r = ffmpeg.stderr.getReader();
  const d = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await r.read();
      if (done) break;
      const t = d.decode(value, { stream: true });
      stderrBuf.push(t);
      // Keep last ~8 KB so a chatty log doesn't balloon.
      let total = stderrBuf.reduce((n, s) => n + s.length, 0);
      while (total > 8192 && stderrBuf.length > 1) {
        total -= stderrBuf.shift()!.length;
      }
      // Surface obvious failures live.
      if (/error|permission|denied|not authorized|unable/i.test(t)) {
        process.stderr.write(t);
      }
    }
  } catch {
    /* stream ended */
  }
})();

// ---------------------------------------------------------------------------
// Frame pipeline: extract → latest-frame buffer → timed sender
// ---------------------------------------------------------------------------

let latestFrame: Uint8Array | null = null; // always holds the most recent complete JPEG
let panelId: string | null = null;
let sentCount = 0;
let capturedCount = 0;
let droppedCount = 0;
const startTime = Date.now();

// Timed sender: pushes the latest frame at the output framerate. Using the
// HyperTerm class means meta + binary writes are sequenced by the lib's
// single `sendMeta` → `sendData` path; the old raw-fd version (pre-upgrade)
// could interleave writes across frames at high FPS and produce visually
// garbled frames.
let sending = false;
const sendTimer = setInterval(() => {
  if (!latestFrame || sending) return;
  sending = true;
  const frame = latestFrame;
  latestFrame = null; // consume it

  try {
    if (panelId === null) {
      // showImage() is file-path-based; here we have bytes in hand, so
      // emit the meta + binary ourselves via the library's primitives.
      // Using the library ensures the write ordering matches everything
      // else (meta line, then binary on fd4).
      const id = `webcam-${Date.now().toString(36)}`;
      const meta: Record<string, unknown> = inlineMode
        ? {
            id,
            type: "image",
            format: "jpeg",
            position: "inline",
            anchor: "cursor",
            x: 12,
            width: width + 20,
            height: height + 40,
            draggable: false,
            resizable: false,
            timeout: 30000,
            byteLength: frame.byteLength,
          }
        : {
            id,
            type: "image",
            format: "jpeg",
            position: "float",
            x: 50,
            y: 30,
            width: width + 20,
            height: height + 40,
            draggable: true,
            resizable: true,
            timeout: 30000,
            byteLength: frame.byteLength,
          };
      ht.sendMeta(meta);
      ht.sendData(frame);
      panelId = id;
    } else {
      ht.update(panelId, { data: frame, timeout: 30000 });
    }
    sentCount++;
  } finally {
    sending = false;
  }

  // Log stats periodically
  if (sentCount > 0 && sentCount % 30 === 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    process.stdout.write(
      `\rCapture: ${capturedCount} (${(capturedCount / elapsed).toFixed(1)}fps)  ` +
        `Sent: ${sentCount} (${(sentCount / elapsed).toFixed(1)}fps)  ` +
        `Dropped: ${droppedCount}  `,
    );
  }
}, minFrameInterval);

// Reader: extract JPEG frames from ffmpeg stdout into latestFrame
const reader = ffmpeg.stdout.getReader();
let buffer = new Uint8Array(0);

try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    // Append to buffer (reuse when possible)
    if (buffer.length === 0) {
      buffer = value;
    } else {
      const newBuf = new Uint8Array(buffer.length + value.length);
      newBuf.set(buffer);
      newBuf.set(value, buffer.length);
      buffer = newBuf;
    }

    // Extract all complete JPEG frames, keep only the last one
    let lastCompleteFrame: Uint8Array | null = null;
    let framesInChunk = 0;

    while (true) {
      const soi = findJpegStart(buffer, 0);
      if (soi === -1) {
        buffer = new Uint8Array(0);
        break;
      }
      if (soi > 0) buffer = buffer.slice(soi); // trim garbage before SOI

      const eoi = findJpegEnd(buffer, 0);
      if (eoi === -1) break; // incomplete frame

      lastCompleteFrame = buffer.slice(0, eoi);
      buffer = buffer.slice(eoi);
      framesInChunk++;
      capturedCount++;
    }

    if (lastCompleteFrame) {
      if (framesInChunk > 1) droppedCount += framesInChunk - 1;
      latestFrame = lastCompleteFrame;
    }
  }
} catch {
  /* stream ended */
}

clearInterval(sendTimer);
const elapsed = (Date.now() - startTime) / 1000;
console.log(
  `\nDone. Captured: ${capturedCount}  Sent: ${sentCount}  Dropped: ${droppedCount}  ` +
    `(${elapsed.toFixed(1)}s, ${(sentCount / elapsed).toFixed(1)} fps output)`,
);

// If ffmpeg exited without producing frames, replay the stderr tail so the
// real failure reason (camera permission, device busy, …) is visible.
if (capturedCount === 0) {
  console.error("\n[demo_webcam] ffmpeg produced no frames. stderr tail:");
  console.error(stderrBuf.join("").slice(-2000));
  console.error(
    "\nHints: run `bun scripts/demo_webcam.ts --list` to verify the camera " +
      "index, and make sure the app running HyperTerm Canvas has been granted " +
      "Camera access in System Settings → Privacy & Security → Camera.",
  );
}

// Cleanup — kill ffmpeg on any exit path so the camera LED goes off.
let ffmpegKilled = false;
function killFfmpeg(): void {
  if (ffmpegKilled) return;
  ffmpegKilled = true;
  try {
    ffmpeg.kill();
  } catch {
    /* already gone */
  }
}

process.on("SIGINT", () => {
  clearInterval(sendTimer);
  killFfmpeg();
  if (panelId) ht.clear(panelId);
  console.log("\nWebcam stopped.");
  process.exit(0);
});

process.on("exit", killFfmpeg);

ffmpeg.exited.then(() => {
  clearInterval(sendTimer);
  if (panelId) ht.clear(panelId);
});
