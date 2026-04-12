#!/usr/bin/env python3
"""
Interactive Mandelbrot set explorer rendered on a canvas2d panel.
Click anywhere on the fractal to zoom in at that point.
Scroll to zoom in/out. Drag to reposition the panel.

Run inside HyperTerm Canvas: python3 scripts/demo_canvas_mandelbrot.py
"""

import struct
import zlib
import time
import sys
import threading

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from hyperterm import ht

if not ht.available:
    print("Not running inside HyperTerm Canvas. Exiting.")
    sys.exit(0)

W, H = 320, 240
PANEL_ID = "mandelbrot"
MAX_ITER = 80

# View state
cx, cy = -0.5, 0.0  # center of view in complex plane
zoom = 1.0  # 1.0 = full set visible


# Catppuccin-inspired palette
def make_palette(n):
    colors = [
        (30, 30, 46),      # base (inside set)
        (137, 180, 250),   # blue
        (166, 227, 161),   # green
        (249, 226, 175),   # yellow
        (250, 179, 135),   # peach
        (243, 139, 168),   # red
        (203, 166, 247),   # mauve
        (148, 226, 213),   # teal
        (245, 224, 220),   # rosewater
    ]
    palette = []
    segs = len(colors) - 1
    for i in range(n):
        t = (i / n) * segs
        idx = min(int(t), segs - 1)
        frac = t - idx
        r = int(colors[idx][0] * (1 - frac) + colors[idx + 1][0] * frac)
        g = int(colors[idx][1] * (1 - frac) + colors[idx + 1][1] * frac)
        b = int(colors[idx][2] * (1 - frac) + colors[idx + 1][2] * frac)
        palette.append((r, g, b))
    return palette


PALETTE = make_palette(MAX_ITER)


def compute_mandelbrot():
    """Compute the Mandelbrot set for the current view and return RGBA pixels."""
    pixels = bytearray(W * H * 4)
    scale = 3.0 / zoom
    x0 = cx - scale / 2
    y0 = cy - scale * H / W / 2
    dx = scale / W
    dy = scale * H / W / H

    for py in range(H):
        ci = y0 + py * dy
        for px in range(W):
            cr = x0 + px * dx
            zr, zi = 0.0, 0.0
            iteration = 0
            while zr * zr + zi * zi <= 4.0 and iteration < MAX_ITER:
                zr, zi = zr * zr - zi * zi + cr, 2.0 * zr * zi + ci
                iteration += 1

            idx = (py * W + px) * 4
            if iteration == MAX_ITER:
                # Inside the set
                pixels[idx] = 30
                pixels[idx + 1] = 30
                pixels[idx + 2] = 46
            else:
                r, g, b = PALETTE[iteration % MAX_ITER]
                pixels[idx] = r
                pixels[idx + 1] = g
                pixels[idx + 2] = b
            pixels[idx + 3] = 255

    return bytes(pixels)


def encode_png(w, h, rgba):
    """Minimal PNG encoder — no dependencies."""
    def _crc32(data):
        return zlib.crc32(data) & 0xFFFFFFFF

    def _chunk(ctype, data):
        c = struct.pack(">I", len(data)) + ctype + data
        return c + struct.pack(">I", _crc32(ctype + data))

    # IHDR
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)

    # IDAT — build raw scanlines with filter byte 0
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter: none
        row_start = y * w * 4
        raw.extend(rgba[row_start:row_start + w * 4])

    compressed = zlib.compress(bytes(raw), 6)

    sig = b"\x89PNG\r\n\x1a\n"
    return sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", compressed) + _chunk(b"IEND", b"")


def render_and_send(first=False):
    """Compute, encode, and send the frame."""
    t0 = time.time()
    pixels = compute_mandelbrot()
    t1 = time.time()
    png = encode_png(W, H, pixels)
    t2 = time.time()

    if first:
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
    else:
        ht.send_meta({
            "id": PANEL_ID,
            "type": "update",
            "byteLength": len(png),
        })
    ht.send_data(png)

    compute_ms = (t1 - t0) * 1000
    encode_ms = (t2 - t1) * 1000
    print(f"\r  zoom: {zoom:.1f}x | center: ({cx:.6f}, {cy:.6f}) | "
          f"compute: {compute_ms:.0f}ms | encode: {encode_ms:.0f}ms   ", end="", flush=True)


# --- Event handling ---

running = True


def event_loop():
    global cx, cy, zoom, running
    for event in ht.events():
        if event.get("id") != PANEL_ID:
            continue
        evt = event.get("event")
        if evt == "click":
            # Click to zoom in at that point
            ex, ey = event.get("x", W // 2), event.get("y", H // 2)
            scale = 3.0 / zoom
            cx = cx - scale / 2 + (ex / W) * scale
            cy = cy - scale * H / W / 2 + (ey / H) * scale * H / W
            zoom *= 2.0
            render_and_send()
        elif evt == "wheel":
            dy = event.get("deltaY", 0)
            if dy < 0:
                zoom *= 1.3
            elif dy > 0:
                zoom = max(0.5, zoom / 1.3)
            render_and_send()
        elif evt == "close":
            running = False
            return


# --- Main ---

print("Mandelbrot explorer — click to zoom in, scroll to zoom in/out")
print("  Ctrl+C or close the panel to stop\n")

render_and_send(first=True)

# Run event loop in background thread
t = threading.Thread(target=event_loop, daemon=True)
t.start()

try:
    while running:
        time.sleep(0.1)
except KeyboardInterrupt:
    pass

ht.clear(PANEL_ID)
print("\nMandelbrot explorer stopped.")
