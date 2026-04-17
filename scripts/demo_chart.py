#!/usr/bin/env python3
"""Live-updating matplotlib chart rendered as SVG.

Usage: python3 scripts/demo_chart.py
Updates every 2 seconds with new random data. Ctrl+C to stop.
"""

import io
import math
import random
import signal
import time
import sys

from hyperterm import ht

if not ht.available:
    print("Not running inside HyperTerm Canvas.")
    sys.exit(0)

ht.on_error(
    lambda code, msg, ref=None: print(
        f"[error] {code}: {msg}", file=sys.stderr
    )
)

# Check matplotlib
try:
    import matplotlib
    matplotlib.use("svg")
    import matplotlib.pyplot as plt
except ImportError:
    print("matplotlib required: pip install matplotlib")
    sys.exit(1)

data_x = list(range(20))
data_y = [random.uniform(0, 100) for _ in range(20)]


def render_chart():
    fig, ax = plt.subplots(figsize=(5, 3))
    fig.patch.set_facecolor("#1e1e2e")
    ax.set_facecolor("#1e1e2e")

    ax.plot(data_x, data_y, color="#89b4fa", linewidth=2)
    ax.fill_between(data_x, data_y, alpha=0.15, color="#89b4fa")

    ax.set_title("Live Data", color="#cdd6f4", fontsize=12)
    ax.tick_params(colors="#6c7086", labelsize=8)
    ax.set_ylim(0, 120)
    for spine in ax.spines.values():
        spine.set_color("#313244")
    ax.grid(True, color="#313244", linewidth=0.5, alpha=0.5)

    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight", transparent=True)
    plt.close(fig)
    return buf.getvalue()


if __name__ == "__main__":
    # Mutable run-state scoped to main — keeps the module free of
    # globals so imports stay side-effect-free.
    panel_id = None
    updating = False

    def cleanup(*_):
        if panel_id:
            ht.clear(panel_id)
        print("\nChart stopped.")
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)

    print("Chart demo — updating every 2s (Ctrl+C to stop)")

    iteration = 0
    while True:
        # Update data
        data_y.pop(0)
        data_y.append(
            50 + 40 * math.sin(iteration * 0.3) + random.uniform(-10, 10)
        )
        iteration += 1

        # Skip this tick if the previous frame is still being sent.
        if updating:
            time.sleep(2)
            continue

        svg_bytes = render_chart()
        if not svg_bytes:
            # savefig produced nothing — skip rather than push empty meta.
            print("  [warn] empty SVG from savefig; skipping frame")
            time.sleep(2)
            continue

        updating = True
        try:
            if panel_id is None:
                panel_id = ht.show_svg(
                    svg_bytes.decode("utf-8"),
                    x=50,
                    y=50,
                    width=520,
                    height=340,
                )
                print(f"  Panel created: {panel_id}")
            else:
                ht.update(panel_id, data=svg_bytes)
        finally:
            updating = False

        time.sleep(2)
