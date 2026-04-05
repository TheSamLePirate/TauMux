#!/usr/bin/env python3
"""Interactive HTML panel with clickable buttons.

Usage: python3 scripts/demo_interactive.py
Click buttons in the panel — events print to stdout. Ctrl+C to stop.
"""

import signal
import sys

from hyperterm import ht

if not ht.available:
    print("Not running inside HyperTerm Canvas.")
    sys.exit(0)

HTML = """
<div style="padding:16px;font-family:sans-serif;color:#cdd6f4;background:#1e1e2e;height:100%;">
  <h3 style="margin:0 0 12px;color:#89b4fa;font-size:15px;">Interactive Panel</h3>
  <p style="margin:0 0 16px;font-size:12px;color:#6c7086;">Click any button below</p>
  <div style="display:flex;flex-wrap:wrap;gap:8px;">
    <button style="padding:8px 16px;background:#a6e3a1;color:#1e1e2e;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;" data-action="green">Green</button>
    <button style="padding:8px 16px;background:#f38ba8;color:#1e1e2e;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;" data-action="red">Red</button>
    <button style="padding:8px 16px;background:#89b4fa;color:#1e1e2e;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;" data-action="blue">Blue</button>
    <button style="padding:8px 16px;background:#f9e2af;color:#1e1e2e;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;" data-action="yellow">Yellow</button>
  </div>
  <div style="margin-top:16px;padding:12px;background:#313244;border-radius:6px;font-size:11px;color:#6c7086;">
    Events are sent to fd5 and printed in the terminal below.
  </div>
</div>
"""

panel_id = ht.show_html(
    HTML,
    x=80,
    y=60,
    width=340,
    height=240,
    interactive=True,
)

print(f"Interactive panel created: {panel_id}")
print("Click buttons in the panel — events appear here.\n")

click_count = 0


def cleanup(*_):
    ht.clear(panel_id)
    print(f"\nPanel closed. Total clicks: {click_count}")
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)

for event in ht.events():
    if event.get("id") != panel_id:
        continue
    if event["event"] == "close":
        cleanup()
    if event["event"] == "click":
        click_count += 1
        print(
            f"  [{click_count}] Click at ({event.get('x', '?')}, {event.get('y', '?')})"
        )
