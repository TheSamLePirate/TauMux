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

const META_FD = process.env["HYPERTERM_META_FD"]
  ? parseInt(process.env["HYPERTERM_META_FD"])
  : null;
const DATA_FD = process.env["HYPERTERM_DATA_FD"]
  ? parseInt(process.env["HYPERTERM_DATA_FD"])
  : null;

const hasHyperTerm = META_FD !== null && DATA_FD !== null;
const encoder = new TextEncoder();

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
// List devices mode
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
// Sideband helpers
// ---------------------------------------------------------------------------

if (!hasHyperTerm) {
  console.log(
    "This script requires HyperTerm Canvas.\n" +
      "Run it inside the HyperTerm terminal emulator.\n" +
      "Use --list to see available cameras.",
  );
  process.exit(0);
}

function writeMeta(meta: Record<string, unknown>): void {
  try {
    Bun.write(Bun.file(META_FD!), encoder.encode(JSON.stringify(meta) + "\n"));
  } catch {
    /* fd write failed */
  }
}

function writeData(data: Uint8Array): void {
  try {
    Bun.write(Bun.file(DATA_FD!), data);
  } catch {
    /* fd write failed */
  }
}

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

const PANEL_ID = "webcam";
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

// Drain stderr (non-blocking, only show errors)
(async () => {
  const r = ffmpeg.stderr.getReader();
  const d = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await r.read();
      if (done) break;
      const t = d.decode(value, { stream: true });
      if (t.includes("Error") || t.includes("error")) process.stderr.write(t);
    }
  } catch {
    /* stream ended */
  }
})();

// ---------------------------------------------------------------------------
// Frame pipeline: extract → latest-frame buffer → timed sender
// ---------------------------------------------------------------------------

let latestFrame: Uint8Array | null = null; // always holds the most recent complete JPEG
let sentCount = 0;
let capturedCount = 0;
let droppedCount = 0;
let firstFrame = true;
const startTime = Date.now();

// Timed sender: sends the latest frame at the output framerate
let sending = false;
const sendTimer = setInterval(() => {
  if (!latestFrame || sending) return;
  sending = true;
  const frame = latestFrame;
  latestFrame = null; // consume it

  if (firstFrame) {
    writeMeta(
      inlineMode
        ? {
            id: PANEL_ID,
            type: "image",
            format: "jpeg",
            position: "inline",
            anchor: "cursor",
            x: 12,
            width: width + 20,
            height: height + 40,
            draggable: false,
            resizable: false,
            byteLength: frame.byteLength,
          }
        : {
            id: PANEL_ID,
            type: "image",
            format: "jpeg",
            position: "float",
            x: 50,
            y: 30,
            width: width + 20,
            height: height + 40,
            draggable: true,
            resizable: true,
            byteLength: frame.byteLength,
          },
    );
    firstFrame = false;
  } else {
    writeMeta({
      id: PANEL_ID,
      type: "update",
      byteLength: frame.byteLength,
    });
  }
  writeData(frame);
  sentCount++;
  sending = false;

  // Log stats periodically
  if (sentCount % 30 === 0) {
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

    // Only keep the latest frame (drop intermediate ones from this chunk)
    if (lastCompleteFrame) {
      if (latestFrame) droppedCount += framesInChunk - 1;
      else droppedCount += framesInChunk - 1;
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

// Cleanup
process.on("SIGINT", () => {
  clearInterval(sendTimer);
  ffmpeg.kill();
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\nWebcam stopped.");
  process.exit(0);
});

ffmpeg.exited.then(() => {
  clearInterval(sendTimer);
  writeMeta({ id: PANEL_ID, type: "clear" });
});
