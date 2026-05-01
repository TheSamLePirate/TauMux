---
title: Démos
description: Scripts de démo livrés avec le dépôt — copiez-les comme points de départ.
sidebar:
  order: 7
---

Le dossier `scripts/` du dépôt contient des scripts de démo qui exercent le protocole sideband. Lancez l'un d'eux à l'intérieur d'un panneau τ-mux :

```bash
bun scripts/demo_draw.ts                     # mouse-driven SVG drawing
python3 scripts/demo_dashboard.py            # CPU + memory + clock panels
python3 scripts/demo_chart.py                # matplotlib SVG chart
python3 scripts/demo_interactive.py          # clickable HTML buttons
python3 scripts/demo_image.py photo.png      # image panel
bun scripts/demo_3d.ts                       # WebGL 3D demo
bun scripts/demo_canvas_life.ts              # Conway's Game of Life
bash scripts/test_sideband.sh                # protocol integration check
```

## Ce que montre chaque démo

| Démo | Points forts |
|---|---|
| `demo_draw.ts` | Panneaux HTML `interactive`, événements souris, `update` avec un nouveau contenu SVG. |
| `demo_dashboard.py` | Plusieurs panneaux `float` mis à jour à 1 Hz via `update`. |
| `demo_chart.py` | Matplotlib → SVG → `show_svg`. Démontre l'usage de `data` inline au lieu de `byteLength`. |
| `demo_interactive.py` | Boutons dans des panneaux HTML ; les clics pilotent l'état Python. |
| `demo_image.py` | Panneau image unique depuis le disque ; démontre `show_image` avec un chemin. |
| `demo_3d.ts` | Rendu WebGL hors écran → octets d'image → `showCanvas2d`. |
| `demo_canvas_life.ts` | Appels `update` à haute fréquence ; démontre la contre-pression sous charge. |
| `test_sideband.sh` | Smoke test : lance un script, vérifie que chaque type de panneau s'affiche. |

## Ordre de lecture si vous débutez

1. `demo_image.py` — le panneau le plus simple possible.
2. `demo_dashboard.py` — plusieurs panneaux, mises à jour périodiques.
3. `demo_interactive.py` — événements circulant du terminal vers le script.
4. `demo_draw.ts` — flux bidirectionnel complet.
5. `demo_3d.ts` — charges utiles binaires lourdes.

## En dehors de τ-mux

Chaque démo fonctionne aussi dans un terminal classique. Les bibliothèques client deviennent des no-op, vous obtenez donc une sortie textuelle mais aucun panneau — utile pour tester la logique séparément du rendu.

## Pour aller plus loin

- [Vue d'ensemble du sideband](/fr/sideband/overview/)
- [Client Python](/fr/sideband/python-client/)
- [Client TypeScript](/fr/sideband/typescript-client/)
- [Fonctionnalité panneaux canvas](/fr/features/canvas-panels/)
