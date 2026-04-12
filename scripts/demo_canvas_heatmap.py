#!/usr/bin/env python3
"""
Real-time scrolling heatmap — renders system load as a thermal spectrogram.
Each column is a snapshot of per-core CPU usage, scrolling left over time.
Click to pause/resume. Scroll to change update speed.

Run inside HyperTerm Canvas: python3 scripts/demo_canvas_heatmap.py
"""

import struct
import zlib
import time
import os
import sys
import threading

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from hyperterm import ht

if not ht.available:
    print("Not running inside HyperTerm Canvas. Exiting.")
    sys.exit(0)

PANEL_ID = "heatmap"
CELL_W = 3
CELL_H = 12
HISTORY = 160
FPS_DEFAULT = 5

# Detect CPU count
try:
    NUM_CORES = os.cpu_count() or 4
except Exception:
    NUM_CORES = 4

W = HISTORY * CELL_W
H = NUM_CORES * CELL_H

# Thermal palette: black -> blue -> cyan -> green -> yellow -> red -> white
THERMAL = []
_stops = [
    (0.00, (30, 30, 46)),
    (0.15, (69, 71, 90)),
    (0.30, (137, 180, 250)),
    (0.45, (148, 226, 213)),
    (0.60, (166, 227, 161)),
    (0.75, (249, 226, 175)),
    (0.90, (243, 139, 168)),
    (1.00, (245, 224, 220)),
]
for i in range(256):
    t = i / 255.0
    for s in range(len(_stops) - 1):
        t0, c0 = _stops[s]
        t1, c1 = _stops[s + 1]
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0)
            r = int(c0[0] * (1 - f) + c1[0] * f)
            g = int(c0[1] * (1 - f) + c1[1] * f)
            b = int(c0[2] * (1 - f) + c1[2] * f)
            THERMAL.append((r, g, b))
            break

# Per-core CPU tracking
_prev_times = None


def get_per_core_usage():
    """Read per-core CPU usage on macOS/Linux. Returns list of 0-100 floats."""
    global _prev_times
    try:
        # Try /proc/stat (Linux)
        with open("/proc/stat") as f:
            lines = [l for l in f if l.startswith("cpu") and not l.startswith("cpu ")]
        current = []
        for line in lines[:NUM_CORES]:
            parts = list(map(int, line.split()[1:]))
            idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
            total = sum(parts)
            current.append((idle, total))
    except FileNotFoundError:
        # macOS fallback: use random-ish data based on loadavg
        try:
            load = os.getloadavg()[0]
            base = min(100, load / NUM_CORES * 100)
        except Exception:
            base = 20
        import random
        return [max(0, min(100, base + random.gauss(0, 15))) for _ in range(NUM_CORES)]

    if _prev_times is None:
        _prev_times = current
        return [0.0] * NUM_CORES

    usage = []
    for i in range(min(len(current), len(_prev_times))):
        d_idle = current[i][0] - _prev_times[i][0]
        d_total = current[i][1] - _prev_times[i][1]
        if d_total == 0:
            usage.append(0.0)
        else:
            usage.append((1.0 - d_idle / d_total) * 100)
    _prev_times = current
    # Pad if needed
    while len(usage) < NUM_CORES:
        usage.append(0.0)
    return usage[:NUM_CORES]


# History buffer: list of columns, each column is list of per-core values
history = []


def encode_png(w, h, rgba):
    """Minimal PNG encoder."""
    def _crc32(data):
        return zlib.crc32(data) & 0xFFFFFFFF

    def _chunk(ctype, data):
        c = struct.pack(">I", len(data)) + ctype + data
        return c + struct.pack(">I", _crc32(ctype + data))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw.extend(rgba[y * w * 4:(y + 1) * w * 4])
    compressed = zlib.compress(bytes(raw), 6)
    sig = b"\x89PNG\r\n\x1a\n"
    return sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", compressed) + _chunk(b"IEND", b"")


def render():
    """Render the heatmap to PNG bytes."""
    pixels = bytearray(W * H * 4)

    # Background
    for i in range(W * H):
        pixels[i * 4] = 30
        pixels[i * 4 + 1] = 30
        pixels[i * 4 + 2] = 46
        pixels[i * 4 + 3] = 255

    # Draw heatmap cells
    for col_idx, column in enumerate(history):
        x0 = col_idx * CELL_W
        for row_idx, value in enumerate(column):
            y0 = row_idx * CELL_H
            ci = max(0, min(255, int(value * 2.55)))
            r, g, b = THERMAL[ci]
            for dy in range(CELL_H - 1):
                for dx in range(CELL_W):
                    px = x0 + dx
                    py = y0 + dy
                    if 0 <= px < W and 0 <= py < H:
                        idx = (py * W + px) * 4
                        pixels[idx] = r
                        pixels[idx + 1] = g
                        pixels[idx + 2] = b

    return encode_png(W, H, bytes(pixels))


# --- Main ---

running = True
paused = False
fps = FPS_DEFAULT


def event_loop():
    global running, paused, fps
    for event in ht.events():
        if event.get("id") != PANEL_ID:
            continue
        evt = event.get("event")
        if evt == "click":
            paused = not paused
            state = "PAUSED" if paused else "RUNNING"
            print(f"\r  [{state}]" + " " * 40, end="", flush=True)
        elif evt == "wheel":
            dy = event.get("deltaY", 0)
            if dy < 0:
                fps = min(30, fps + 1)
            elif dy > 0:
                fps = max(1, fps - 1)
        elif evt == "close":
            running = False
            return


print(f"CPU Heatmap — {NUM_CORES} cores, click to pause, scroll to change speed")
print("  Ctrl+C or close the panel to stop\n")

# Prime CPU readings
get_per_core_usage()
time.sleep(0.1)

# Create panel
first_col = get_per_core_usage()
history.append(first_col)
png = render()
ht.send_meta({
    "id": PANEL_ID,
    "type": "canvas2d",
    "position": "float",
    "x": 50,
    "y": 50,
    "width": W,
    "height": H + 20,
    "draggable": True,
    "resizable": True,
    "interactive": True,
    "byteLength": len(png),
})
ht.send_data(png)

# Event loop in background
t = threading.Thread(target=event_loop, daemon=True)
t.start()

try:
    while running:
        time.sleep(1.0 / fps)
        if paused:
            continue

        column = get_per_core_usage()
        history.append(column)
        if len(history) > HISTORY:
            history.pop(0)

        png = render()
        ht.send_meta({
            "id": PANEL_ID,
            "type": "update",
            "byteLength": len(png),
        })
        ht.send_data(png)

        avg = sum(column) / len(column) if column else 0
        peak = max(column) if column else 0
        print(f"\r  avg: {avg:5.1f}% | peak: {peak:5.1f}% | fps: {fps} | cols: {len(history)}/{HISTORY}   ",
              end="", flush=True)
except KeyboardInterrupt:
    pass

ht.clear(PANEL_ID)
print("\nHeatmap stopped.")
