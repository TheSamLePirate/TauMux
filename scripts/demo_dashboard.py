#!/usr/bin/env python3
"""Multi-panel real-time dashboard.

Usage: python3 scripts/demo_dashboard.py
Shows 3 floating panels: CPU bar, memory gauge, and a clock. Ctrl+C to stop.
"""

import os
import signal
import sys
import time

from hyperterm import ht

if not ht.available:
    print("Not running inside HyperTerm Canvas.")
    sys.exit(0)

panels = []


def cleanup(*_):
    for pid in panels:
        ht.clear(pid)
    print("\nDashboard stopped.")
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)


def get_cpu():
    """Rough CPU usage via load average."""
    load = os.getloadavg()[0]
    ncpu = os.cpu_count() or 1
    return min(100, int((load / ncpu) * 100))


def get_mem():
    """Memory usage (macOS)."""
    try:
        import subprocess

        out = subprocess.check_output(["vm_stat"], text=True)
        lines = out.strip().split("\n")
        page_size = 16384
        free = 0
        active = 0
        for line in lines[1:]:
            parts = line.split(":")
            if len(parts) < 2:
                continue
            val = int(parts[1].strip().rstrip("."))
            if "free" in parts[0]:
                free = val * page_size
            elif "active" in parts[0]:
                active = val * page_size
        total = free + active
        if total == 0:
            return 50
        return int((active / total) * 100)
    except Exception:
        return 42


def cpu_svg(usage):
    w, h = 220, 80
    bar_w = int((usage / 100) * (w - 60))
    color = "#a6e3a1" if usage < 50 else "#f9e2af" if usage < 80 else "#f38ba8"
    return f"""<svg width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="{w}" height="{h}" rx="6" fill="rgba(30,30,46,0.85)"/>
  <text x="12" y="22" fill="#cdd6f4" font-size="12" font-family="sans-serif" font-weight="600">CPU</text>
  <text x="{w-12}" y="22" text-anchor="end" fill="{color}" font-size="12" font-family="monospace">{usage}%</text>
  <rect x="12" y="34" width="{w-24}" height="16" rx="4" fill="#313244"/>
  <rect x="12" y="34" width="{bar_w}" height="16" rx="4" fill="{color}"/>
  <text x="12" y="70" fill="#6c7086" font-size="10" font-family="monospace">load: {os.getloadavg()[0]:.1f}</text>
</svg>"""


def mem_svg(usage):
    w, h = 220, 80
    bar_w = int((usage / 100) * (w - 60))
    color = "#89b4fa" if usage < 60 else "#f9e2af" if usage < 85 else "#f38ba8"
    return f"""<svg width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="{w}" height="{h}" rx="6" fill="rgba(30,30,46,0.85)"/>
  <text x="12" y="22" fill="#cdd6f4" font-size="12" font-family="sans-serif" font-weight="600">Memory</text>
  <text x="{w-12}" y="22" text-anchor="end" fill="{color}" font-size="12" font-family="monospace">{usage}%</text>
  <rect x="12" y="34" width="{w-24}" height="16" rx="4" fill="#313244"/>
  <rect x="12" y="34" width="{bar_w}" height="16" rx="4" fill="{color}"/>
</svg>"""


def clock_svg():
    w, h = 220, 80
    t = time.strftime("%H:%M:%S")
    d = time.strftime("%a %b %d")
    return f"""<svg width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="{w}" height="{h}" rx="6" fill="rgba(30,30,46,0.85)"/>
  <text x="{w//2}" y="38" text-anchor="middle" fill="#cdd6f4" font-size="28" font-family="monospace" font-weight="700">{t}</text>
  <text x="{w//2}" y="60" text-anchor="middle" fill="#6c7086" font-size="12" font-family="sans-serif">{d}</text>
</svg>"""


# Create panels
cpu_id = ht.show_svg(cpu_svg(get_cpu()), x=50, y=30, width=240, height=100)
panels.append(cpu_id)

mem_id = ht.show_svg(mem_svg(get_mem()), x=50, y=150, width=240, height=100)
panels.append(mem_id)

clock_id = ht.show_svg(clock_svg(), x=50, y=270, width=240, height=100)
panels.append(clock_id)

print("Dashboard running — 3 panels (CPU, Memory, Clock)")
print("Drag them around. Ctrl+C to stop.\n")

while True:
    time.sleep(1)

    cpu = get_cpu()
    mem = get_mem()

    ht.update(cpu_id, data=cpu_svg(cpu).encode("utf-8"))
    ht.update(mem_id, data=mem_svg(mem).encode("utf-8"))
    ht.update(clock_id, data=clock_svg().encode("utf-8"))
