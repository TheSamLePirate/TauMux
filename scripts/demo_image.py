#!/usr/bin/env python3
"""Display an image file as a floating panel.

Usage: python3 scripts/demo_image.py <image_path>
"""

import os
import sys
from hyperterm import ht

if not ht.available:
    print("Not running inside τ-mux.")
    sys.exit(0)

ht.on_error(
    lambda code, msg, ref=None: print(
        f"[error] {code}: {msg}", file=sys.stderr
    )
)

if len(sys.argv) < 2:
    print("Usage: python3 demo_image.py <image_path>")
    sys.exit(1)

path = sys.argv[1]

# Guard against absurdly large images — the binary is read fully into memory
# before being pushed over fd4.
MAX_BYTES = 50 * 1024 * 1024
try:
    size = os.path.getsize(path)
except OSError as e:
    print(f"Cannot stat {path}: {e}", file=sys.stderr)
    sys.exit(1)
if size > MAX_BYTES:
    print(
        f"Refusing to display {path}: {size} bytes exceeds "
        f"{MAX_BYTES} byte cap.",
        file=sys.stderr,
    )
    sys.exit(1)

panel_id = ht.show_image(path, x=100, y=80, timeout=20000)
print(f"Displayed image: {path} (id={panel_id})")
print("Drag, resize, or close the panel. Press Ctrl+C to clear.")

try:
    for event in ht.events():
        if event.get("id") == panel_id:
            print(f"  Event: {event['event']}", end="")
            if "x" in event:
                print(f" x={event['x']} y={event['y']}", end="")
            if "width" in event:
                print(f" w={event['width']} h={event['height']}", end="")
            print()
            if event["event"] == "close":
                break
except KeyboardInterrupt:
    ht.clear(panel_id)
    print("\nCleared.")
