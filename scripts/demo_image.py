#!/usr/bin/env python3
"""Display an image file as a floating panel.

Usage: python3 scripts/demo_image.py <image_path>
"""

import sys
from hyperterm import ht

if not ht.available:
    print("Not running inside HyperTerm Canvas.")
    sys.exit(0)

if len(sys.argv) < 2:
    print("Usage: python3 demo_image.py <image_path>")
    sys.exit(1)

path = sys.argv[1]
panel_id = ht.show_image(path, x=100, y=80)
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
