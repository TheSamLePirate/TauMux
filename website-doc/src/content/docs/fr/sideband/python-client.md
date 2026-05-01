---
title: Client Python
description: scripts/hyperterm.py — show_image, show_svg, show_html, update, clear, events.
sidebar:
  order: 5
---

Le client Python situé dans `scripts/hyperterm.py` enveloppe fd 3/4/5 avec une API Python idiomatique. C'est un fichier unique sans dépendance — copiez-le dans n'importe quel projet, ou faites-en un `import` depuis `scripts/`.

## Détection

Le client est un **no-op sûr en dehors de τ-mux**. `ht.show_image(...)` retourne `None` et n'écrit rien si `HYPERTERM_PROTOCOL_VERSION` n'est pas dans l'environnement. Le même script s'exécute sans modification dans un terminal classique.

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

## Patterns courants

### Un tableau de bord auto-actualisé

```python
import time
from hyperterm import ht

cpu_panel = ht.show_html('<div>CPU: ?</div>', x=20, y=20, width=200, height=80)

while True:
    cpu = read_cpu_percent()
    ht.update(cpu_panel, data=f'<div>CPU: {cpu:.1f}%</div>')
    time.sleep(1)
```

### Bouton interactif

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

### Image depuis un buffer

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

- `scripts/hyperterm.py` — le client.
- `scripts/README_python.md` — référence côté dépôt.

## Pour aller plus loin

- [Vue d'ensemble du sideband](/fr/sideband/overview/)
- [Client TypeScript](/fr/sideband/typescript-client/)
- [Démos](/fr/sideband/demos/)
