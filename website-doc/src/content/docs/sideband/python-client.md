---
title: Python client
description: scripts/hyperterm.py — show_image, show_svg, show_html, update, clear, events.
sidebar:
  order: 5
---

The Python client at `scripts/hyperterm.py` wraps fd 3/4/5 with idiomatic Python. It's a single file with no dependencies — copy it into any project, or `import` it from `scripts/`.

## Detection

The client is a **safe no-op outside τ-mux**. `ht.show_image(...)` returns `None` and writes nothing if `HYPERTERM_PROTOCOL_VERSION` is not in env. The same script runs unmodified in a regular terminal.

## API

```python
from hyperterm import ht

# Create panels
panel_id = ht.show_image('photo.png', x=100, y=50, draggable=True)
panel_id = ht.show_svg('<svg>…</svg>', x=200, y=200)
panel_id = ht.show_html('<button onclick="alert(1)">Click</button>', interactive=True)
panel_id = ht.show_canvas2d(open('frame.png', 'rb').read(), x=0, y=0, width=400, height=300)

# Mutate
ht.update(panel_id, x=200, y=300)
ht.update(panel_id, width=600, opacity=0.8)

# Remove
ht.clear(panel_id)

# Events
for event in ht.events():
    print(event)         # dict: { "id", "event", "x"?, "y"?, … }

# Or callback-style
def on_event(e):
    if e["event"] == "click":
        print("click", e["x"], e["y"])

ht.on_event(on_event)
```

## Common patterns

### A self-updating dashboard

```python
import time
from hyperterm import ht

cpu_panel = ht.show_html('<div>CPU: ?</div>', x=20, y=20, width=200, height=80)

while True:
    cpu = read_cpu_percent()
    ht.update(cpu_panel, data=f'<div>CPU: {cpu:.1f}%</div>')
    time.sleep(1)
```

### Interactive button

```python
from hyperterm import ht

btn = ht.show_html(
    '<button id="b">Run tests</button>',
    x=20, y=20, width=200, height=60,
    interactive=True,
)

for event in ht.events():
    if event["id"] == btn and event["event"] == "click":
        run_tests()
        ht.update(btn, data='<div>Done.</div>')
```

### Image from a buffer

```python
import io, matplotlib.pyplot as plt
from hyperterm import ht

fig, ax = plt.subplots()
ax.plot([1,2,3], [4,5,6])
buf = io.BytesIO()
fig.savefig(buf, format="png")
ht.show_image(buf.getvalue(), x=0, y=0)         # accepts bytes too
```

## Source

- `scripts/hyperterm.py` — the client.
- `scripts/README_python.md` — repo-side reference.

## Read more

- [Sideband overview](/sideband/overview/)
- [TypeScript client](/sideband/typescript-client/)
- [Demos](/sideband/demos/)
